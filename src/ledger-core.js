/* 장부 계산 (데이터베이스와 무관한 순수 계산 – 시험하기 쉽게 분리) */
import { diffDays } from './dates.js';

/* 입금 배정: 입금(입금일 순)을 납부 예정분(납부일 순)에 오래된 것부터 채움.
   다 채우고 남은 돈은 선입금(credit)으로 남아 다음 납부분이 생기면 채워짐 */
export function allocate(charges, payments) {
  const cs = charges.filter((c) => !c.void).slice().sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id)).map((c) => ({ id: c.id, left: c.amount }));
  const ps = payments.slice().sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.id - b.id));
  const alloc = [];
  let credit = 0;
  let i = 0;
  for (const p of ps) {
    let left = p.amount;
    while (left > 0 && i < cs.length) {
      const take = Math.min(left, cs[i].left);
      if (take > 0) { alloc.push([p.id, cs[i].id, take]); cs[i].left -= take; left -= take; }
      if (cs[i].left === 0) i++;
    }
    credit += left;
  }
  return { alloc, credit };
}

/* 입금 상태: 아직 다 받지 못한 가장 오래된 납부분 기준
   paid 입금됨 · upcoming 납부 예정 · partial 부분 입금(납부일 전) · today 오늘 납부일 · late 미납(days = 지난 날 수) */
export function ledgerStatus(charges, today) {
  const open = charges.filter((c) => !c.void && c.paid < c.amount).sort((a, b) => (a.due < b.due ? -1 : 1));
  if (!open.length) return { code: 'paid', days: 0, due: null, owed: 0, openCount: 0 };
  const first = open[0];
  const d = diffDays(today, first.due);
  const owed = open.filter((c) => c.due <= today).reduce((a, c) => a + c.amount - c.paid, 0);
  const code = d > 0 ? 'late' : d === 0 ? 'today' : first.paid > 0 ? 'partial' : 'upcoming';
  return { code, days: d, due: first.due, owed, next: first.amount - first.paid, openCount: open.length };
}
