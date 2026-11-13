import { dueDate, cycleOnOrBefore, nextDueOnOrAfter, addDays, diffDays, dueByCycle, cycleIndex, tenantDue, tenantIndex } from '../src/dates.js';
import { allocate, ledgerStatus } from '../src/ledger-core.js';
let fail = 0, n = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(label, got, want) { n++; if (!eq(got, want)) { fail++; console.log('FAIL', label, '→', JSON.stringify(got), 'want', JSON.stringify(want)); } }

// 납부일: 처음 입실일 기준, 말일 보정
const seq = (m, c) => Array.from({ length: c }, (_, k) => dueDate(m, k));
check('1/31', seq('2026-01-31', 4), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
check('1/30', seq('2026-01-30', 3), ['2026-01-30', '2026-02-28', '2026-03-30']);
check('1/29', seq('2026-01-29', 3), ['2026-01-29', '2026-02-28', '2026-03-29']);
check('윤년 2028', seq('2028-01-31', 3), ['2028-01-31', '2028-02-29', '2028-03-31']);
check('윤년 2/29 입실', seq('2028-02-29', 13).slice(11), ['2029-01-29', '2029-02-28']);
check('연말', seq('2026-11-30', 4), ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
check('8/31 → 9/30 → 10/31', seq('2026-08-31', 3), ['2026-08-31', '2026-09-30', '2026-10-31']);
check('cycle 당일', cycleOnOrBefore('2026-01-31', '2026-02-28'), 1);
check('cycle 전날', cycleOnOrBefore('2026-01-31', '2026-02-27'), 0);
check('cycle 입실 전', cycleOnOrBefore('2026-01-31', '2026-01-30'), -1);
check('cycle 3/30', cycleOnOrBefore('2026-01-31', '2026-03-30'), 1);
check('next 3/1', nextDueOnOrAfter('2026-01-31', '2026-03-01'), '2026-03-31');
check('next 당일', nextDueOnOrAfter('2026-01-31', '2026-02-28'), '2026-02-28');
check('addDays', addDays('2026-02-25', 5), '2026-03-02');
check('diffDays', diffDays('2026-03-02', '2026-02-25'), 5);

// 2주 단위
check('2주 납부일', [0, 1, 2, 3].map((j) => dueByCycle('2w', '2026-11-20', j)), ['2026-11-20', '2026-12-04', '2026-12-18', '2027-01-01']);
check('2주 회차 (당일)', cycleIndex('2w', '2026-11-20', '2026-12-04'), 1);
check('2주 회차 (전날)', cycleIndex('2w', '2026-11-20', '2026-12-03'), 0);
check('2주 회차 (시작 전)', cycleIndex('2w', '2026-11-20', '2026-11-19'), -1);
// 계약 단위 변경: 2주(0~3회차) → 1/15부터 월 단위 (k_base 4)
const T = { cycle: 'month', anchor: '2027-01-15', k_base: 4, move_in: '2026-11-20' };
check('변경 후 납부일', [4, 5, 6].map((k) => tenantDue(T, k)), ['2027-01-15', '2027-02-15', '2027-03-15']);
check('변경 후 회차', tenantIndex(T, '2027-02-20'), 5);

// 입금 배정: 오래된 납부분부터, 남으면 선입금
const C = (id, due, amount) => ({ id, due, amount });
const P = (id, paid_on, amount) => ({ id, paid_on, amount });
check('전액', allocate([C(1, '2026-01-10', 300000)], [P(1, '2026-01-10', 300000)]).alloc, [[1, 1, 300000]]);
check('부분', allocate([C(1, '2026-01-10', 300000)], [P(1, '2026-01-10', 100000)]).alloc, [[1, 1, 100000]]);
check('나눠 입금', allocate([C(1, '2026-01-10', 300000)], [P(1, '2026-01-09', 100000), P(2, '2026-01-12', 200000)]).alloc, [[1, 1, 100000], [2, 1, 200000]]);
check('두 달치', allocate([C(1, '2026-01-10', 300000), C(2, '2026-02-10', 300000)], [P(1, '2026-01-10', 600000)]).alloc, [[1, 1, 300000], [1, 2, 300000]]);
check('선입금 남음', allocate([C(1, '2026-01-10', 300000)], [P(1, '2026-01-10', 450000)]).credit, 150000);
check('오래된 것부터', allocate([C(2, '2026-02-10', 300000), C(1, '2026-01-10', 300000)], [P(1, '2026-02-01', 300000)]).alloc, [[1, 1, 300000]]);

// 상태
const st = (charges, today) => { const r = ledgerStatus(charges, today); return [r.code, r.days, r.due]; };
check('입금됨', st([{ due: '2026-02-10', amount: 3, paid: 3 }], '2026-02-05'), ['paid', 0, null]);
check('납부 예정', st([{ due: '2026-02-10', amount: 3, paid: 0 }], '2026-02-05'), ['upcoming', -5, '2026-02-10']);
check('부분', st([{ due: '2026-02-10', amount: 3, paid: 1 }], '2026-02-05'), ['partial', -5, '2026-02-10']);
check('오늘', st([{ due: '2026-02-10', amount: 3, paid: 0 }], '2026-02-10'), ['today', 0, '2026-02-10']);
check('미납 D+2', st([{ due: '2026-02-10', amount: 3, paid: 1 }], '2026-02-12'), ['late', 2, '2026-02-10']);
check('가장 오래된 미납', st([{ due: '2026-01-10', amount: 3, paid: 0 }, { due: '2026-02-10', amount: 3, paid: 0 }], '2026-02-12'), ['late', 33, '2026-01-10']);
check('취소분 제외', st([{ due: '2026-02-10', amount: 3, paid: 0, void: 1 }], '2026-02-12'), ['paid', 0, null]);

console.log(fail ? fail + ' FAIL' : 'ALL PASS', '(' + n + ' cases)');
process.exit(fail ? 1 : 0);
