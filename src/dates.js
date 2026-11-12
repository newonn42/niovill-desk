/* 날짜 계산 – 모든 날짜는 한국 시간 기준 'YYYY-MM-DD' 문자열 */
export const DAY = 86400000;

export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function lastDay(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
export function ymd(y, mo, d) {
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
  return { y, mo, d };
}
const utc = (s) => { const p = parseYmd(s); return Date.UTC(p.y, p.mo - 1, p.d); };
export function addDays(s, n) {
  return new Date(utc(s) + n * DAY).toISOString().slice(0, 10);
}
// a - b (일)
export function diffDays(a, b) {
  return Math.round((utc(a) - utc(b)) / DAY);
}

/* k번째 납부일 (k=0 은 입실일). 항상 '처음 입실일의 날짜'를 기준으로 계산해
   1/31 → 2/28 → 3/31 처럼 말일 보정이 다음 달로 이어지지 않게 함 */
export function dueDate(moveIn, k) {
  const p = parseYmd(moveIn);
  const t = p.mo - 1 + k;
  const y = p.y + Math.floor(t / 12);
  const mo = (((t % 12) + 12) % 12) + 1;
  return ymd(y, mo, Math.min(p.d, lastDay(y, mo)));
}
// date 이전(같은 날 포함)의 마지막 납부일 번호. 입실일 전이면 -1
export function cycleOnOrBefore(moveIn, date) {
  if (date < moveIn) return -1;
  const a = parseYmd(moveIn), b = parseYmd(date);
  let k = (b.y - a.y) * 12 + (b.mo - a.mo);
  while (k > 0 && dueDate(moveIn, k) > date) k--;
  return k;
}
// date 이후(같은 날 포함)의 첫 납부일
export function nextDueOnOrAfter(moveIn, date) {
  const k = cycleOnOrBefore(moveIn, date);
  if (k >= 0 && dueDate(moveIn, k) === date) return date;
  return dueDate(moveIn, k + 1);
}
