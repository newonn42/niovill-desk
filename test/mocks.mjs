import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs';
const DIR = process.argv[2];
const log = (f, o) => fs.appendFileSync(DIR + '/' + f, JSON.stringify(o) + '\n');
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
// ── 가짜 솔라피: 서명 검사 ──
const seen = new Set();
http.createServer(async (req, res) => {
  const a = req.headers.authorization || '';
  const m = /^HMAC-SHA256 apiKey=(\S+), date=(\S+), salt=(\S+), signature=([0-9a-f]+)$/.exec(a);
  const ok = m && m[1] === 'testkey' && crypto.createHmac('sha256', 'testsecret').update(m[2] + m[3]).digest('hex') === m[4] && Math.abs(Date.parse(m[2]) - Date.now()) < 15 * 60000 && !seen.has(m[4]) && m[3].length >= 12;
  if (m) seen.add(m[4]);
  if (!ok) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ errorCode: 'InvalidSignature', errorMessage: '서명 오류' })); }
  if (req.url === '/cash/v1/balance') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ balance: 4500, point: 0 })); }
  if (req.url === '/messages/v4/send-many/detail' && req.method === 'POST') {
    const b = JSON.parse(await body(req)); const msg = b.messages[0];
    log('solapi.log', { to: msg.to, from: msg.from, len: msg.text.length, text: msg.text.slice(0, 30) });
    if (msg.to.endsWith('5555')) { res.writeHead(502); return res.end('bad gateway'); }
    const id = 'M' + Date.now() + Math.random().toString(36).slice(2, 6);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (msg.to.endsWith('0000')) return res.end(JSON.stringify({ groupInfo: { groupId: 'G1', status: 'FAILED' }, failedMessageList: [{ messageId: id, statusCode: '1062', statusMessage: '수신번호 형식 오류' }] }));
    return res.end(JSON.stringify({ groupInfo: { groupId: 'G1', status: 'SENDING' }, failedMessageList: [], messageList: [{ messageId: id, statusCode: '2000', statusMessage: '정상 접수', type: Buffer.byteLength(msg.text, 'utf16le') > 90 ? 'LMS' : 'SMS' }] }));
  }
  res.writeHead(404); res.end('{}');
}).listen(8795, '127.0.0.1');
// ── 가짜 노션 ──
const ROOMS_DB = '2fc80bd3fbaf83c7b7098125b187fbf8', PARENT = '3f880bd3fbaf80b4b707cfe993cc9c3d';
const st = () => JSON.parse(fs.readFileSync(DIR + '/notion_state.json', 'utf8'));
const t = (s) => s ? [{ plain_text: s, text: { content: s } }] : [];
function page(r, i) {
  return { id: 'page-' + r.no, properties: {
    호실: { title: t(r.no) }, 상태: { select: r.state ? { name: r.state } : null }, 이름: { rich_text: t(r.name) }, 전화번호: { phone_number: r.phone || null },
    입실일: { date: r.move_in ? { start: r.move_in } : null }, 월세: { number: r.rent ?? null }, 보증금: { number: r.deposit ?? null }, 타입: { select: r.type ? { name: r.type } : null },
    성별: { select: r.gender ? { name: r.gender } : null }, 마스터: { rich_text: t(r.master) }, 입금: { checkbox: !!r.paid }, 현금영수증: { checkbox: !!r.cr }, 비고: { rich_text: t(r.memo) }, '문자 제외': { checkbox: !!r.off } } };
}
http.createServer(async (req, res) => {
  const j = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers.authorization !== 'Bearer secret_test' || req.headers['notion-version'] !== '2022-06-28') return j(401, { message: 'unauthorized' });
  const s = st();
  const b = req.method !== 'GET' ? JSON.parse((await body(req)) || '{}') : null;
  if (s.down) return j(503, { message: 'service unavailable (가짜)' });
  if (req.url === '/v1/databases/' + ROOMS_DB + '/query') return j(200, { results: s.rows.map(page), has_more: false });
  if (req.url === '/v1/databases/' + ROOMS_DB && req.method === 'GET') {
    const names = ['호실', '상태', '이름', '전화번호', '입실일', '월세', '보증금', '타입', '성별', '마스터', '입금', '현금영수증', '비고', '문자 제외', '안내기록'].concat(s.newCols === false ? [] : ['다음 납부일', '계약 단위', '미납', '퇴실예정일']);
    return j(200, { id: ROOMS_DB, parent: { type: 'page_id', page_id: PARENT }, properties: Object.fromEntries(names.map((n) => [n, {}])) });
  }
  if (req.url.startsWith('/v1/pages/') && req.method === 'PATCH' && s.newCols === false && b.properties && (b.properties['계약 단위'] || b.properties['미납'])) return j(400, { message: '계약 단위 is not a property that exists.' });
  if (req.url === '/v1/databases' && req.method === 'POST') { log('notion.log', { op: 'createdb', parent: b.parent, title: b.title[0].text.content, props: Object.keys(b.properties) }); return j(200, { id: '0dbd0000000000000000000000000000' }); }
  if (req.url.startsWith('/v1/pages/') && req.method === 'PATCH') { log('notion.log', { op: 'patch', id: req.url.slice(10), props: b.properties }); return j(200, { id: req.url.slice(10) }); }
  if (req.url === '/v1/pages' && req.method === 'POST') { const id = 'new-' + Date.now() + Math.random().toString(36).slice(2, 5); log('notion.log', { op: 'create', parent: b.parent, id, props: b.properties }); return j(200, { id }); }
  j(404, { message: 'not found ' + req.url });
}).listen(8796, '127.0.0.1');
