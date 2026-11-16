/* 노션 – 처음 한 번 가져오기 + 관리자가 누를 때 백업
   - 가져온 뒤부터 사이트 데이터가 기준 (자동 동기화 없음, 기존 노션 DB는 보관용)
   - [노션에 백업]: 누를 때마다 "입실자 현황 YYYY-MM-DD" 새 페이지 + 현재 입실자 표 + 퇴실 기록 표
   - 마스터(비번)는 백업에 넣지 않음, '노션에 보내지 않음' 입실자는 이름·전화 가림 */
import { getSetting, setSetting, audit } from './db.js';
import { kstToday, parseYmd, cycleIndex, dueByCycle, addDays } from './dates.js';

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
  // 상태가 빈 줄(예: '보증금합계' 같은 합계 줄)은 호실이 아니므로 건너뜀
  const plan = rows.filter((r) => r.no && r.state).map((r) => {
    const issues = [];
    const occupied = ['입실', '퇴실예정', '입실예정'].includes(r.state);
    if (occupied) {
      const rsv = r.state === '입실예정'; // 예약은 이름·번호 없어도 됨 (입실 확인 때 입력)
      if (!r.name && !rsv) issues.push('이름 없음');
      if (!(rsv && !r.phone) && !phoneOk(r.phone)) issues.push('전화번호 확인 필요');
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
// 가져오기가 끝났는지: 끝까지 가져왔거나, 노션 없이 사이트에서 직접 등록해 쓰는 경우
export async function importDone(db) {
  if ((await getSetting(db, 'notionImport', '')) === 'done') return true;
  const r = await db.prepare('SELECT (SELECT COUNT(*) FROM tenants) AS t, (SELECT COUNT(*) FROM rooms WHERE notion_id IS NOT NULL) AS n').first();
  return r.t > 0 && r.n === 0;
}
/* 가져오기 (여러 번 나눠서): D1 무료 한도(요청당 쿼리 50번) 때문에 한 번에 몇 명씩.
   이미 입실자가 있는 호실은 건너뜀 → 중간에 멈춰도 다시 누르면 이어서 가져옴.
   화면은 done이 될 때까지 자동으로 다시 부름 */
export async function importRun(env, admin, today = kstToday(), choices = {}) {
  const db = env.DB;
  if (await importDone(db)) throw new Error('이미 가져오기를 마쳤습니다');
  const plan = await importPreview(env, today);
  const { results: busyRows } = await db.prepare("SELECT r.no FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('reserved', 'in', 'leaving')").all();
  const busy = new Set((busyRows || []).map((x) => x.no));
  const todo = plan.filter((p) => p.occupied && !busy.has(p.no));
  const bad = todo.filter((p) => p.issues.length);
  if (bad.length) throw new Error('먼저 노션에서 고쳐 주세요: ' + bad.map((b) => b.no + '호(' + b.issues.join(', ') + ')').join(' / '));
  // 호실은 한꺼번에 (있으면 정보만 갱신)
  let sort = 0;
  await db.batch(plan.map((p) => {
    const r = p._r;
    sort += 10;
    const kind = r.state === '사무실' ? 'office' : 'room';
    const type = ['넓은 외창', '넓은 내창', '외창', '내창'].includes(r.type) ? r.type : '';
    return db.prepare('INSERT INTO rooms (no, type, kind, sort, notion_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(no) DO UPDATE SET type = excluded.type, kind = excluded.kind, sort = excluded.sort, notion_id = excluded.notion_id').bind(r.no, type, kind, sort, r.notion_id);
  }));
  const { results: roomRows } = await db.prepare('SELECT id, no FROM rooms').all();
  const roomId = {};
  for (const x of roomRows || []) roomId[x.no] = x.id;
  let tenants = 0;
  for (const p of todo) {
    if (db.left && db.left() < 16) break; // 한 명에 쿼리 최대 9번 + 마무리 여유
    const r = p._r;
    const living = r.state !== '입실예정';
    const rent = Math.round(r.rent * 10000);
    const ch = choices[r.no] || {};
    const cycle = ch.cycle === '2w' || ch.cycle === 'month' ? ch.cycle : p.cycle;
    const paid = typeof ch.paid === 'boolean' ? ch.paid : p.paidDefault;
    const from = living ? Math.max(0, cycleIndex(cycle, r.move_in, today)) : 0;
    const paidFor = living ? dueByCycle(cycle, r.move_in, from) : '';
    const ins = await db.prepare('INSERT INTO tenants (room_id, name, phone, move_in, rent, deposit, gender, master, cash_receipt, memo, sms_off, status, ledger_from, cycle, anchor, k_base, notion_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(roomId[r.no], r.name || '', r.phone ? fmtPhone(r.phone) : '', r.move_in, rent, Math.round((r.deposit || 0) * 10000), ['남', '여'].includes(r.gender) ? r.gender : '', r.master, r.cash_receipt ? 1 : 0, r.memo, r.sms_off ? 1 : 0, living ? (r.state === '퇴실예정' ? 'leaving' : 'in') : 'reserved', from, cycle, r.move_in, r.notion_id).run();
    const tid = ins.meta.last_row_id;
    tenants++;
    if (living) {
      // 이번 회차(가장 최근 납부일) 받음 → 입금 먼저 넣고 납부분 만들기 (배정은 그때 한 번)
      if (paid) await db.prepare("INSERT INTO payments (tenant_id, paid_on, amount, method, memo, by_name) VALUES (?, ?, ?, '기존', ?, ?)").bind(tid, paidFor, rent, '노션에서 가져옴: ' + paidFor + '분 받음', admin.name).run();
      const t = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tid).first();
      await ensureCharges(db, t, today);
    }
    await audit(db, admin, '노션에서 가져옴', r.no + '호 ' + (r.name || '(이름 미정)') + ' · ' + r.state + ' · ' + (cycle === '2w' ? '2주' : '월') + (living ? ' · ' + paidFor + '분 ' + (paid ? '받음' : '미입금') : ''), { tenant: tid, room: roomId[r.no] });
  }
  const remaining = todo.length - tenants;
  if (!remaining) {
    await setSetting(db, 'notionImport', 'done', admin.name);
    await audit(db, admin, '노션에서 처음 가져오기 끝', '호실 ' + plan.length + ' · 입실자 ' + (busy.size + tenants));
  }
  return { done: !remaining, rooms: plan.length, tenants: busy.size + tenants, added: tenants, remaining, notionRows: plan.length };
}

/* ── 백업 ── */
const rt = (s) => [{ type: 'text', text: { content: String(s == null ? '' : s).slice(0, 1900) } }];
const man = (won) => (won == null ? '' : String(Math.round(won / 1000) / 10));
const STATE_KO = { in: '입실', leaving: '퇴실예정', reserved: '입실예정', out: '퇴실', cancelled: '입실 취소' };
const LEDGER_KO = { paid: '입금됨', upcoming: '납부 예정', partial: '부분 입금', today: '오늘 납부일', late: '미납' };
export const BACKUP_KEEP_YEARS = 3; // 이보다 오래된 백업은 화면에 '삭제 권장' 표시 (자동으로 지우지는 않음)

// 백업 페이지를 만들 위치: 설정값이 없으면 입실자 현황 DB가 들어 있는 페이지
async function backupParent(env) {
  const db = env.DB;
  const set = dbIdOf(await getSetting(db, 'notionBackupParent', ''));
  if (set) return set;
  const roomsDb = dbIdOf(await getSetting(db, 'notionRoomsDb', ''));
  if (!roomsDb) throw new Error('설정에 노션 입실자 현황 주소나 백업 위치 페이지를 넣어 주세요');
  let parent = (await nf(env, 'databases/' + roomsDb)).parent;
  for (let i = 0; i < 5 && parent; i++) {
    if (parent.type === 'page_id') {
      const pg = await nf(env, 'pages/' + parent.page_id);
      const title = Object.values(pg.properties || {}).map((p) => (p.title || []).map((x) => x.plain_text).join('')).join('').trim();
      if (title || !pg.parent || pg.parent.type === 'workspace') return parent.page_id;
      parent = pg.parent; // 제목 없는 칸(열·토글)이면 한 단계 위 페이지로
    } else if (parent.type === 'block_id') {
      parent = (await nf(env, 'blocks/' + parent.block_id)).parent;
    } else break;
  }
  throw new Error('백업할 페이지를 찾지 못했습니다. 설정에 "백업 위치 페이지" 주소를 넣어 주세요');
}
function tableBlock(head, rows) {
  return {
    object: 'block', type: 'table',
    table: { table_width: head.length, has_column_header: true, has_row_header: false, children: [head, ...rows].slice(0, 99).map((r) => ({ type: 'table_row', table_row: { cells: r.map((c) => rt(c)) } })) }
  };
}
export async function backupToNotion(env, admin, today) {
  const db = env.DB;
  const { results: ts } = await db.prepare("SELECT t.*, r.no AS room, r.type AS rtype, r.sort FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('reserved', 'in', 'leaving') ORDER BY r.sort, r.no").all();
  const { results: rooms } = await db.prepare('SELECT * FROM rooms ORDER BY sort, no').all();
  const ch = await chargesOf(db, (ts || []).map((t) => t.id));
  const byRoom = {};
  for (const t of ts || []) byRoom[t.room_id] = t;
  const head1 = ['호실', '상태', '이름', '전화', '계약', '금액(만원)', '보증금', '입실일', '다음 납부일', '입금 상태', '미납(만원)', '퇴실예정일', '현금영수증', '문자 제외', '비고'];
  const rows1 = (rooms || []).map((r) => {
    const t = byRoom[r.id];
    if (!t) return [r.no, r.kind === 'office' ? '사무실' : r.repair ? '수리중' : '공실', '', '', '', '', '', '', '', '', '', '', '', '', r.memo || ''];
    const hide = !!t.notion_off;
    const st = t.status === 'reserved' ? null : statusOf(t, ch[t.id], today);
    return [r.no, STATE_KO[t.status], hide ? '(비공개)' : t.name, hide ? '' : t.phone, t.cycle === '2w' ? '2주' : '월', man(t.rent), man(t.deposit), t.move_in,
      st ? st.nextDue : '', st ? LEDGER_KO[st.code] + (st.code === 'late' ? ' D+' + st.days : '') : '입실 전', st && st.owed ? man(st.owed) : '', t.leave_date || '', t.cash_receipt ? 'O' : '', t.sms_off ? 'O' : '', hide ? '' : t.memo || ''];
  });
  // 퇴실 기록: 퇴실 3년 안 · 익명화 안 된 것만 (보관 기간 원칙)
  const since = addDays(today, -Math.round(365.25 * 3));
  const { results: outs } = await db.prepare("SELECT t.*, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('out', 'cancelled') AND t.anon_at IS NULL AND t.out_date >= ? ORDER BY t.out_date DESC").bind(since).all();
  const chOut = await chargesOf(db, (outs || []).map((t) => t.id));
  const head2 = ['호실', '이름', '구분', '입실일', '퇴실일', '계약', '금액(만원)', '보증금', '반환', '공제', '공제 사유', '7일 전 통보', '남은 미납'];
  const rows2 = (outs || []).map((t) => {
    const hide = !!t.notion_off;
    const owed = (chOut[t.id] || []).filter((c) => !c.void).reduce((a, c) => a + c.amount - c.paid, 0);
    return [t.room, hide ? '(비공개)' : t.name, STATE_KO[t.status], t.move_in, t.out_date || '', t.cycle === '2w' ? '2주' : '월', man(t.rent), man(t.deposit), man(t.dep_refund), man(t.dep_deduct), hide ? '' : t.dep_note || '', t.status === 'out' ? (t.dep_notice ? 'O' : 'X') : '', owed ? man(owed) : ''];
  });
  const parent = await backupParent(env);
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16);
  const title = '입실자 현황 ' + today;
  const para = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } });
  const h2 = (text) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } });
  const t1 = tableBlock(head1, rows1);
  const t2 = tableBlock(head2, rows2.length ? rows2 : [head2.map((_, i) => (i === 0 ? '없음' : ''))]);
  const page = await nf(env, 'pages', 'POST', {
    parent: { page_id: parent },
    properties: { title: { title: rt(title) } },
    children: [
      para('관리 사이트에서 ' + today + ' ' + stamp + '에 ' + (admin ? admin.name : '') + '님이 만든 백업입니다 (보기용). 금액 단위 만원. 마스터(비번)는 넣지 않았습니다.'),
      h2('현재 입실자 (' + (ts || []).length + '명 · 호실 ' + (rooms || []).length + '개)'), t1,
      h2('퇴실 기록 (최근 3년 · ' + rows2.length + '건)'), t2,
      para('퇴실 3년이 지난 사람의 정보가 든 백업은 개인정보 보관 기간이 지난 것이니 지워 주세요 (관리 사이트 설정 → 노션 백업 목록에서 [삭제]).')
    ]
  });
  // 99줄 넘는 표는 나머지 줄을 이어 붙임
  const blocks = (await nf(env, 'blocks/' + page.id + '/children?page_size=20')).results || [];
  const tables = blocks.filter((b) => b.type === 'table');
  const extra = [[tables[0], rows1.slice(98)], [tables[1], rows2.slice(98)]];
  for (const [tb, rest] of extra) {
    for (let i = 0; tb && i < rest.length; i += 100) {
      await nf(env, 'blocks/' + tb.id + '/children', 'PATCH', { children: rest.slice(i, i + 100).map((r) => ({ type: 'table_row', table_row: { cells: r.map((c) => rt(c)) } })) });
    }
  }
  const list = await getSetting(db, 'notionBackups', []);
  list.unshift({ id: page.id, url: page.url || '', day: today, at: new Date().toISOString(), by: admin ? admin.name : '', current: (ts || []).length, out: rows2.length });
  await setSetting(db, 'notionBackups', list.slice(0, 500));
  return { url: page.url || '', title, current: (ts || []).length, out: rows2.length };
}
export async function deleteBackup(env, id) {
  const db = env.DB;
  const list = await getSetting(db, 'notionBackups', []);
  if (!list.some((b) => b.id === id)) throw new Error('이 사이트가 만든 백업만 지울 수 있습니다');
  try { await nf(env, 'pages/' + id, 'PATCH', { archived: true }); } catch (e) { if (!/archived|not found|Could not find/i.test(e.message)) throw e; }
  await setSetting(db, 'notionBackups', list.filter((b) => b.id !== id));
}
