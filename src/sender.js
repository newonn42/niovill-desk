/* 문자 한 건 보내기 (솔라피)
   돌려주는 값: { ok, type, cost, msgId, groupId, error, unknown }
   - unknown = 요청은 갔는데 응답을 못 받음(시간 초과·서버 오류) → 실제로 갔을 수 있으므로 다시 보내지 않음 */
const API = 'https://api.solapi.com';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function solapiAuth(key, secret, now = new Date()) {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16))); // 32자, 요청마다 다름
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(date + salt)));
  return 'HMAC-SHA256 apiKey=' + key + ', date=' + date + ', salt=' + salt + ', signature=' + sig;
}
const digits = (p) => String(p || '').replace(/\D/g, '');
const base = (env) => env.SOLAPI_BASE || API;

export function solapiReady(env) {
  return !!(env.SOLAPI_KEY && env.SOLAPI_SECRET);
}

export async function sendOne(env, cfg, to, text) {
  if (env.SMS_MOCK === '1' && !env.SOLAPI_BASE) return mockSend(to, text);
  if (!solapiReady(env)) return { ok: false, error: '솔라피 키가 설정되지 않았습니다' };
  if (!cfg.senderPhone) return { ok: false, error: '발신번호가 없습니다' };
  let res, body;
  try {
    res = await fetch(base(env) + '/messages/v4/send-many/detail', {
      method: 'POST',
      headers: { Authorization: await solapiAuth(env.SOLAPI_KEY, env.SOLAPI_SECRET), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ to: digits(to), from: digits(cfg.senderPhone), text }], showMessageList: true }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    return { ok: false, unknown: true, error: '응답 없음 (' + ((e && e.name) || '연결 오류') + ')' };
  }
  try { body = await res.json(); } catch (e) { body = null; }
  if (res.status >= 500 || !body) return { ok: false, unknown: true, error: '솔라피 서버 오류 ' + res.status };
  if (!res.ok) return { ok: false, error: (body.errorMessage || body.errorCode || 'HTTP ' + res.status) + '' };
  const groupId = body.groupInfo && body.groupInfo.groupId;
  const failed = body.failedMessageList || [];
  if (failed.length) return { ok: false, groupId, error: (failed[0].statusMessage || '접수 실패') + ' (' + (failed[0].statusCode || '') + ')' };
  const m = (body.messageList && body.messageList[0]) || (body.messageList && Object.values(body.messageList)[0]) || {};
  if (m.statusCode && String(m.statusCode) !== '2000') return { ok: false, groupId, msgId: m.messageId, error: (m.statusMessage || '접수 실패') + ' (' + m.statusCode + ')' };
  return { ok: true, groupId, msgId: m.messageId || null, type: m.type || null };
}

// 잔액 (원). 실패하면 null
export async function balance(env) {
  if (env.SMS_MOCK === '1' && !env.SOLAPI_BASE) return { balance: 99999, point: 0 };
  if (!solapiReady(env)) return null;
  try {
    const r = await fetch(base(env) + '/cash/v1/balance', { headers: { Authorization: await solapiAuth(env.SOLAPI_KEY, env.SOLAPI_SECRET) }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { balance: Number(j.balance) || 0, point: Number(j.point) || 0 };
  } catch (e) { return null; }
}

// 개발용 가짜 발송: 번호가 0000으로 끝나면 실패, 9999로 끝나면 결과 불확실
function mockSend(to, text) {
  const d = digits(to);
  if (d.endsWith('0000')) return { ok: false, error: '가짜 실패' };
  if (d.endsWith('9999')) return { ok: false, unknown: true, error: '응답 없음 (가짜)', msgId: 'M-' + Date.now() };
  const lms = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0) > 90;
  return { ok: true, type: lms ? 'LMS' : 'SMS', msgId: 'M-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), groupId: 'G-mock' };
}
