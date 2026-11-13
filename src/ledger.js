/* 장부 – 납부 예정분 만들기, 입금 배정, 입실자별 상태 */
import { addDays, tenantDue, tenantIndex } from './dates.js';
import { allocate, ledgerStatus } from './ledger-core.js';

export const LEAD_DAYS = 10; // 납부일 10일 전에 납부 예정분을 만듦 (D-10 문자와 같은 날)
const ACTIVE = "('in', 'leaving')";

/* 납부 예정분 만들기: 입실·퇴실예정인 사람만, 오늘+10일 안에 오는 납부일까지.
   퇴실예정일이 정해져 있으면 그 날짜 이후 납부일은 만들지 않음 */
export async function ensureCharges(db, t, today) {
  if (t.status !== 'in' && t.status !== 'leaving') return 0;
  const last = await db.prepare('SELECT MAX(k) AS k FROM charges WHERE tenant_id = ?').bind(t.id).first();
  let k = Math.max(last && last.k != null ? last.k + 1 : 0, t.ledger_from || 0);
  const limit = addDays(today, LEAD_DAYS);
  const stmts = [];
  for (let n = 0; n < 36; n++, k++) {
    const due = tenantDue(t, k);
    if (due > limit) break;
    if (t.leave_date && due >= t.leave_date) break;
    stmts.push(db.prepare('INSERT OR IGNORE INTO charges (tenant_id, k, due, amount) VALUES (?, ?, ?, ?)').bind(t.id, k, due, t.rent));
  }
  if (stmts.length) { await db.batch(stmts); await reallocate(db, t.id); }
  return stmts.length;
}

// 하루 한 번(또는 관리자가 화면을 열 때) 전체 입실자 확인
export async function ensureAll(db, today) {
  const { results } = await db.prepare('SELECT * FROM tenants WHERE status IN ' + ACTIVE).all();
  let n = 0;
  for (const t of results || []) n += await ensureCharges(db, t, today);
  return n;
}

// 입금 배정 다시 계산 (입금·입금 취소·납부분 추가·퇴실 때)
export async function reallocate(db, tenantId) {
  const { results: charges } = await db.prepare('SELECT id, due, amount, void FROM charges WHERE tenant_id = ?').bind(tenantId).all();
  const { results: pays } = await db.prepare('SELECT id, paid_on, amount FROM payments WHERE tenant_id = ? AND cancelled_at IS NULL').bind(tenantId).all();
  const { alloc } = allocate(charges || [], pays || []);
  await db.batch([
    db.prepare('DELETE FROM allocations WHERE tenant_id = ?').bind(tenantId),
    ...alloc.map(([p, c, a]) => db.prepare('INSERT INTO allocations (tenant_id, payment_id, charge_id, amount) VALUES (?, ?, ?, ?)').bind(tenantId, p, c, a))
  ]);
}

// 입실자 장부 (납부분별 받은 금액 포함)
export async function chargesOf(db, tenantIds) {
  if (!tenantIds.length) return {};
  const out = {};
  for (let i = 0; i < tenantIds.length; i += 50) {
    const ids = tenantIds.slice(i, i + 50);
    const { results } = await db
      .prepare('SELECT c.id, c.tenant_id, c.k, c.due, c.amount, c.void, COALESCE(SUM(a.amount), 0) AS paid FROM charges c LEFT JOIN allocations a ON a.charge_id = c.id WHERE c.tenant_id IN (' + ids.map(() => '?').join(',') + ') GROUP BY c.id ORDER BY c.due')
      .bind(...ids)
      .all();
    for (const r of results || []) (out[r.tenant_id] = out[r.tenant_id] || []).push(r);
  }
  return out;
}
export async function creditOf(db, tenantId) {
  const r = await db.prepare('SELECT (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = ?1 AND cancelled_at IS NULL) - (SELECT COALESCE(SUM(amount), 0) FROM allocations WHERE tenant_id = ?1) AS credit').bind(tenantId).first();
  return r ? r.credit : 0;
}
export function statusOf(t, charges, today) {
  const s = ledgerStatus(charges || [], today);
  // 다음 납부일: 아직 안 받은 가장 오래된 납부일, 다 받았으면 다음 회차
  const k = tenantIndex(t, today);
  s.nextDue = s.due || tenantDue(t, Math.max(k + 1, t.ledger_from || 0, (charges && charges.length ? charges[charges.length - 1].k + 1 : 0)));
  return s;
}
