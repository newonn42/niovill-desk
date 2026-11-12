/* 백업 · 복구 · CSV 내보내기 · 보관 기간 정리 */
import { getSetting, audit } from './db.js';
import { addDays } from './dates.js';
import { chargesOf } from './ledger.js';
import { enqueue } from './notion.js';

// 보관 기간 (개인정보처리방침과 같아야 함)
export const KEEP = { identityYears: 3, ledgerYears: 5, auditYears: 2, runDetailDays: 365 };
const TABLES = ['rooms', 'tenants', 'charges', 'payments', 'allocations', 'rent_changes', 'sms_log', 'runs', 'audit'];
const SKIP_SETTINGS = new Set(['dev_today', 'ensured', 'balanceCache']);

export async function backupJson(env) {
  const db = env.DB;
  const out = { kind: 'desk-backup', v: 1, at: new Date().toISOString(), tables: {}, settings: {} };
  for (const t of TABLES) out.tables[t] = (await db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all()).results || [];
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  for (const r of results || []) if (!SKIP_SETTINGS.has(r.key)) out.settings[r.key] = r.value;
  return out;
}
const COLS = {};
async function colsOf(db, t) {
  if (!COLS[t]) COLS[t] = ((await db.prepare('PRAGMA table_info(' + t + ')').all()).results || []).map((c) => c.name);
  return COLS[t];
}
export async function restoreJson(env, data) {
  const db = env.DB;
  if (!data || data.kind !== 'desk-backup' || !data.tables) throw new Error('이 프로그램의 백업 파일이 아닙니다');
  for (const t of TABLES) if (!Array.isArray(data.tables[t])) throw new Error('백업 파일에 ' + t + ' 표가 없습니다');
  const stmts = [];
  for (const t of TABLES.slice().reverse()) stmts.push(db.prepare('DELETE FROM ' + t));
  await db.batch(stmts);
  const counts = {};
  for (const t of TABLES) {
    const cols = await colsOf(db, t);
    const rows = data.tables[t];
    for (let i = 0; i < rows.length; i += 50) {
      await db.batch(rows.slice(i, i + 50).map((r) => {
        const cs = cols.filter((c) => r[c] !== undefined);
        return db.prepare('INSERT INTO ' + t + ' (' + cs.join(', ') + ') VALUES (' + cs.map(() => '?').join(', ') + ')').bind(...cs.map((c) => r[c]));
      }));
    }
    counts[t] = rows.length;
  }
  for (const [k, v] of Object.entries(data.settings || {})) {
    if (SKIP_SETTINGS.has(k)) continue;
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(k, typeof v === 'string' ? v : JSON.stringify(v)).run();
  }
  await db.prepare("DELETE FROM settings WHERE key = 'ensured'").run();
  return counts;
}

/* CSV (엑셀에서 바로 열리게 BOM 포함) */
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const man = (won) => (won == null ? '' : Math.round(won / 1000) / 10);
const STATUS = { reserved: '입실예정', in: '입실', leaving: '퇴실예정', out: '퇴실', cancelled: '입실 취소' };
export async function exportCsv(env, what, today) {
  const db = env.DB;
  let head, rows;
  if (what === 'tenants') {
    const { results } = await db.prepare('SELECT t.*, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id ORDER BY r.sort, r.no, t.id').all();
    const ch = await chargesOf(db, (results || []).map((t) => t.id));
    head = ['호실', '이름', '전화', '상태', '입실일', '퇴실예정일', '퇴실일', '월세(만원)', '보증금(만원)', '미납(만원)', '성별', '현금영수증', '문자 제외', '보증금 반환', '보증금 공제', '공제 사유', '비고'];
    rows = (results || []).map((t) => [t.room, t.name, t.phone, STATUS[t.status], t.move_in, t.leave_date, t.out_date, man(t.rent), man(t.deposit),
      man((ch[t.id] || []).filter((c) => !c.void && c.due <= today).reduce((a, c) => a + c.amount - c.paid, 0)), t.gender, t.cash_receipt ? 'O' : '', t.sms_off ? 'O' : '', man(t.dep_refund), man(t.dep_deduct), t.dep_note, t.memo]);
  } else if (what === 'arrears') {
    const { results } = await db.prepare("SELECT c.due, c.amount, COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.charge_id = c.id), 0) AS paid, t.name, t.phone, t.status, r.no AS room FROM charges c JOIN tenants t ON t.id = c.tenant_id JOIN rooms r ON r.id = t.room_id WHERE c.void = 0 AND c.due <= ? ORDER BY r.no, c.due").bind(today).all();
    head = ['호실', '이름', '전화', '상태', '납부일', '금액(만원)', '받음(만원)', '미납(만원)', '경과일'];
    rows = (results || []).filter((c) => c.paid < c.amount).map((c) => [c.room, c.name, c.phone, STATUS[c.status], c.due, man(c.amount), man(c.paid), man(c.amount - c.paid), Math.round((Date.parse(today) - Date.parse(c.due)) / 86400000)]);
  } else if (what === 'payments') {
    const { results } = await db.prepare('SELECT p.*, t.name, r.no AS room FROM payments p JOIN tenants t ON t.id = p.tenant_id JOIN rooms r ON r.id = t.room_id ORDER BY p.paid_on, p.id').all();
    head = ['입금일', '호실', '이름', '금액(만원)', '방법', '메모', '처리자', '취소', '취소 사유'];
    rows = (results || []).map((p) => [p.paid_on, p.room, p.name, man(p.amount), p.method, p.memo, p.by_name, p.cancelled_at ? 'O' : '', p.cancel_reason]);
  } else if (what === 'sms') {
    const { results } = await db.prepare('SELECT l.*, t.name, r.no AS room FROM sms_log l LEFT JOIN tenants t ON t.id = l.tenant_id LEFT JOIN rooms r ON r.id = t.room_id ORDER BY l.id').all();
    head = ['시각(UTC)', '호실', '이름', '종류', '받는 번호', '상태', '종류(SMS/LMS)', '비용(원)', '오류', '내용'];
    rows = (results || []).map((l) => [l.updated_at, l.room, l.name, l.kind, l.to_phone, l.status, l.msg_type, l.cost, l.err, l.text]);
  } else throw new Error('없는 항목');
  const body = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const names = { tenants: '입실자', arrears: '미납현황', payments: '입금내역', sms: '문자기록' };
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(names[what] + '-' + today + '.csv'), 'Cache-Control': 'no-store' } });
}

