/* 데이터베이스 표 (처음 열릴 때 스스로 만듦) */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS login_fails (k TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created_by INTEGER NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // 호실: kind room(일반) | office(사무실), repair 1 = 수리중. '사용/공실'은 현재 입실자로 판단
  `CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, no TEXT NOT NULL UNIQUE, type TEXT, kind TEXT NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'office')),
    repair INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, memo TEXT, notion_id TEXT)`,
  // 입실자: reserved 입실예정 · in 입실 · leaving 퇴실예정 · out 퇴실 · cancelled 입실 취소
  // 금액은 모두 원 단위. ledger_from = 장부를 시작한 납부 회차(0 = 입실일)
  `CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
    move_in TEXT NOT NULL, rent INTEGER NOT NULL, deposit INTEGER NOT NULL DEFAULT 0, gender TEXT, master TEXT, cash_receipt INTEGER NOT NULL DEFAULT 0,
    memo TEXT, sms_off INTEGER NOT NULL DEFAULT 0, notion_off INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'in', 'leaving', 'out', 'cancelled')),
    ledger_from INTEGER NOT NULL DEFAULT 0, leave_date TEXT, out_date TEXT,
    cycle TEXT NOT NULL DEFAULT 'month', anchor TEXT, k_base INTEGER NOT NULL DEFAULT 0,
    dep_refund INTEGER, dep_deduct INTEGER, dep_note TEXT, dep_done_at TEXT,
    anon_at TEXT, notion_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS tenants_room ON tenants (room_id, status)`,
  // 납부 예정분 (회차별 1개, 만들어질 때의 월세로 금액 고정)
  `CREATE TABLE IF NOT EXISTS charges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, k INTEGER NOT NULL, due TEXT NOT NULL, amount INTEGER NOT NULL,
    void INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (tenant_id, k))`,
  // 입금 내역 (지우지 않고 취소 기록)
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, paid_on TEXT NOT NULL, amount INTEGER NOT NULL,
    method TEXT, memo TEXT, by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), cancelled_at TEXT, cancelled_by TEXT, cancel_reason TEXT)`,
  // 입금 배정 (어느 입금을 어느 납부분에 얼마) – 입금·취소 때마다 다시 계산
  `CREATE TABLE IF NOT EXISTS allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, payment_id INTEGER NOT NULL, charge_id INTEGER NOT NULL, amount INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS alloc_tenant ON allocations (tenant_id)`,
  `CREATE TABLE IF NOT EXISTS rent_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, eff_date TEXT NOT NULL, old_rent INTEGER NOT NULL, new_rent INTEGER NOT NULL,
    by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // 문자 기록: 같은 입실자·같은 납부분·같은 종류·같은 받는 쪽(slot)은 한 번만 (보내기 전에 먼저 기록)
  // status: pending 대기 · sending 요청 중 · sent 성공 · failed 실패 · unknown 결과 확인 필요 · cancelled 취소
  `CREATE TABLE IF NOT EXISTS sms_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL DEFAULT 0, charge_id INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL, slot TEXT NOT NULL DEFAULT 'T',
    to_phone TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, msg_type TEXT, cost INTEGER, msg_id TEXT, group_id TEXT, err TEXT, run_id INTEGER, by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (tenant_id, charge_id, kind, slot))`,
  `CREATE INDEX IF NOT EXISTS sms_tenant ON sms_log (tenant_id, id)`,
  // 실행 기록 (매일 09:00 자동 · 관리자 수동)
  `CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), trigger TEXT NOT NULL, mode TEXT NOT NULL,
    planned INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, note TEXT, detail TEXT)`,
  // 노션 동기화 대기열 (kind: room = 입실자 현황 한 줄, out = 퇴실 기록 한 줄)
  `CREATE TABLE IF NOT EXISTS notion_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, last_err TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notion_q_open ON notion_queue (kind, ref_id) WHERE done_at IS NULL`,
  // 변경 이력
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), admin_id INTEGER, who TEXT, action TEXT NOT NULL, detail TEXT, tenant_id INTEGER, room_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS audit_tenant ON audit (tenant_id)`
];
// 나중에 추가한 칸 (이미 설치된 데이터베이스용)
const ADD_COLUMNS = [
  ['tenants', 'notion_off', "INTEGER NOT NULL DEFAULT 0"],
  ['tenants', 'cycle', "TEXT NOT NULL DEFAULT 'month'"],
  ['tenants', 'anchor', 'TEXT'],
  ['tenants', 'k_base', 'INTEGER NOT NULL DEFAULT 0']
];
let ready = false;
export async function ensureSchema(db) {
  if (ready || !db) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  for (const [t, c, def] of ADD_COLUMNS) {
    const cols = ((await db.prepare('PRAGMA table_info(' + t + ')').all()).results || []).map((x) => x.name);
    if (!cols.includes(c)) await db.prepare('ALTER TABLE ' + t + ' ADD COLUMN ' + c + ' ' + def).run();
  }
  ready = true;
}
export async function getSetting(db, key, fallback = null) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch (e) { return fallback; }
}
export async function setSetting(db, key, value, by = null) {
  await db.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), by).run();
}
export async function audit(db, admin, action, detail = '', ids = {}) {
  await db.prepare('INSERT INTO audit (admin_id, who, action, detail, tenant_id, room_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(admin ? admin.id : null, admin ? admin.name : '자동', action, String(detail || '').slice(0, 300), ids.tenant || null, ids.room || null).run();
}
