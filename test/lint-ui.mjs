// 화면 코드 검사: add(부모, 자식)에 인자를 3개 이상 넘기면 세 번째부터 화면에 안 붙음 (실제로 겪은 버그)
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bad = [];
for (const m of s.matchAll(/\badd\(/g)) {
  let k = m.index + m[0].length, d = 1, args = 1;
  while (d && k < s.length) {
    const c = s[k];
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c === ',' && d === 1) args++;
    else if (c === "'" || c === '"') { const q = c; k++; while (s[k] !== q) { if (s[k] === '\\') k++; k++; } }
    k++;
  }
  if (args > 2) bad.push(s.slice(0, m.index).split('\n').length);
}
console.log(bad.length ? 'FAIL add() 인자 3개 이상: ' + bad.join(', ') + '줄' : 'ALL PASS (화면 코드 검사)');
process.exit(bad.length ? 1 : 0);
