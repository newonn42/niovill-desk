/* 자동 문자 – 대상 계산 · 문구 · 발송 · 기록 */
import { getSetting, setSetting, audit } from './db.js';
import { diffDays, addDays, kstToday } from './dates.js';
import { ensureAll, chargesOf } from './ledger.js';
import { sendOne } from './sender.js';
import { enqueue } from './notion.js';

// 종류: 보내는 기간(납부일 기준 일수, 시작~끝 – 끝까지는 놓친 날 보완)
export const KINDS = {
  d10: { name: 'D-10 납부 예정·퇴실 확인', from: -10, to: -8 },
  d1: { name: 'D-1 납부 안내', from: -1, to: 0, needAccount: true },
  dp1: { name: 'D+1 1차 미납 안내', from: 1, to: 2, needAccount: true },
  dp3: { name: 'D+3 2차 미납 안내', from: 3, to: 5, needAccount: true },
  op3: { name: '운영자: 미납 전화 확인', operator: true },
  opin: { name: '운영자: 입실 확인', operator: true }
};
export const DEFAULT_TEMPLATES = {
  d10: '[{상호}] {이름}님, 다음 입실료 납부일은 {납부일}, 금액은 {금액}입니다.\n퇴실 예정이시면 {퇴실통보일}까지 이 번호로 답장 부탁드립니다. 연락이 없으시면 연장으로 안내드립니다.\n※ 퇴실 7일 전까지 미통보 시 보증금은 반환되지 않습니다.',
  d1: '[{상호}] {이름}님, {납부일}은 입실료 납부일입니다.\n금액: {남은금액}\n입금계좌: {계좌}\n입금 확인 후 현금영수증을 발송해 드립니다.',
  dp1: '[{상호}] {이름}님, {납부일} 입실료({남은금액})가 아직 확인되지 않았습니다.\n입금계좌: {계좌}\n이미 입금하셨다면 이 문자는 무시해 주세요.',
  dp3: '[{상호}] {이름}님, {납부일} 입실료({남은금액})가 아직 확인되지 않아 다시 안내드립니다.\n입금계좌: {계좌}\n사정이 있으시면 이 번호로 연락 부탁드립니다.',
  op3: '[미납] {호실}호 {이름} {남은금액} ({납부일}분, D+{경과일}) — 전화 확인 필요',
  opin: '[입실 확인] {호실}호 {이름} 입실일 {입실일} — 관리 화면에서 [입실 확인]을 눌러 주세요'
};
export const DEFAULTS = { senderPhone: '', testPhone: '', opPhones: [], account: '', windowStart: 9, windowEnd: 20, testMode: true, stop: false, templates: DEFAULT_TEMPLATES };