/* 보관 기간 정리 (매일): 퇴실 3년 → 이름·전화·마스터·비고 지움, 5년 → 장부 삭제, 변경 이력 2년 */
export async function retention(env, today) {
  const db = env.DB;
  const y = (n) => addDays(today, -Math.round(365.25 * n));
  const { results: anon } = await db.prepare("SELECT t.id, t.name, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('out', 'cancelled') AND t.anon_at IS NULL AND t.out_date IS NOT NULL AND t.out_date < ?").bind(y(KEEP.identityYears)).all();
  for (const t of anon || []) {
    await db.batch([
      db.prepare("UPDATE tenants SET name = '(퇴실자)', phone = '', master = '', memo = '', dep_note = '', anon_at = datetime('now') WHERE id = ?").bind(t.id),
      db.prepare("UPDATE sms_log SET text = '(삭제됨)', to_phone = '' WHERE tenant_id = ? AND slot = 'T'").bind(t.id),
      db.prepare("UPDATE sms_log SET text = '(삭제됨)' WHERE tenant_id = ? AND slot != 'T'").bind(t.id),
      db.prepare("UPDATE audit SET detail = REPLACE(COALESCE(detail, ''), ?, '(퇴실자)') WHERE tenant_id = ?").bind(t.name, t.id),
      db.prepare("UPDATE payments SET memo = '' WHERE tenant_id = ?").bind(t.id)
    ]);
    await enqueue(db, 'out', t.id);
  }
  const { results: old } = await db.prepare("SELECT id FROM tenants WHERE status IN ('out', 'cancelled') AND out_date IS NOT NULL AND out_date < ?").bind(y(KEEP.ledgerYears)).all();
  for (const t of old || []) {
    await db.batch([
      db.prepare('DELETE FROM allocations WHERE tenant_id = ?').bind(t.id), db.prepare('DELETE FROM charges WHERE tenant_id = ?').bind(t.id),
      db.prepare('DELETE FROM payments WHERE tenant_id = ?').bind(t.id), db.prepare('DELETE FROM rent_changes WHERE tenant_id = ?').bind(t.id),
      db.prepare('DELETE FROM sms_log WHERE tenant_id = ?').bind(t.id)
    ]);
  }
  const a = await db.prepare("DELETE FROM audit WHERE at < datetime('now', ?)").bind('-' + KEEP.auditYears + ' years').run();
  await db.prepare("UPDATE runs SET detail = NULL WHERE detail IS NOT NULL AND at < datetime('now', ?)").bind('-' + KEEP.runDetailDays + ' days').run();
  if ((anon || []).length || (old || []).length) await audit(db, null, '보관 기간 정리', '익명화 ' + (anon || []).length + '명 · 장부 삭제 ' + (old || []).length + '명 · 이력 삭제 ' + ((a.meta && a.meta.changes) || 0) + '건');
  return { anonymized: (anon || []).length, ledgerDeleted: (old || []).length };
}
