/* 문자 한 건 보내기. 6단계에서 솔라피를 연결합니다.
   돌려주는 값: { ok, type, cost, msgId, groupId, error, unknown } */
export async function sendOne(env, cfg, to, text) {
  if (env.SMS_MOCK === '1') return mockSend(env, to, text);
  return { ok: false, error: '솔라피가 아직 연결되지 않았습니다 (6단계)' };
}
// 개발용 가짜 발송: 번호가 0000으로 끝나면 실패, 9999로 끝나면 결과 불확실
async function mockSend(env, to, text) {
  const d = String(to).replace(/\D/g, '');
  if (d.endsWith('0000')) return { ok: false, error: '가짜 실패' };
  if (d.endsWith('9999')) return { ok: false, unknown: true, error: '응답 없음 (가짜)' , msgId: 'M-' + Date.now() };
  const lms = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0) > 90;
  return { ok: true, type: lms ? 'LMS' : 'SMS', cost: lms ? 45 : 18, msgId: 'M-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), groupId: 'G-mock' };
}
