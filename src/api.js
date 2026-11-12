/* 관리 프로그램 API (/api/...) */
import { hashPassword, verifyPassword, createSession, currentAdmin, deleteSession, sessionCookie, clearCookie, lockKey, lockedMinutes, recordFail, clearFails, sha256, randomBytes, b64u } from './auth.js';
import { getSetting, setSetting, audit } from './db.js';
import { kstToday, parseYmd, cycleOnOrBefore, dueDate, addDays } from './dates.js';
import { ensureCharges, ensureAll, reallocate, chargesOf, creditOf, statusOf } from './ledger.js';
import { smsSettings, planSms, runSms, KINDS, DEFAULT_TEMPLATES, render, bytes, typeOf, PRICE, mdw } from './sms.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers) });
const fail = (error, status = 400) => json({ ok: false, error }, status);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new Error('type');
  const t = await request.text();
  if (t.length > 100000) throw new Error('size');
  const b = JSON.parse(t || '{}');
  if (!b || typeof b !== 'object') throw new Error('body');
  return b;
}
class Bad extends Error {}
const bad = (m) => { throw new Bad(m); };

// 만원 단위 입력 → 원 (소수 가능: 32.5 → 325,000원)
function man(v, label, { min = 0, max = 10000, required = true } = {}) {
  if ((v === '' || v == null) && !required) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) bad(label + '을(를) 만원 단위 숫자로 입력해 주세요');
  return Math.round(n * 10000);
}
function phoneOf(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) bad('휴대전화번호를 확인해 주세요 (010으로 시작)');
  return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}
function dateOf(v, label) {
  if (!parseYmd(v)) bad(label + ' 날짜를 확인해 주세요');
  return v;
}
const GENDERS = ['', '남', '여'];
const TYPES = ['', '넓은 외창', '넓은 내창', '외창', '내창'];
const manText = (won) => (won == null ? '' : (Math.round(won / 1000) / 10).toLocaleString('ko-KR') + '만원');

async function todayOf(env) {
  if (env.DEV === '1') {
    const d = await getSetting(env.DB, 'dev_today', null);
    if (d) return d;
  }
  return kstToday();
}