export async function smsSettings(db) {
  const s = await getSetting(db, 'sms', {});
  const out = Object.assign({}, DEFAULTS, s || {});
  out.templates = Object.assign({}, DEFAULT_TEMPLATES, (s && s.templates) || {});
  return out;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function mdw(d) {
  const p = d.split('-').map(Number);
  return p[1] + '월 ' + p[2] + '일(' + WD[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ')';
}
export function manText(won) {
  return (Math.round(won / 1000) / 10).toLocaleString('ko-KR') + '만원';
}
export function render(tpl, v) {
  return String(tpl).replace(/\{([가-힣a-zA-Z]+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
}
// 한글 2바이트 기준 길이 (90바이트 넘으면 장문 LMS)
export function bytes(text) {
  let n = 0;
  for (const ch of text) n += ch.charCodeAt(0) > 127 ? 2 : 1;
  return n;
}
export const MAX_SENDS = 35;
export const PRICE = { SMS: 18, LMS: 45 }; // 원, 부가세 별도 (솔라피 요금표)
export function typeOf(text) { return bytes(text) > 90 ? 'LMS' : 'SMS'; }

/* 오늘 보낼 문자 목록 (보내지는 않음) */
export async function planSms(db, today, cfg) {
  const biz = (await getSetting(db, 'bizName', '')) || '';
  const { results: ts } = await db.prepare("SELECT t.*, r.no AS room FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.status IN ('in', 'reserved') AND t.anon_at IS NULL").all();
  const live = (ts || []).filter((t) => t.status === 'in');
  const ch = await chargesOf(db, live.map((t) => t.id));
  const { results: logs } = await db.prepare("SELECT id, tenant_id, charge_id, kind, slot, status, tries FROM sms_log WHERE created_at > datetime('now', '-120 days') OR status IN ('failed', 'pending', 'sending')").all();
  const logBy = {};
  for (const l of logs || []) logBy[l.tenant_id + ':' + l.charge_id + ':' + l.kind + ':' + l.slot] = l;
  const items = [];
  const push = (it) => {
    const prev = logBy[it.tenant_id + ':' + it.charge_id + ':' + it.kind + ':' + it.slot];
    if (prev && !(prev.status === 'failed' && prev.tries < 2)) return; // 이미 보냄 (실패 1번은 다시)
    it.retryOf = prev ? prev.id : null;
    it.type = typeOf(it.text);
    items.push(it);
  };
  for (const t of live) {
    if (t.sms_off) continue;
    const open = (ch[t.id] || []).filter((c) => !c.void && c.paid < c.amount);
    for (const c of open) {
      const off = diffDays(today, c.due);
      for (const kind of ['dp3', 'dp1', 'd1', 'd10']) {
        const K = KINDS[kind];
        if (off < K.from || off > K.to) continue;
        const v = {
          상호: biz, 호실: t.room, 이름: t.name, 납부일: mdw(c.due), 금액: manText(c.amount), 남은금액: manText(c.amount - c.paid),
          계좌: cfg.account, 퇴실통보일: mdw(addDays(c.due, -7)), 입실일: mdw(t.move_in), 월세: manText(t.rent), 보증금: manText(t.deposit), 경과일: Math.max(0, off)
        };
        const blocked = K.needAccount && !String(cfg.account || '').trim() ? '계좌 문구가 비어 있음' : '';
        push({ tenant_id: t.id, charge_id: c.id, kind, slot: 'T', room: t.room, name: t.name, to: t.phone, due: c.due, text: render(cfg.templates[kind], v), blocked });
        if (kind === 'dp3') for (const p of cfg.opPhones || []) push({ tenant_id: t.id, charge_id: c.id, kind: 'op3', slot: p, room: t.room, name: t.name, to: p, due: c.due, text: render(cfg.templates.op3, v), blocked: '' });
        break; // 같은 납부분에는 하루에 한 종류만
      }
    }
  }
  // 입실예정인데 입실일이 지남 → 운영자에게 입실 확인 알림 (3일 안 보완)
  for (const t of ts || []) {
    if (t.status !== 'reserved') continue;
    const off = diffDays(today, t.move_in);
    if (off < 0 || off > 2) continue;
    const v = { 상호: biz, 호실: t.room, 이름: t.name, 입실일: mdw(t.move_in) };
    for (const p of cfg.opPhones || []) push({ tenant_id: t.id, charge_id: 0, kind: 'opin', slot: p, room: t.room, name: t.name, to: p, due: t.move_in, text: render(cfg.templates.opin, v), blocked: '' });
  }
  const order = { d10: 1, d1: 2, dp1: 3, dp3: 4, op3: 5, opin: 6 };
  items.sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : order[a.kind] - order[b.kind]));
  return items;
}

function kstHour(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).getUTCHours();
}

/* 실행: 납부 예정분 만들기 → 대상 계산 → (테스트 모드면 기록만 / 실제면 발송)
   trigger: 'cron' | 'manual' */
export async function runSms(env, { trigger = 'manual', today = kstToday(), admin = null } = {}) {
  const db = env.DB;
  if (trigger === 'cron') {
    const done = await db.prepare("SELECT id FROM runs WHERE day = ? AND trigger = 'cron'").bind(today).first();
    if (done) return { skipped: '오늘 자동 실행은 이미 했습니다' };
  }
  await ensureAll(db, today);
  await setSetting(db, 'ensured', today);
  const cfg = await smsSettings(db);
  const items = await planSms(db, today, cfg);
  const ready = items.filter((i) => !i.blocked);
  const blocked = items.length - ready.length;
  const detail = items.map((i) => ({ room: i.room, name: i.name, kind: i.kind, to: i.to, type: i.type, blocked: i.blocked, retry: !!i.retryOf }));
  const record = async (mode, sent, failed, note) => {
    const r = await db.prepare('INSERT INTO runs (day, trigger, mode, planned, sent, failed, blocked, note, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(today, trigger, mode, items.length, sent, failed, blocked, note, JSON.stringify(detail).slice(0, 60000)).run();
    return r.meta.last_row_id;
  };
  if (cfg.stop) { await record('stopped', 0, 0, '긴급 정지 중이라 보내지 않음'); return { mode: 'stopped', planned: items.length }; }
  if (cfg.testMode) { await record('test', 0, 0, '테스트 모드: 보내지 않고 대상만 기록'); return { mode: 'test', planned: items.length, blocked, items }; }
  const h = kstHour();
  if (env.DEV !== '1' && (h < cfg.windowStart || h >= cfg.windowEnd)) {
    await record('deferred', 0, 0, '발송 시간대(' + cfg.windowStart + '~' + cfg.windowEnd + '시) 밖이라 보내지 않음');
    return { mode: 'deferred', planned: items.length };
  }
  const runId = await record('live', 0, 0, '');
  let sent = 0, failed = 0, n = 0;
  for (const it of ready) {
    if (++n > MAX_SENDS) break; // 남은 건 다음 실행 때 (무료 요금제 외부 요청 한도)
    // 보내기 전에 먼저 기록 (중복 방지). 실패분 재시도는 같은 줄을 다시 씀
    let id = it.retryOf;
    if (!id) {
      const ins = await db.prepare("INSERT OR IGNORE INTO sms_log (tenant_id, charge_id, kind, slot, to_phone, text, status, run_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
        .bind(it.tenant_id, it.charge_id, it.kind, it.slot, it.to, it.text, runId).run();
      if (!ins.meta || ins.meta.changes !== 1) continue; // 다른 실행이 이미 기록함
      id = ins.meta.last_row_id;
    }
    const lock = await db.prepare("UPDATE sms_log SET status = 'sending', tries = tries + 1, to_phone = ?, text = ?, run_id = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('pending', 'failed')")
      .bind(it.to, it.text, runId, id).run();
    if (!lock.meta || lock.meta.changes !== 1) continue;
    const r = await sendOne(env, cfg, it.to, it.text);
    await enqueue(db, 'room', (await db.prepare('SELECT room_id FROM tenants WHERE id = ?').bind(it.tenant_id).first() || {}).room_id);
    if (r.ok) {
      sent++;
      await db.prepare("UPDATE sms_log SET status = 'sent', msg_type = ?, cost = ?, msg_id = ?, group_id = ?, err = NULL, updated_at = datetime('now') WHERE id = ?").bind(r.type || it.type, PRICE[r.type || it.type] || PRICE[it.type], r.msgId || null, r.groupId || null, id).run();
    } else {
      failed++;
      // 응답이 불확실하면 다시 보내지 않음 → '결과 확인 필요'
      await db.prepare("UPDATE sms_log SET status = ?, err = ?, msg_id = ?, group_id = ?, updated_at = datetime('now') WHERE id = ?").bind(r.unknown ? 'unknown' : 'failed', String(r.error || '실패').slice(0, 200), r.msgId || null, r.groupId || null, id).run();
    }
  }
  // 이제 대상이 아닌 실패분(입금함·퇴실예정 등)은 취소
  await cancelStale(db, items, runId);
  await db.prepare('UPDATE runs SET sent = ?, failed = ? WHERE id = ?').bind(sent, failed, runId).run();
  if (admin) await audit(db, admin, '자동 문자 수동 실행', '보냄 ' + sent + ' · 실패 ' + failed + ' · 보류 ' + blocked);
  return { mode: 'live', planned: items.length, sent, failed, blocked };
}
async function cancelStale(db, items, runId) {
  const keep = new Set(items.filter((i) => i.retryOf).map((i) => i.retryOf));
  // 이번 실행에서 막 실패한 것은 다음 실행 때 재시도해야 하므로 제외
  const { results } = await db.prepare("SELECT id FROM sms_log WHERE status = 'failed' AND run_id != ?").bind(runId).all();
  for (const r of results || []) if (!keep.has(r.id)) {
    const row = await db.prepare('SELECT tries FROM sms_log WHERE id = ?').bind(r.id).first();
    // 재시도 횟수를 다 쓴 실패는 그대로 두어 관리자 화면에 보이게 함
    if (row && row.tries < 2) await db.prepare("UPDATE sms_log SET status = 'cancelled', err = COALESCE(err, '') || ' (대상 아님: 취소)', updated_at = datetime('now') WHERE id = ?").bind(r.id).run();
  }
}
