/* 노션 – 처음 한 번 가져오기 + 사이트 → 노션 한 방향 동기화
   - 사이트 데이터가 기준. 노션에서 고친 값은 가져오지 않고 다음 동기화 때 덮어씀
   - 마스터(비번)는 보내지 않음 (노션에 남아 있던 값은 지움)
   - 실패해도 사이트 데이터에는 영향 없음 → 대기열에 남겨 다시 시도 */
import { getSetting, setSetting, audit } from './db.js';
import { kstToday, parseYmd, cycleIndex, dueByCycle } from './dates.js';

import { ensureCharges, chargesOf, statusOf } from './ledger.js';

const VER = '2022-06-28';
const base = (env) => env.NOTION_BASE || 'https://api.notion.com';
export const notionReady = (env) => !!env.NOTION_TOKEN;

async function nf(env, path, method = 'GET', body) {
  const r = await fetch(base(env) + '/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + env.NOTION_TOKEN, 'Notion-Version': VER, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j && j.message) || 'Notion ' + r.status);
  return j;
}
export function dbIdOf(v) {
  const m = String(v || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}

/* ── 가져오기 ── */
const plain = (p) => (p ? (p.title || p.rich_text || []).map((x) => x.plain_text).join('').trim() : '');
function readRow(page) {
  const P = page.properties || {};
  const num = (k) => (P[k] && typeof P[k].number === 'number' ? P[k].number : null);
  const sel = (k) => (P[k] && P[k].select ? P[k].select.name : '');
  const chk = (k) => !!(P[k] && P[k].checkbox);
  return {
    notion_id: page.id, no: plain(P['호실']), state: sel('상태'), name: plain(P['이름']), phone: (P['전화번호'] && P['전화번호'].phone_number) || '',
    move_in: (P['입실일'] && P['입실일'].date && P['입실일'].date.start || '').slice(0, 10), rent: num('월세'), deposit: num('보증금'), type: sel('타입'), gender: sel('성별'),
    master: plain(P['마스터']), cycle: sel('계약 단위') === '2주' ? '2w' : 'month', paid: chk('입금'), cash_receipt: chk('현금영수증'), memo: plain(P['비고']), sms_off: chk('문자 제외')
  };
}
async function readAll(env, dbId) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const j = await nf(env, 'databases/' + dbId + '/query', 'POST', cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 });
    for (const p of j.results || []) out.push(readRow(p));
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return out;
}
const phoneOk = (p) => /^01[016789]\d{7,8}$/.test(String(p).replace(/\D/g, ''));
const fmtPhone = (p) => { const d = String(p).replace(/\D/g, ''); return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6); };
// 미리보기: 무엇을 어떻게 가져올지 + 문제 있는 줄
export async function importPreview(env, today = kstToday()) {
  const dbId = dbIdOf(await getSetting(env.DB, 'notionRoomsDb', ''));
  if (!dbId) throw new Error('설정에 노션 입실자 현황 주소를 먼저 넣어 주세요');
  const rows = await readAll(env, dbId);
  const plan = rows.filter((r) => r.no).map((r) => {
    const issues = [];
    const occupied = ['입실', '퇴실예정', '입실예정'].includes(r.state);
    if (occupied) {
      if (!r.name) issues.push('이름 없음');
      if (!phoneOk(r.phone)) issues.push('전화번호 확인 필요');
      if (!parseYmd(r.move_in)) issues.push('입실일 없음');
      if (!(r.rent > 0)) issues.push('월세 없음');
      if (r.state !== '입실예정' && parseYmd(r.move_in) && r.move_in > today) issues.push('입실일이 미래인데 상태가 ' + r.state);
    }
    // 계약 단위: 노션 '계약 단위' 칸이 2주면 2주, 아니면 월 (미리보기에서 체크로 바꿀 수 있음)
    const cycle = r.cycle;
    // 가장 최근 납부일(오늘 이전) 몫을 받았는지: 노션 '입금'은 매월 초 전체 해제 →
    // 그 납부일이 이번 달 1일 전이면 받은 것으로, 이번 달이면 노션 체크대로 (화면에서 줄마다 바꿀 수 있음)
    const living = !!(occupied && r.state !== '입실예정' && parseYmd(r.move_in) && r.move_in <= today);
    const paidFor = living ? dueByCycle(cycle, r.move_in, Math.max(0, cycleIndex(cycle, r.move_in, today))) : '';
    const paidDefault = living ? (paidFor < today.slice(0, 8) + '01' ? true : !!r.paid) : false;
    return { no: r.no, state: r.state || '공실', type: r.type, name: r.name, phone: r.phone, move_in: r.move_in, rent: r.rent, deposit: r.deposit, paid: r.paid, paidFor, paidDefault, cycle, living, sms_off: r.sms_off, issues, occupied, _r: r };
  }).sort((a, b) => (a.no < b.no ? -1 : 1));
  return plan;
}
export async function importRun(env, admin, today = kstToday(), choices = {}) {
  const db = env.DB;
  const any = await db.prepare('SELECT COUNT(*) AS n FROM tenants').first();
  if (any.n > 0) throw new Error('이미 입실자가 있어 가져올 수 없습니다 (처음 한 번만 가능)');
  const plan = await importPreview(env, today);
  const bad = plan.filter((p) => p.occupied && p.issues.length);
  if (bad.length) throw new Error('먼저 노션에서 고쳐 주세요: ' + bad.map((b) => b.no + '호(' + b.issues.join(', ') + ')').join(' / '));
  let rooms = 0, tenants = 0, sort = 0;
  for (const p of plan) {
    const r = p._r;
    sort += 10;
    const kind = r.state === '사무실' ? 'office' : 'room';
    const type = ['넓은 외창', '넓은 내창', '외창', '내창'].includes(r.type) ? r.type : '';
    let room = await db.prepare('SELECT id FROM rooms WHERE no = ?').bind(r.no).first();
    if (room) await db.prepare('UPDATE rooms SET type = ?, kind = ?, notion_id = ?, sort = ? WHERE id = ?').bind(type, kind, r.notion_id, sort, room.id).run();
    else { const x = await db.prepare('INSERT INTO rooms (no, type, kind, sort, notion_id) VALUES (?, ?, ?, ?, ?)').bind(r.no, type, kind, sort, r.notion_id).run(); room = { id: x.meta.last_row_id }; }
    rooms++;
    if (!p.occupied) continue;
    const living = r.state !== '입실예정';
    const rent = Math.round(r.rent * 10000);
    const ch = choices[r.no] || {};
    const cycle = ch.cycle === '2w' || ch.cycle === 'month' ? ch.cycle : p.cycle;
    const paid = typeof ch.paid === 'boolean' ? ch.paid : p.paidDefault;
    const from = living ? Math.max(0, cycleIndex(cycle, r.move_in, today)) : 0;
    const paidFor = living ? dueByCycle(cycle, r.move_in, from) : '';
    const ins = await db.prepare('INSERT INTO tenants (room_id, name, phone, move_in, rent, deposit, gender, master, cash_receipt, memo, sms_off, status, ledger_from, cycle, anchor, k_base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .bind(room.id, r.name, fmtPhone(r.phone), r.move_in, rent, Math.round((r.deposit || 0) * 10000), ['남', '여'].includes(r.gender) ? r.gender : '', r.master, r.cash_receipt ? 1 : 0, r.memo, r.sms_off ? 1 : 0, living ? (r.state === '퇴실예정' ? 'leaving' : 'in') : 'reserved', from, cycle, r.move_in).run();
    const t = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(ins.meta.last_row_id).first();
    tenants++;
    if (living) {
      await ensureCharges(db, t, today);
      // 이번 회차(가장 최근 납부일) 받음
      if (paid) {
        await db.prepare("INSERT INTO payments (tenant_id, paid_on, amount, method, memo, by_name) VALUES (?, ?, ?, '기존', ?, ?)").bind(t.id, paidFor, rent, '노션에서 가져옴: ' + paidFor + '분 받음', admin.name).run();
        const { reallocate } = await import('./ledger.js');
        await reallocate(db, t.id);
      }
    }
    await audit(db, admin, '노션에서 가져옴', r.no + '호 ' + r.name + ' · ' + r.state + ' · ' + (cycle === '2w' ? '2주' : '월') + (living ? ' · ' + paidFor + '분 ' + (paid ? '받음' : '미입금') : ''), { tenant: t.id, room: room.id });
  }
  return { rooms, tenants, notionRows: plan.length };
}

/* ── 동기화 ── */
// 노션 DB에 실제로 있는 칸 이름 (하루 한 번 새로 읽음) → 없는 칸은 보내지 않음 (다른 고시원 노션 호환)
async function propsOf(env, dbId) {
  const key = 'notionProps:' + dbId;
  const c = await getSetting(env.DB, key, null);
  if (c && Date.now() - c.t < 24 * 3600 * 1000) return new Set(c.names);
  const d = await nf(env, 'databases/' + dbId);
  const names = Object.keys(d.properties || {});
  await setSetting(env.DB, key, { t: Date.now(), names });
  return new Set(names);
}
function only(props, names) {
  const out = {};
  for (const k of Object.keys(props)) if (names.has(k)) out[k] = props[k];
  return out;
}
export async function enqueue(db, kind, id) {
  if (!id) return;
  await db.prepare('INSERT OR IGNORE INTO notion_queue (kind, ref_id) VALUES (?, ?)').bind(kind, id).run();
}
const STATE_KO = { in: '입실', leaving: '퇴실예정', reserved: '입실예정', vacant: '공실', repair: '공실', office: '사무실' };
const rt = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [] });
const KIND_KO = { d10: 'D-10', d1: 'D-1', dp1: 'D+1', dp3: 'D+3', notice: '공지', test: '시험' };
async function roomProps(env, room) {
  const db = env.DB;
  const t = await db.prepare("SELECT * FROM tenants WHERE room_id = ? AND status IN ('reserved', 'in', 'leaving')").bind(room.id).first();
  const state = room.kind === 'office' ? 'office' : t ? t.status : room.repair ? 'repair' : 'vacant';
  const props = {
    호실: { title: [{ type: 'text', text: { content: room.no } }] },
    상태: { select: { name: STATE_KO[state] } },
    타입: room.type ? { select: { name: room.type } } : { select: null },
    마스터: rt('') // 사이트에만 보관
  };
  if (!t) {
    Object.assign(props, { 이름: rt(''), 전화번호: { phone_number: null }, 입실일: { date: null }, 월세: { number: null }, 보증금: { number: null }, 성별: { select: null }, 입금: { checkbox: false }, 현금영수증: { checkbox: false }, 비고: rt(room.repair ? '수리중' : ''), '문자 제외': { checkbox: false }, 안내기록: rt(''),
      '다음 납부일': { date: null }, '계약 단위': { select: null }, 미납: { number: null }, 퇴실예정일: { date: null } });
    return props;
  }
  let paid = false, nextDue = null, owed = null;
  if (t.status !== 'reserved') {
    const ch = (await chargesOf(db, [t.id]))[t.id] || [];
    const st = statusOf(t, ch, kstToday());
    paid = st.code === 'paid';
    nextDue = st.nextDue || null;
    owed = st.owed ? st.owed / 10000 : 0;
  }
  const { results: sms } = await db.prepare("SELECT kind, status, updated_at FROM sms_log WHERE tenant_id = ? AND slot = 'T' ORDER BY id DESC LIMIT 3").bind(t.id).all();
  const smsText = (sms || []).map((x) => new Date(x.updated_at.replace(' ', 'T') + 'Z').toISOString().slice(5, 10).replace('-', '/') + ' ' + (KIND_KO[x.kind] || x.kind) + (x.status === 'sent' ? '' : '(' + x.status + ')')).join(', ');
  const hide = !!t.notion_off; // 본인이 국외 이전을 원하지 않음 → 이름·전화·비고 보내지 않음
  Object.assign(props, {
    이름: rt(hide ? '(비공개)' : t.name), 전화번호: { phone_number: hide ? null : t.phone }, 입실일: { date: { start: t.move_in } }, 월세: { number: t.rent / 10000 }, 보증금: { number: t.deposit / 10000 },
    성별: t.gender ? { select: { name: t.gender } } : { select: null }, 입금: { checkbox: paid }, 현금영수증: { checkbox: !!t.cash_receipt }, 비고: rt(hide ? '' : t.memo || ''), '문자 제외': { checkbox: !!t.sms_off },
    안내기록: rt(smsText),
    '다음 납부일': { date: nextDue ? { start: nextDue } : null }, '계약 단위': { select: { name: t.cycle === '2w' ? '2주' : '월' } },
    미납: { number: owed }, 퇴실예정일: { date: t.leave_date ? { start: t.leave_date } : null }
  });
  return props;
}
function outProps(t, room, owed) {
  const anon = !!t.anon_at || !!t.notion_off;
  return {
    이름: { title: [{ type: 'text', text: { content: anon ? '(퇴실자)' : t.name } }] },
    호실: rt(room ? room.no : ''),
    구분: { select: { name: t.status === 'cancelled' ? '입실 취소' : '퇴실' } },
    입실일: { date: { start: t.move_in } }, 퇴실일: t.out_date ? { date: { start: t.out_date } } : { date: null },
    월세: { number: t.rent / 10000 }, 보증금: { number: t.deposit / 10000 },
    반환: { number: t.dep_refund != null ? t.dep_refund / 10000 : null }, 공제: { number: t.dep_deduct != null ? t.dep_deduct / 10000 : null },
    '공제 사유': rt(anon ? '' : t.dep_note), 미납: { number: owed / 10000 }
  };
}
export async function createOutDb(env) {
  const roomsDb = dbIdOf(await getSetting(env.DB, 'notionRoomsDb', ''));
  if (!roomsDb) throw new Error('입실자 현황 주소를 먼저 넣어 주세요');
  const d = await nf(env, 'databases/' + roomsDb);
  if (!d.parent || d.parent.type !== 'page_id') throw new Error('입실자 현황이 페이지 안에 있지 않아 옆에 만들 수 없습니다');
  const num = { number: { format: 'number' } };
  const j = await nf(env, 'databases', 'POST', {
    parent: { type: 'page_id', page_id: d.parent.page_id },
    title: [{ type: 'text', text: { content: '📁 퇴실 기록' } }],
    description: [{ type: 'text', text: { content: '관리 사이트에서 자동으로 채움 (보기 전용). 금액 단위 만원. 퇴실 3년 뒤 이름은 자동으로 지워짐' } }],
    is_inline: true,
    properties: { 이름: { title: {} }, 호실: { rich_text: {} }, 구분: { select: { options: [{ name: '퇴실', color: 'gray' }, { name: '입실 취소', color: 'red' }] } }, 입실일: { date: {} }, 퇴실일: { date: {} }, 월세: num, 보증금: num, 반환: num, 공제: num, '공제 사유': { rich_text: {} }, 미납: num }
  });
  await setSetting(env.DB, 'notionOutDb', j.id);
  return j.id;
}
async function syncOne(env, item) {
  const db = env.DB;
  if (item.kind === 'room') {
    const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.ref_id).first();
    if (!room) return;
    const dbId0 = dbIdOf(await getSetting(db, 'notionRoomsDb', ''));
    const props = only(await roomProps(env, room), await propsOf(env, dbId0));
    if (room.notion_id) {
      await nf(env, 'pages/' + room.notion_id, 'PATCH', { properties: props });
    } else {
      const dbId = dbIdOf(await getSetting(db, 'notionRoomsDb', ''));
      if (!dbId) throw new Error('입실자 현황 주소 없음');
      const p = await nf(env, 'pages', 'POST', { parent: { database_id: dbId }, properties: props });
      await db.prepare('UPDATE rooms SET notion_id = ? WHERE id = ?').bind(p.id, room.id).run();
    }
  } else if (item.kind === 'out') {
    const t = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(item.ref_id).first();
    if (!t || (t.status !== 'out' && t.status !== 'cancelled')) return;
    const outDb = dbIdOf(await getSetting(db, 'notionOutDb', ''));
    if (!outDb) throw new Error('퇴실 기록 DB가 없습니다 (설정에서 만들기)');
    const room = await db.prepare('SELECT no FROM rooms WHERE id = ?').bind(t.room_id).first();
    const ch = ((await chargesOf(db, [t.id]))[t.id] || []).filter((c) => !c.void);
    const props = outProps(t, room, ch.reduce((a, c) => a + c.amount - c.paid, 0));
    if (t.notion_id) await nf(env, 'pages/' + t.notion_id, 'PATCH', { properties: props });
    else {
      const p = await nf(env, 'pages', 'POST', { parent: { database_id: outDb }, properties: props });
      await db.prepare('UPDATE tenants SET notion_id = ? WHERE id = ?').bind(p.id, t.id).run();
    }
  }
}
// 대기열 처리 (한 번에 max건, 실패는 남겨 두고 다음에 다시)
export async function processQueue(env, max = 8) {
  if (!notionReady(env) || !(await getSetting(env.DB, 'notionRoomsDb', ''))) return { skipped: true };
  const { results } = await env.DB.prepare('SELECT * FROM notion_queue WHERE done_at IS NULL AND tries < 20 ORDER BY tries, id LIMIT ?').bind(max).all();
  let ok = 0, failed = 0;
  for (const it of results || []) {
    try {
      await syncOne(env, it);
      await env.DB.prepare("UPDATE notion_queue SET done_at = datetime('now'), last_err = NULL WHERE id = ?").bind(it.id).run();
      ok++;
    } catch (e) {
      failed++;
      await env.DB.prepare('UPDATE notion_queue SET tries = tries + 1, last_err = ? WHERE id = ?').bind(String((e && e.message) || e).slice(0, 200), it.id).run();
    }
  }
  await env.DB.prepare("DELETE FROM notion_queue WHERE done_at IS NOT NULL AND done_at < datetime('now', '-30 days')").run();
  if (ok || failed) await setSetting(env.DB, 'notionLast', { at: new Date().toISOString(), ok, failed });
  return { ok, failed };
}
export async function enqueueAll(db) {
  const { results: keys } = await db.prepare("SELECT key FROM settings WHERE key LIKE 'notionProps:%'").all();
  for (const k of keys || []) await db.prepare('DELETE FROM settings WHERE key = ?').bind(k.key).run();
  const { results: rooms } = await db.prepare('SELECT id FROM rooms').all();
  for (const r of rooms || []) await enqueue(db, 'room', r.id);
  const { results: outs } = await db.prepare("SELECT id FROM tenants WHERE status IN ('out', 'cancelled')").all();
  for (const t of outs || []) await enqueue(db, 'out', t.id);
}