/* ── 로그인 · 관리자 ── */
async function me(env, request) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (!n || n.n === 0) return json({ ok: true, needSetup: true });
  const admin = await currentAdmin(env.DB, request);
  if (!admin) return json({ ok: true, needLogin: true, bizName: await getSetting(env.DB, 'bizName', '') });
  return json({ ok: true, admin, bizName: await getSetting(env.DB, 'bizName', ''), today: await todayOf(env), dev: env.DEV === '1' });
}
function checkNewAccount(b) {
  const username = str(b.username, 20).toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) bad('아이디는 영문 소문자·숫자·_ 3~20자로 정해 주세요');
  const password = String(b.password || '');
  if (password.length < 8 || password.length > 100) bad('비밀번호는 8자 이상으로 정해 주세요');
  return { username, password };
}
async function setup(env, request, b) {
  const { username, password } = checkNewAccount(b);
  const name = str(b.name, 20) || '관리자';
  const r = await env.DB.prepare("INSERT INTO admins (username, name, pw_hash, role) SELECT ?, ?, ?, 'owner' WHERE NOT EXISTS (SELECT 1 FROM admins)").bind(username, name, await hashPassword(password)).run();
  if (!r.meta || r.meta.changes !== 1) return fail('이미 관리자가 있습니다. 로그인해 주세요', 409);
  if (b.bizName) await setSetting(env.DB, 'bizName', str(b.bizName, 30), name);
  const a = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(username).first();
  await audit(env.DB, { id: a.id, name }, '최고 관리자 만들기', name);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, await createSession(env.DB, a.id)) });
}
async function login(env, request, b) {
  const username = str(b.username, 40).toLowerCase();
  const password = String(b.password || '');
  if (!username || !password) return fail('아이디와 비밀번호를 입력해 주세요');
  const key = lockKey(username);
  const mins = await lockedMinutes(env.DB, key);
  if (mins) return fail('여러 번 틀려 잠겼습니다. ' + mins + '분 뒤에 다시 시도해 주세요', 429);
  const a = await env.DB.prepare('SELECT id, name, pw_hash, active FROM admins WHERE username = ?').bind(username).first();
  if (!a || !a.active || !(await verifyPassword(password, a.pw_hash))) {
    await recordFail(env.DB, key);
    return fail('아이디 또는 비밀번호가 맞지 않습니다', 401);
  }
  await clearFails(env.DB, key);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, await createSession(env.DB, a.id)) });
}
async function inviteCreate(env, admin, b) {
  const name = str(b.name, 20);
  if (!name) bad('이름을 입력해 주세요');
  const role = b.role === 'owner' ? 'owner' : 'staff';
  const token = b64u(randomBytes(24));
  await env.DB.prepare("INSERT INTO invites (token_hash, name, role, created_by, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+3 days'))").bind(await sha256(token), name, role, admin.id).run();
  await audit(env.DB, admin, '관리자 초대', name + ' (' + (role === 'owner' ? '최고' : '일반') + ')');
  return json({ ok: true, token });
}
async function inviteAccept(env, request, b) {
  const token = str(b.token, 100);
  const { username, password } = checkNewAccount(b);
  const th = await sha256(token);
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')").bind(th).first();
  if (!inv) return fail('초대 링크가 만료되었거나 이미 사용되었습니다. 다시 초대를 받아 주세요', 410);
  const exists = await env.DB.prepare('SELECT 1 AS x FROM admins WHERE username = ?').bind(username).first();
  if (exists) return fail('이미 쓰는 아이디입니다');
  const used = await env.DB.prepare("UPDATE invites SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL").bind(th).run();
  if (!used.meta || used.meta.changes !== 1) return fail('초대 링크가 이미 사용되었습니다', 410);
  await env.DB.prepare('INSERT INTO admins (username, name, pw_hash, role) VALUES (?, ?, ?, ?)').bind(username, inv.name, await hashPassword(password), inv.role).run();
  const a = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(username).first();
  await audit(env.DB, { id: a.id, name: inv.name }, '초대 수락', username);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, await createSession(env.DB, a.id)) });
}
async function adminsGet(env) {
  const { results } = await env.DB.prepare('SELECT id, username, name, role, active, created_at FROM admins ORDER BY id').all();
  return json({ ok: true, admins: results || [] });
}
async function adminActive(env, admin, b) {
  const id = Number(b.id);
  if (id === admin.id) bad('자기 계정은 끌 수 없습니다');
  const t = await env.DB.prepare('SELECT name FROM admins WHERE id = ?').bind(id).first();
  if (!t) bad('관리자를 찾지 못했습니다');
  await env.DB.prepare('UPDATE admins SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
  if (!b.active) await env.DB.prepare('DELETE FROM sessions WHERE admin_id = ?').bind(id).run();
  await audit(env.DB, admin, b.active ? '관리자 다시 켬' : '관리자 끔', t.name);
  return json({ ok: true });
}
async function password(env, admin, b) {
  const a = await env.DB.prepare('SELECT pw_hash FROM admins WHERE id = ?').bind(admin.id).first();
  if (!(await verifyPassword(String(b.old || ''), a.pw_hash))) bad('지금 비밀번호가 맞지 않습니다');
  const pw = String(b.new || '');
  if (pw.length < 8 || pw.length > 100) bad('새 비밀번호는 8자 이상으로 정해 주세요');
  await env.DB.prepare('UPDATE admins SET pw_hash = ? WHERE id = ?').bind(await hashPassword(pw), admin.id).run();
  await audit(env.DB, admin, '비밀번호 변경', '');
  return json({ ok: true });
}

/* ── 호실 목록 · 대시보드 ── */
async function ensureToday(env, today) {
  if ((await getSetting(env.DB, 'ensured', '')) === today) return;
  await ensureAll(env.DB, today);
  await setSetting(env.DB, 'ensured', today);
}
function tenantSummary(t, st, today) {
  return {
    id: t.id, name: t.name, phone: t.phone, status: t.status, move_in: t.move_in, rent: t.rent, deposit: t.deposit,
    sms_off: t.sms_off, leave_date: t.leave_date, ledger: t.status === 'reserved' ? null : st,
    checkinDue: t.status === 'reserved' && t.move_in <= today, checkoutDue: t.status === 'leaving' && t.leave_date && t.leave_date <= today
  };
}
async function board(env) {
  const db = env.DB;
  const today = await todayOf(env);
  await ensureToday(env, today);
  const { results: rooms } = await db.prepare('SELECT * FROM rooms ORDER BY sort, no').all();
  const { results: ts } = await db.prepare("SELECT * FROM tenants WHERE status IN ('reserved', 'in', 'leaving')").all();
  const ch = await chargesOf(db, (ts || []).filter((t) => t.status !== 'reserved').map((t) => t.id));
  const byRoom = {};
  for (const t of ts || []) byRoom[t.room_id] = tenantSummary(t, statusOf(t, ch[t.id], today), today);
  const list = (rooms || []).map((r) => {
    const t = byRoom[r.id] || null;
    const state = r.kind === 'office' ? 'office' : t ? t.status : r.repair ? 'repair' : 'vacant';
    return { id: r.id, no: r.no, type: r.type, kind: r.kind, repair: r.repair, memo: r.memo, state, tenant: t };
  });
  return { today, rooms: list };
}
async function roomsGet(env) {
  return json(Object.assign({ ok: true }, await board(env)));
}
async function dash(env) {
  const { today, rooms } = await board(env);
  // (board 안에서 ensureToday 실행)
  const real = rooms.filter((r) => r.kind === 'room');
  const live = real.filter((r) => r.state === 'in' || r.state === 'leaving');
  const late = live.filter((r) => r.tenant.ledger && r.tenant.ledger.code === 'late');
  const todo = [];
  for (const r of rooms) {
    const t = r.tenant;
    if (!t) continue;
    if (t.checkinDue) todo.push({ kind: 'checkin', room: r.no, id: t.id, text: r.no + '호 ' + t.name + ' 입실 확인 (입실일 ' + t.move_in + ')' });
    if (t.checkoutDue) todo.push({ kind: 'checkout', room: r.no, id: t.id, text: r.no + '호 ' + t.name + ' 퇴실 처리 (퇴실예정 ' + t.leave_date + ')' });
    if (t.ledger && t.ledger.code === 'late' && t.ledger.days >= 3) todo.push({ kind: 'call', room: r.no, id: t.id, text: r.no + '호 ' + t.name + ' 미납 ' + manText(t.ledger.owed) + ' · D+' + t.ledger.days + ' 전화 확인' });
  }
  const cfg = await smsSettings(env.DB);
  const att = await env.DB.prepare("SELECT COUNT(*) AS n FROM sms_log WHERE status = 'unknown' OR (status = 'failed' AND tries >= 2)").first();
  if (att && att.n) todo.push({ kind: 'sms', text: '문자 ' + att.n + '건 결과 확인 필요 (실패·응답 없음)' });
  const lastRun = await env.DB.prepare('SELECT day, at, mode, planned, sent, failed FROM runs ORDER BY id DESC LIMIT 1').first();
  return json({
    ok: true, today, sms: { mode: cfg.stop ? 'stopped' : cfg.testMode ? 'test' : 'live', noAccount: !String(cfg.account || '').trim(), lastRun },
    counts: { rooms: real.length, live: live.length, vacant: real.filter((r) => r.state === 'vacant').length, reserved: real.filter((r) => r.state === 'reserved').length, repair: real.filter((r) => r.state === 'repair').length, late: late.length },
    owed: late.reduce((a, r) => a + r.tenant.ledger.owed, 0),
    late: late.map((r) => ({ room: r.no, id: r.tenant.id, name: r.tenant.name, owed: r.tenant.ledger.owed, days: r.tenant.ledger.days })).sort((a, b) => b.days - a.days),
    todo
  });
}

/* ── 입실자 ── */
async function tenantRow(db, id) {
  const t = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(Number(id)).first();
  if (!t) bad('입실자를 찾지 못했습니다');
  return t;
}
async function tenantGet(env, id) {
  const db = env.DB;
  const today = await todayOf(env);
  await ensureToday(env, today);
  const t = await tenantRow(db, id);
  const room = await db.prepare('SELECT id, no, type FROM rooms WHERE id = ?').bind(t.room_id).first();
  const ch = (await chargesOf(db, [t.id]))[t.id] || [];
  const { results: pays } = await db.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY paid_on DESC, id DESC').bind(t.id).all();
  const { results: allocs } = await db.prepare('SELECT a.payment_id, a.charge_id, a.amount, c.due FROM allocations a JOIN charges c ON c.id = a.charge_id WHERE a.tenant_id = ?').bind(t.id).all();
  const { results: rents } = await db.prepare('SELECT * FROM rent_changes WHERE tenant_id = ? ORDER BY id DESC').bind(t.id).all();
  const { results: log } = await db.prepare('SELECT at, who, action, detail FROM audit WHERE tenant_id = ? ORDER BY id DESC LIMIT 40').bind(t.id).all();
  const { results: sms } = await db.prepare("SELECT kind, status, created_at, updated_at, err FROM sms_log WHERE tenant_id = ? AND slot = 'T' ORDER BY id DESC LIMIT 20").bind(t.id).all();
  return json({
    ok: true, today, tenant: t, room, charges: ch.slice().reverse(), payments: pays || [], allocations: allocs || [], rents: rents || [], log: log || [], sms: sms || [],
    credit: await creditOf(db, t.id), ledger: t.status === 'reserved' || t.status === 'cancelled' ? null : statusOf(t, ch, today)
  });
}
async function freeRoom(db, roomId, exceptTenant = 0) {
  const r = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(Number(roomId)).first();
  if (!r) bad('호실을 찾지 못했습니다');
  if (r.kind === 'office') bad('사무실에는 입실자를 넣을 수 없습니다');
  if (r.repair) bad('수리중인 호실입니다. 설정 → 호실에서 수리중을 먼저 풀어 주세요');
  const busy = await db.prepare("SELECT name FROM tenants WHERE room_id = ? AND status IN ('reserved', 'in', 'leaving') AND id != ?").bind(r.id, exceptTenant).first();
  if (busy) bad(r.no + '호에는 이미 ' + busy.name + '님이 있습니다');
  return r;
}
function tenantFields(b) {
  return {
    name: str(b.name, 20) || bad('이름을 입력해 주세요'),
    phone: phoneOf(b.phone),
    deposit: man(b.deposit, '보증금', { max: 10000 }),
    gender: GENDERS.includes(b.gender) ? b.gender : '',
    master: str(b.master, 20),
    cash_receipt: b.cash_receipt ? 1 : 0,
    memo: str(b.memo, 300),
    sms_off: b.sms_off ? 1 : 0
  };
}
async function addPayment(db, admin, t, amount, paidOn, method, memo) {
  await db.prepare('INSERT INTO payments (tenant_id, paid_on, amount, method, memo, by_name) VALUES (?, ?, ?, ?, ?, ?)').bind(t.id, paidOn, amount, method, memo, admin.name).run();
  await reallocate(db, t.id);
}
async function tenantCreate(env, admin, b) {
  const db = env.DB;
  const today = await todayOf(env);
  const room = await freeRoom(db, b.room_id);
  const f = tenantFields(b);
  const moveIn = dateOf(b.move_in, '입실일');
  const rent = man(b.rent, '월세', { min: 1, max: 1000 });
  // 'living' = 이미 살고 있는 분 등록 (기존 입실자 옮겨 오기): 이번 회차부터 장부 시작
  const living = b.mode === 'living';
  if (living && moveIn > today) bad('이미 입실한 분이면 입실일이 오늘 이전이어야 합니다');
  const from = living ? Math.max(0, cycleOnOrBefore(moveIn, today)) : 0;
  const r = await db
    .prepare('INSERT INTO tenants (room_id, name, phone, move_in, rent, deposit, gender, master, cash_receipt, memo, sms_off, status, ledger_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(room.id, f.name, f.phone, moveIn, rent, f.deposit, f.gender, f.master, f.cash_receipt, f.memo, f.sms_off, living ? 'in' : 'reserved', from)
    .run();
  const id = r.meta.last_row_id;
  const t = await tenantRow(db, id);
  await audit(db, admin, living ? '입실자 등록 (이미 입실)' : '입실예정 등록', room.no + '호 ' + f.name + ' · 입실일 ' + moveIn + ' · 월세 ' + manText(rent), { tenant: id, room: room.id });
  if (living) {
    await ensureCharges(db, t, today);
    if (b.paidCurrent) {
      await addPayment(db, admin, t, rent, today, '기존', '등록 시 이번 회차(' + dueDate(moveIn, from) + ') 입금됨으로 등록');
      await audit(db, admin, '입금', manText(rent) + ' · 등록 시 이번 회차 입금됨', { tenant: id });
    }
  }
  return json({ ok: true, id });
}
async function tenantUpdate(env, admin, b) {
  const db = env.DB;
  const today = await todayOf(env);
  const t = await tenantRow(db, b.id);
  if (t.status === 'out' || t.status === 'cancelled') bad('퇴실한 기록은 고칠 수 없습니다');
  const f = tenantFields(b);
  const changes = [];
  for (const k of Object.keys(f)) if (String(f[k] ?? '') !== String(t[k] ?? '')) changes.push(k === 'master' ? '마스터' : k);
  let roomId = t.room_id;
  if (b.room_id && Number(b.room_id) !== t.room_id) { roomId = (await freeRoom(db, b.room_id, t.id)).id; changes.push('호실 이동'); }
  let moveIn = t.move_in;
  if (b.move_in && b.move_in !== t.move_in) {
    moveIn = dateOf(b.move_in, '입실일');
    const paid = await db.prepare('SELECT 1 AS x FROM payments WHERE tenant_id = ? AND cancelled_at IS NULL LIMIT 1').bind(t.id).first();
    if (paid && t.status !== 'reserved') bad('입금 기록이 있어 입실일을 바꿀 수 없습니다. 입금을 먼저 취소하거나 관리자에게 문의해 주세요');
    changes.push('입실일 ' + t.move_in + ' → ' + moveIn);
  }
  await db
    .prepare("UPDATE tenants SET room_id = ?, name = ?, phone = ?, move_in = ?, deposit = ?, gender = ?, master = ?, cash_receipt = ?, memo = ?, sms_off = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(roomId, f.name, f.phone, moveIn, f.deposit, f.gender, f.master, f.cash_receipt, f.memo, f.sms_off, t.id)
    .run();
  if (moveIn !== t.move_in && t.status !== 'reserved') {
    // 납부일이 바뀌므로 장부를 다시 만듦 (입금 기록이 없을 때만 여기 옴)
    await db.prepare('DELETE FROM charges WHERE tenant_id = ?').bind(t.id).run();
    const from = t.ledger_from > 0 ? Math.max(0, cycleOnOrBefore(moveIn, today)) : 0;
    await db.prepare('UPDATE tenants SET ledger_from = ? WHERE id = ?').bind(from, t.id).run();
    await ensureCharges(db, await tenantRow(db, t.id), today);
    await reallocate(db, t.id);
  }
  if (changes.length) await audit(db, admin, '정보 수정', changes.join(', '), { tenant: t.id, room: roomId });
  return json({ ok: true });
}
async function rentChange(env, admin, b) {
  const db = env.DB;
  const t = await tenantRow(db, b.id);
  const rent = man(b.rent, '월세', { min: 1, max: 1000 });
  const eff = dateOf(b.eff_date, '적용');
  if (rent === t.rent) bad('지금 월세와 같습니다');
  await db.prepare('INSERT INTO rent_changes (tenant_id, eff_date, old_rent, new_rent, by_name) VALUES (?, ?, ?, ?, ?)').bind(t.id, eff, t.rent, rent, admin.name).run();
  await db.prepare("UPDATE tenants SET rent = ?, updated_at = datetime('now') WHERE id = ?").bind(rent, t.id).run();
  let applied = 0;
  if (b.applyOpen) {
    // 이미 만들어졌지만 한 푼도 안 받은 납부분 중 적용일 이후 것에도 새 월세 적용
    const r = await db.prepare('UPDATE charges SET amount = ? WHERE tenant_id = ? AND due >= ? AND void = 0 AND id NOT IN (SELECT charge_id FROM allocations WHERE tenant_id = ?)').bind(rent, t.id, eff, t.id).run();
    applied = r.meta.changes;
    await reallocate(db, t.id);
  }
  await audit(db, admin, '월세 변경', manText(t.rent) + ' → ' + manText(rent) + ' (' + eff + '부터' + (applied ? ', 만들어진 미납분 ' + applied + '건에도 적용' : '') + ')', { tenant: t.id });
  return json({ ok: true });
}
async function checkin(env, admin, b) {
  const db = env.DB;
  const today = await todayOf(env);
  const t = await tenantRow(db, b.id);
  if (t.status !== 'reserved') bad('입실예정인 분만 입실 확인할 수 있습니다');
  const moveIn = dateOf(b.move_in || t.move_in, '입실일');
  if (moveIn > today) bad('입실일이 아직 오지 않았습니다. 실제 입실한 날로 바꿔 주세요');
  await db.prepare("UPDATE tenants SET status = 'in', move_in = ?, ledger_from = 0, updated_at = datetime('now') WHERE id = ?").bind(moveIn, t.id).run();
  const nt = await tenantRow(db, t.id);
  await ensureCharges(db, nt, today);
  await audit(db, admin, '입실 확인', '입실일 ' + moveIn, { tenant: t.id, room: t.room_id });
  if (b.firstPaid) {
    const amt = b.firstAmount != null && b.firstAmount !== '' ? man(b.firstAmount, '첫 달 입금액', { min: 0.01, max: 2000 }) : nt.rent;
    await addPayment(db, admin, nt, amt, moveIn, str(b.method, 10) || '계좌', '입실일 첫 달');
    await audit(db, admin, '입금', manText(amt) + ' · 입실일 첫 달', { tenant: t.id });
  }
  return json({ ok: true });
}
async function cancelReserve(env, admin, b) {
  const db = env.DB;
  const t = await tenantRow(db, b.id);
  if (t.status !== 'reserved') bad('입실예정인 분만 취소할 수 있습니다');
  await db.prepare("UPDATE tenants SET status = 'cancelled', out_date = ?, memo = TRIM(COALESCE(memo, '') || ' [입실 취소] ' || ?), updated_at = datetime('now') WHERE id = ?").bind(await todayOf(env), str(b.reason, 100), t.id).run();
  await audit(db, admin, '입실 취소', str(b.reason, 100), { tenant: t.id, room: t.room_id });
  return json({ ok: true });
}
async function leaving(env, admin, b) {
  const db = env.DB;
  const today = await todayOf(env);
  const t = await tenantRow(db, b.id);
  if (b.leave === false) {
    if (t.status !== 'leaving') bad('퇴실예정 상태가 아닙니다');
    await db.prepare("UPDATE tenants SET status = 'in', leave_date = NULL, updated_at = datetime('now') WHERE id = ?").bind(t.id).run();
    await db.prepare('UPDATE charges SET void = 0 WHERE tenant_id = ? AND void = 1').bind(t.id).run();
    await ensureCharges(db, await tenantRow(db, t.id), today);
    await reallocate(db, t.id);
    await audit(db, admin, '퇴실예정 취소 (계속 거주)', '', { tenant: t.id });
    return json({ ok: true });
  }
  if (t.status !== 'in' && t.status !== 'leaving') bad('입실 중인 분만 퇴실예정으로 바꿀 수 있습니다');
  const leaveDate = b.leave_date ? dateOf(b.leave_date, '퇴실예정일') : null;
  await db.prepare("UPDATE tenants SET status = 'leaving', leave_date = ?, updated_at = datetime('now') WHERE id = ?").bind(leaveDate, t.id).run();
  if (leaveDate) {
    // 퇴실예정일 이후 납부일은 낼 필요 없음
    await db.prepare('UPDATE charges SET void = 1 WHERE tenant_id = ? AND due >= ?').bind(t.id, leaveDate).run();
    await reallocate(db, t.id);
  }
  await audit(db, admin, '퇴실예정', leaveDate ? '퇴실예정일 ' + leaveDate : '날짜 미정', { tenant: t.id });
  return json({ ok: true });
}
async function checkoutPreview(env, id, outDate) {
  const db = env.DB;
  const t = await tenantRow(db, id);
  const d = dateOf(outDate, '퇴실일');
  const ch = ((await chargesOf(db, [t.id]))[t.id] || []).filter((c) => !c.void);
  const owedBefore = ch.filter((c) => c.due < d).reduce((a, c) => a + c.amount - c.paid, 0);
  const paidAfter = ch.filter((c) => c.due >= d).reduce((a, c) => a + c.paid, 0);
  return json({ ok: true, owed: owedBefore, refundable: (await creditOf(db, t.id)) + paidAfter, deposit: t.deposit });
}
async function checkout(env, admin, b) {
  const db = env.DB;
  const t = await tenantRow(db, b.id);
  if (t.status !== 'in' && t.status !== 'leaving') bad('입실 중인 분만 퇴실 처리할 수 있습니다');
  const outDate = dateOf(b.out_date, '퇴실일');
  if (outDate < t.move_in) bad('퇴실일이 입실일보다 빠릅니다');
  const refund = man(b.dep_refund, '보증금 반환액', { max: 10000 });
  const deduct = man(b.dep_deduct || 0, '보증금 공제액', { max: 10000 });
  if (refund + deduct > t.deposit) bad('반환액과 공제액의 합이 보증금(' + manText(t.deposit) + ')보다 큽니다');
  const note = str(b.dep_note, 200);
  if (deduct > 0 && !note) bad('공제 사유를 적어 주세요');
  await db.prepare('UPDATE charges SET void = 1 WHERE tenant_id = ? AND due >= ?').bind(t.id, outDate).run();
  await reallocate(db, t.id);
  // 보증금 공제액으로 미납 월세 충당 → 장부에 '보증금 공제' 입금으로 남김
  let fromDeposit = 0;
  if (b.dep_to_rent && deduct > 0) {
    const ch0 = ((await chargesOf(db, [t.id]))[t.id] || []).filter((c) => !c.void);
    const owed0 = ch0.reduce((a, c) => a + c.amount - c.paid, 0);
    fromDeposit = Math.min(deduct, owed0);
    if (fromDeposit > 0) await addPayment(db, admin, t, fromDeposit, outDate, '보증금 공제', '퇴실 시 보증금에서 미납 월세 충당');
  }
  await db.prepare("UPDATE tenants SET status = 'out', out_date = ?, dep_refund = ?, dep_deduct = ?, dep_note = ?, dep_done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(outDate, refund, deduct, note, t.id).run();
  const ch = ((await chargesOf(db, [t.id]))[t.id] || []).filter((c) => !c.void);
  const owed = ch.reduce((a, c) => a + c.amount - c.paid, 0);
  await audit(db, admin, '퇴실 처리', '퇴실일 ' + outDate + ' · 보증금 ' + manText(t.deposit) + ' 중 반환 ' + manText(refund) + (deduct ? ' · 공제 ' + manText(deduct) + ' (' + note + ')' : '') + (fromDeposit ? ' · 그중 ' + manText(fromDeposit) + ' 미납 월세 충당' : '') + (owed ? ' · 남은 미납 ' + manText(owed) : ''), { tenant: t.id, room: t.room_id });
  return json({ ok: true, owed });
}

/* ── 입금 ── */
async function pay(env, admin, b) {
  const db = env.DB;
  const t = await tenantRow(db, b.tenant_id);
  if (t.status === 'reserved' || t.status === 'cancelled') bad('입실 확인을 먼저 해 주세요');
  const amount = man(b.amount, '입금액', { min: 0.01, max: 5000 });
  const paidOn = dateOf(b.paid_on, '입금');
  if (paidOn > addDays(await todayOf(env), 0)) bad('입금일이 미래입니다');
  const method = ['계좌', '현금', '카드', '기타'].includes(b.method) ? b.method : '계좌'; // '보증금 공제'는 퇴실 처리에서만
  await addPayment(db, admin, t, amount, paidOn, method, str(b.memo, 100));
  await audit(db, admin, '입금', manText(amount) + ' · ' + paidOn + ' · ' + method + (b.memo ? ' · ' + str(b.memo, 100) : ''), { tenant: t.id });
  return json({ ok: true });
}
async function payCancel(env, admin, b) {
  const db = env.DB;
  const p = await db.prepare('SELECT * FROM payments WHERE id = ?').bind(Number(b.id)).first();
  if (!p) bad('입금 기록을 찾지 못했습니다');
  if (p.cancelled_at) bad('이미 취소된 입금입니다');
  const reason = str(b.reason, 100);
  if (!reason) bad('취소 사유를 적어 주세요');
  await db.prepare("UPDATE payments SET cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ?").bind(admin.name, reason, p.id).run();
  await reallocate(db, p.tenant_id);
  await audit(db, admin, '입금 취소', manText(p.amount) + ' (' + p.paid_on + ') · ' + reason, { tenant: p.tenant_id });
  return json({ ok: true });
}

/* ── 퇴실 기록 · 검색 · 이력 ── */
async function outList(env) {
  const db = env.DB;
  const { results } = await db.prepare("SELECT t.id, t.name, t.phone, t.status, t.move_in, t.out_date, t.rent, t.deposit, t.dep_refund, t.dep_deduct, t.dep_note, t.anon_at, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('out', 'cancelled') ORDER BY t.out_date DESC, t.id DESC LIMIT 300").all();
  const ch = await chargesOf(db, (results || []).map((t) => t.id));
  return json({ ok: true, list: (results || []).map((t) => Object.assign(t, { owed: (ch[t.id] || []).filter((c) => !c.void).reduce((a, c) => a + c.amount - c.paid, 0) })) });
}
async function search(env, q) {
  q = str(q, 20);
  if (!q) return json({ ok: true, list: [] });
  const digits = q.replace(/\D/g, '');
  const { results } = await env.DB
    .prepare("SELECT t.id, t.name, t.phone, t.status, t.move_in, t.out_date, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.name LIKE ?1 OR r.no LIKE ?1 OR (?2 != '' AND REPLACE(t.phone, '-', '') LIKE ?3) ORDER BY t.id DESC LIMIT 30")
    .bind('%' + q + '%', digits, '%' + digits + '%')
    .all();
  return json({ ok: true, list: results || [] });
}
async function auditList(env) {
  const { results } = await env.DB.prepare('SELECT a.at, a.who, a.action, a.detail, r.no AS room FROM audit a LEFT JOIN tenants t ON t.id = a.tenant_id LEFT JOIN rooms r ON r.id = COALESCE(a.room_id, t.room_id) ORDER BY a.id DESC LIMIT 100').all();
  return json({ ok: true, list: results || [] });
}

/* ── 설정 · 호실 관리 (최고 관리자) ── */
async function settingsGet(env) {
  return json({ ok: true, bizName: await getSetting(env.DB, 'bizName', '') });
}
async function settingsSave(env, admin, b) {
  if (b.bizName != null) await setSetting(env.DB, 'bizName', str(b.bizName, 30), admin.name);
  await audit(env.DB, admin, '설정 저장', '상호');
  return json({ ok: true });
}
async function roomSave(env, admin, b) {
  const db = env.DB;
  const no = str(b.no, 10);
  if (!no) bad('호실 번호를 입력해 주세요');
  const type = TYPES.includes(b.type) ? b.type : '';
  const kind = b.kind === 'office' ? 'office' : 'room';
  const repair = b.repair ? 1 : 0;
  const sort = Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0;
  if (b.id) {
    const r = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(Number(b.id)).first();
    if (!r) bad('호실을 찾지 못했습니다');
    const busy = await db.prepare("SELECT 1 AS x FROM tenants WHERE room_id = ? AND status IN ('reserved', 'in', 'leaving')").bind(r.id).first();
    if (busy && (kind === 'office' || repair)) bad('입실자가 있는 호실은 사무실·수리중으로 바꿀 수 없습니다');
    const dup = await db.prepare('SELECT 1 AS x FROM rooms WHERE no = ? AND id != ?').bind(no, r.id).first();
    if (dup) bad(no + '호가 이미 있습니다');
    await db.prepare('UPDATE rooms SET no = ?, type = ?, kind = ?, repair = ?, sort = ?, memo = ? WHERE id = ?').bind(no, type, kind, repair, sort, str(b.memo, 100), r.id).run();
    await audit(db, admin, '호실 수정', no + '호', { room: r.id });
  } else {
    const dup = await db.prepare('SELECT 1 AS x FROM rooms WHERE no = ?').bind(no).first();
    if (dup) bad(no + '호가 이미 있습니다');
    const r = await db.prepare('INSERT INTO rooms (no, type, kind, repair, sort, memo) VALUES (?, ?, ?, ?, ?, ?)').bind(no, type, kind, repair, sort, str(b.memo, 100)).run();
    await audit(db, admin, '호실 추가', no + '호', { room: r.meta.last_row_id });
  }
  return json({ ok: true });
}
async function roomDelete(env, admin, b) {
  const db = env.DB;
  const r = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(Number(b.id)).first();
  if (!r) bad('호실을 찾지 못했습니다');
  const any = await db.prepare('SELECT 1 AS x FROM tenants WHERE room_id = ? LIMIT 1').bind(r.id).first();
  if (any) bad('입실 기록이 있는 호실은 지울 수 없습니다 (기록 보존)');
  await db.prepare('DELETE FROM rooms WHERE id = ?').bind(r.id).run();
  await audit(db, admin, '호실 삭제', r.no + '호');
  return json({ ok: true });
}

/* ── 자동 문자 ── */
function phoneList(v) {
  const arr = (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map((x) => x.trim()).filter(Boolean).slice(0, 5);
  return arr.map(phoneOf);
}
async function smsStatus(env) {
  const db = env.DB;
  const today = await todayOf(env);
  await ensureToday(env, today);
  const cfg = await smsSettings(db);
  const items = await planSms(db, today, cfg);
  const { results: log } = await db.prepare('SELECT l.id, l.kind, l.to_phone, l.text, l.status, l.tries, l.msg_type, l.cost, l.err, l.created_at, l.updated_at, l.tenant_id, t.name, r.no AS room FROM sms_log l LEFT JOIN tenants t ON t.id = l.tenant_id LEFT JOIN rooms r ON r.id = t.room_id ORDER BY l.id DESC LIMIT 60').all();
  const { results: runs } = await db.prepare('SELECT id, day, at, trigger, mode, planned, sent, failed, blocked, note FROM runs ORDER BY id DESC LIMIT 15').all();
  const month = today.slice(0, 7);
  const m = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost), 0) AS cost FROM sms_log WHERE status = 'sent' AND strftime('%Y-%m', updated_at, '+9 hours') = ?").bind(month).first();
  const attention = (log || []).filter((l) => l.status === 'unknown' || (l.status === 'failed' && l.tries >= 2)).length;
  return json({
    ok: true, today,
    mode: cfg.stop ? 'stopped' : cfg.testMode ? 'test' : 'live',
    cfg: { senderPhone: cfg.senderPhone, account: cfg.account, opPhones: cfg.opPhones, windowStart: cfg.windowStart, windowEnd: cfg.windowEnd, solapi: !!(env.SOLAPI_KEY && env.SOLAPI_SECRET) || env.SMS_MOCK === '1' },
    plan: items.map((i) => ({ room: i.room, name: i.name, kind: i.kind, kindName: KINDS[i.kind].name, to: i.to, due: i.due, text: i.text, type: i.type, blocked: i.blocked, retry: !!i.retryOf, tenant_id: i.tenant_id })),
    estimate: items.filter((i) => !i.blocked).reduce((a, i) => a + PRICE[i.type], 0),
    month: { count: m.n, cost: m.cost }, attention, log: log || [], runs: runs || []
  });
}
async function smsSettingsGet(env) {
  const cfg = await smsSettings(env.DB);
  return json({ ok: true, cfg, kinds: KINDS, defaults: DEFAULT_TEMPLATES, solapi: !!(env.SOLAPI_KEY && env.SOLAPI_SECRET) || env.SMS_MOCK === '1' });
}
async function smsSettingsSave(env, admin, b) {
  const db = env.DB;
  const cur = await smsSettings(db);
  const next = Object.assign({}, cur);
  if (b.senderPhone != null) next.senderPhone = b.senderPhone ? phoneOf(b.senderPhone) : '';
  if (b.testPhone != null) next.testPhone = b.testPhone ? phoneOf(b.testPhone) : '';
  if (b.opPhones != null) next.opPhones = phoneList(b.opPhones);
  if (b.account != null) next.account = str(b.account, 80);
  if (b.windowStart != null) {
    const a = Number(b.windowStart), z = Number(b.windowEnd);
    if (!(a >= 7 && a <= 12 && z >= a + 1 && z <= 21)) bad('발송 시간대는 오전 7~12시 시작, 밤 9시 전에 끝나게 정해 주세요');
    next.windowStart = a; next.windowEnd = z;
  }
  if (b.templates) {
    next.templates = Object.assign({}, cur.templates);
    for (const k of Object.keys(DEFAULT_TEMPLATES)) if (b.templates[k] != null) {
      const t = String(b.templates[k]).slice(0, 1000).trim();
      next.templates[k] = t || DEFAULT_TEMPLATES[k];
    }
  }
  const changes = [];
  if (b.testMode != null && !!b.testMode !== cur.testMode) {
    if (!b.testMode) {
      if (!(env.SOLAPI_KEY && env.SOLAPI_SECRET) && env.SMS_MOCK !== '1') bad('솔라피 키가 아직 없어 실제 발송으로 바꿀 수 없습니다');
      if (!next.senderPhone) bad('발신번호를 먼저 입력해 주세요');
    }
    next.testMode = !!b.testMode;
    changes.push(b.testMode ? '테스트 모드 켬' : '⚠️ 실제 발송 시작');
  }
  await setSetting(db, 'sms', next, admin.name);
  await audit(db, admin, '문자 설정 저장', changes.join(', ') || '번호·계좌·문구');
  return json({ ok: true });
}
async function smsStop(env, admin, b) {
  const cfg = await smsSettings(env.DB);
  cfg.stop = !!b.stop;
  await setSetting(env.DB, 'sms', cfg, admin.name);
  await audit(env.DB, admin, b.stop ? '⛔ 자동 문자 긴급 정지' : '자동 문자 다시 시작', '');
  return json({ ok: true });
}
async function smsRun(env, admin) {
  const cfg = await smsSettings(env.DB);
  if (!cfg.testMode && !cfg.stop && admin.role !== 'owner') bad('실제 발송 모드에서는 최고 관리자만 수동 실행할 수 있습니다');
  const r = await runSms(env, { trigger: 'manual', today: await todayOf(env), admin });
  return json({ ok: true, result: { mode: r.mode, planned: r.planned, sent: r.sent || 0, failed: r.failed || 0, blocked: r.blocked || 0, skipped: r.skipped } });
}
// '결과 확인 필요' · 재시도 다 쓴 실패 처리: 실제로 갔으면 sent, 다시 보내려면 resend(다음 실행 때 1번)
async function smsResolve(env, admin, b) {
  const db = env.DB;
  const l = await db.prepare('SELECT * FROM sms_log WHERE id = ?').bind(Number(b.id)).first();
  if (!l) bad('기록을 찾지 못했습니다');
  if (!['unknown', 'failed'].includes(l.status)) bad('확인할 필요가 없는 기록입니다');
  if (b.result === 'sent') await db.prepare("UPDATE sms_log SET status = 'sent', err = COALESCE(err, '') || ' → 관리자 확인: 보내짐', updated_at = datetime('now') WHERE id = ?").bind(l.id).run();
  else if (b.result === 'resend') await db.prepare("UPDATE sms_log SET status = 'failed', tries = 1, err = COALESCE(err, '') || ' → 관리자: 다시 보내기', updated_at = datetime('now') WHERE id = ?").bind(l.id).run();
  else if (b.result === 'drop') await db.prepare("UPDATE sms_log SET status = 'cancelled', err = COALESCE(err, '') || ' → 관리자: 보내지 않음', updated_at = datetime('now') WHERE id = ?").bind(l.id).run();
  else bad('처리 방법을 골라 주세요');
  await audit(db, admin, '문자 결과 처리', ({ sent: '보내짐으로', resend: '다시 보내기', drop: '보내지 않음' })[b.result], { tenant: l.tenant_id || null });
  return json({ ok: true });
}
async function smsPreview(env, b) {
  const cfg = await smsSettings(env.DB);
  const biz = (await getSetting(env.DB, 'bizName', '')) || '';
  const due = addDays(await todayOf(env), 10);
  const v = { 상호: biz, 호실: '301', 이름: '홍길동', 납부일: mdw(due), 금액: '32만원', 남은금액: '32만원', 계좌: str(b.account, 80) || cfg.account || '(계좌 문구)', 퇴실통보일: mdw(addDays(due, -7)), 입실일: mdw(await todayOf(env)), 월세: '32만원', 보증금: '50만원', 경과일: 3 };
  const text = render(str(b.text, 1000) || DEFAULT_TEMPLATES[b.kind] || '', v);
  return json({ ok: true, text, bytes: bytes(text), type: typeOf(text) });
}

/* ── 입구 ── */
const OWNER_ONLY = new Set(['invite', 'admin/active', 'settings', 'room/save', 'room/delete', 'admins', 'sms/settings']);
export async function handleApi(request, env, path) {
  const db = env.DB;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (request.method === 'POST' && origin && origin !== url.origin) return fail('허용되지 않은 요청입니다', 403);
  try {
    if (request.method === 'GET' && path === 'me') return await me(env, request);
    if (request.method === 'POST') {
      let b;
      try { b = await readBody(request); } catch (e) { return fail('요청 형식이 맞지 않습니다', 415); }
      if (path === 'setup') return await setup(env, request, b);
      if (path === 'login') return await login(env, request, b);
      if (path === 'invite/accept') return await inviteAccept(env, request, b);
      if (path === 'logout') { await deleteSession(db, request); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(request) }); }
      const admin = await currentAdmin(db, request);
      if (!admin) return fail('다시 로그인해 주세요', 401);
      if (OWNER_ONLY.has(path) && admin.role !== 'owner') return fail('최고 관리자만 할 수 있습니다', 403);
      if (path === 'tenant/create') return await tenantCreate(env, admin, b);
      if (path === 'tenant/update') return await tenantUpdate(env, admin, b);
      if (path === 'tenant/rent') return await rentChange(env, admin, b);
      if (path === 'tenant/checkin') return await checkin(env, admin, b);
      if (path === 'tenant/cancel') return await cancelReserve(env, admin, b);
      if (path === 'tenant/leaving') return await leaving(env, admin, b);
      if (path === 'tenant/checkout') return await checkout(env, admin, b);
      if (path === 'pay') return await pay(env, admin, b);
      if (path === 'pay/cancel') return await payCancel(env, admin, b);
      if (path === 'invite') return await inviteCreate(env, admin, b);
      if (path === 'admin/active') return await adminActive(env, admin, b);
      if (path === 'password') return await password(env, admin, b);
      if (path === 'settings') return await settingsSave(env, admin, b);
      if (path === 'room/save') return await roomSave(env, admin, b);
      if (path === 'room/delete') return await roomDelete(env, admin, b);
      if (path === 'sms/settings') return await smsSettingsSave(env, admin, b);
      if (path === 'sms/stop') return await smsStop(env, admin, b);
      if (path === 'sms/run') return await smsRun(env, admin);
      if (path === 'sms/resolve') return await smsResolve(env, admin, b);
      if (path === 'sms/preview') return await smsPreview(env, b);
      if (path === 'dev/today' && env.DEV === '1') { await setSetting(db, 'dev_today', b.date ? dateOf(b.date, '시험') : null); return json({ ok: true }); }
      return fail('없는 기능입니다', 404);
    }
    if (request.method === 'GET') {
      const admin = await currentAdmin(db, request);
      if (!admin) return fail('다시 로그인해 주세요', 401);
      if (OWNER_ONLY.has(path) && admin.role !== 'owner') return fail('최고 관리자만 볼 수 있습니다', 403);
      const q = url.searchParams;
      if (path === 'dash') return await dash(env);
      if (path === 'rooms') return await roomsGet(env);
      if (path === 'tenant') return await tenantGet(env, q.get('id'));
      if (path === 'checkout/preview') return await checkoutPreview(env, q.get('id'), q.get('out_date'));
      if (path === 'out') return await outList(env);
      if (path === 'search') return await search(env, q.get('q'));
      if (path === 'audit') return await auditList(env);
      if (path === 'admins') return await adminsGet(env);
      if (path === 'settings') return await settingsGet(env);
      if (path === 'sms') return await smsStatus(env);
      if (path === 'sms/settings') return await smsSettingsGet(env);
      return fail('없는 기능입니다', 404);
    }
    return fail('없는 기능입니다', 404);
  } catch (e) {
    if (e instanceof Bad) return fail(e.message);
    console.log('api error', path, e && e.stack);
    return fail('처리하지 못했습니다. 잠시 후 다시 시도해 주세요', 500);
  }
}
