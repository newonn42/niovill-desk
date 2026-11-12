/* 고시원 관리 – 화면 (휴대폰 기준) */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var ME = null;
  var TODAY = '';

  /* ── 도우미 ── */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function api(path, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' };
    return fetch('/api/' + path, opt).then(function (r) { return r.json().catch(function () { return { ok: false, error: '서버 응답을 읽지 못했습니다' }; }).then(function (j) { if (r.status === 401 && path !== 'login') { boot(); } return j; }); })
      .catch(function () { return { ok: false, error: '인터넷 연결을 확인해 주세요' }; });
  }
  function man(won) {
    if (won == null) return '-';
    var v = Math.round(won / 1000) / 10;
    return v.toLocaleString('ko-KR') + '만원';
  }
  function manIn(won) { return won == null ? '' : String(Math.round(won / 1000) / 10); }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  function md(s) {
    if (!s) return '-';
    var p = s.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (+p[1]) + '/' + (+p[2]) + '(' + WD[d.getUTCDay()] + ')';
  }
  function kt(utc) { // DB 시각(UTC) → 한국 시간
    if (!utc) return '';
    var d = new Date(utc.replace(' ', 'T') + 'Z');
    var k = new Date(d.getTime() + 9 * 3600000).toISOString();
    return k.slice(5, 10).replace('-', '/') + ' ' + k.slice(11, 16);
  }
  function toast(msg) {
    var t = h('div', { class: 'toast', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  var STATE = { vacant: ['공실', ''], reserved: ['입실예정', 'b'], in: ['입실', 'g'], leaving: ['퇴실예정', 'a'], office: ['사무실', ''], repair: ['수리중', ''], out: ['퇴실', ''], cancelled: ['입실 취소', ''] };
  function statePill(s) { var x = STATE[s] || [s, '']; return h('span', { class: 'pill ' + x[1], text: x[0] }); }
  function ledgerPill(l) {
    if (!l) return null;
    if (l.code === 'paid') return h('span', { class: 'pill g', text: '✅ 입금됨' });
    if (l.code === 'upcoming') return h('span', { class: 'pill', text: '⏳ 납부 예정' });
    if (l.code === 'partial') return h('span', { class: 'pill a', text: '🟡 부분 입금' });
    if (l.code === 'today') return h('span', { class: 'pill a', text: '📅 오늘 납부일' });
    return h('span', { class: 'pill r', text: '❗ 미납 D+' + l.days });
  }

  /* 아래에서 올라오는 입력 창 */
  function sheet(title, body) {
    var mask = h('div', { class: 'mask', onclick: function (e) { if (e.target === mask) close(); } });
    var s = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'sh' }, h('b', { text: title }), h('button', { type: 'button', 'aria-label': '닫기', onclick: close, text: '✕' })), body);
    mask.appendChild(s);
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    return close;
  }
  function field(label, input, hint) { return h('label', { class: 'f' }, label, hint ? h('small', { text: hint }) : null, input); }
  function inp(type, name, value, extra) { return h('input', Object.assign({ type: type, name: name, value: value == null ? '' : value }, extra || {})); }
  function check(name, label, on) { return h('label', { class: 'c' }, h('input', { type: 'checkbox', name: name, checked: on }), label); }
  function sel(name, opts, value) { return h('select', { name: name }, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o; return h('option', { value: v, selected: String(v) === String(value) ? true : null, text: Array.isArray(o) ? o[1] : (o || '선택 안 함') }); })); }
  function formData(f) {
    var o = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (!el.name) return; o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  }
  // 저장 버튼이 있는 폼: send(data) → Promise<{ok, error}>
  function submitForm(children, label, send, opts) {
    opts = opts || {};
    var err = h('p', { class: 'err', hidden: true });
    var btn = h('button', { class: 'btn full' + (opts.danger ? ' red' : ''), type: 'submit', text: label });
    var f = h('form', { onsubmit: function (e) {
      e.preventDefault();
      if (opts.confirm && !confirm(opts.confirm)) return;
      btn.disabled = true; err.hidden = true;
      send(formData(f), f).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.error) || '저장하지 못했습니다'; err.hidden = false; }
      });
    } }, children, err, btn);
    return f;
  }

  /* ── 시작 · 로그인 ── */
  function boot() {
    var inviteToken = (location.hash.match(/invite=([\w-]+)/) || [])[1];
    api('me').then(function (r) {
      if (!r.ok) { app.textContent = r.error || '불러오지 못했습니다'; return; }
      if (inviteToken && !r.admin) return inviteScreen(inviteToken);
      if (r.needSetup) return setupScreen();
      if (r.needLogin) return loginScreen(r.bizName);
      ME = r.admin; TODAY = r.today; ME.bizName = r.bizName; ME.dev = r.dev;
      if (inviteToken) location.hash = '#/';
      route();
    });
  }
  function authBox(title, sub, form) {
    app.textContent = '';
    app.appendChild(h('div', { class: 'auth' }, h('h1', { text: title }), sub ? h('p', { class: 'note', text: sub }) : null, h('div', { class: 'card', style: 'margin-top:14px' }, form)));
  }
  function loginScreen(biz) {
    authBox((biz || '고시원') + ' 관리', '관리자 로그인', submitForm([
      field('아이디', inp('text', 'username', '', { autocomplete: 'username', autocapitalize: 'none' })),
      field('비밀번호', inp('password', 'password', '', { autocomplete: 'current-password' }))
    ], '로그인', function (d) { return api('login', d).then(function (r) { if (r.ok) boot(); return r; }); }));
  }
  function setupScreen() {
    authBox('처음 설정', '최고 관리자 계정을 만듭니다 (한 번만)', submitForm([
      field('상호', inp('text', 'bizName', '', { placeholder: '예: 니오빌원룸텔' })),
      field('이름', inp('text', 'name', '')),
      field('아이디', inp('text', 'username', '', { autocapitalize: 'none' }), '영문 소문자·숫자 3~20자'),
      field('비밀번호', inp('password', 'password', '', { autocomplete: 'new-password' }), '8자 이상')
    ], '만들기', function (d) { return api('setup', d).then(function (r) { if (r.ok) boot(); return r; }); }));
  }
  function inviteScreen(token) {
    authBox('관리자 초대', '사용할 아이디와 비밀번호를 정해 주세요', submitForm([
      field('아이디', inp('text', 'username', '', { autocapitalize: 'none' }), '영문 소문자·숫자 3~20자'),
      field('비밀번호', inp('password', 'password', '', { autocomplete: 'new-password' }), '8자 이상')
    ], '시작하기', function (d) { d.token = token; return api('invite/accept', d).then(function (r) { if (r.ok) { location.hash = '#/'; boot(); } return r; }); }));
  }

  /* ── 화면 틀 ── */
  var NAV = [['#/', '🏠', '홈'], ['#/rooms', '🚪', '호실'], ['#/sms', '✉️', '문자'], ['#/out', '📁', '퇴실'], ['#/settings', '⚙️', '설정']];
  function frame(title, opts, content) {
    opts = opts || {};
    app.textContent = '';
    var top = h('div', { class: 'top' },
      opts.back ? h('button', { class: 'back', 'aria-label': '뒤로', onclick: function () { history.length > 1 ? history.back() : (location.hash = '#/rooms'); }, text: '‹' }) : null,
      h('b', { text: title }),
      ME.dev ? h('span', { class: 'today', text: '시험 날짜 ' + TODAY }) : null,
      h('button', { class: 'icon', 'aria-label': '검색', onclick: searchSheet, text: '🔍' }));
    var cur = location.hash.split('/').slice(0, 2).join('/') || '#/';
    var nav = h('nav', { class: 'nav' }, NAV.map(function (n) { return h('a', { href: n[0], class: (cur === n[0] || (n[0] === '#/rooms' && cur === '#/t')) ? 'on' : '' }, h('span', { text: n[1] }), n[2]); }));
    app.appendChild(h('div', { class: 'wrap' }, top, content));
    app.appendChild(nav);
  }
  function route() {
    if (!ME) return boot();
    var p = location.hash.replace(/^#/, '') || '/';
    var m;
    if (p === '/' || p === '') return dashView();
    if (p === '/rooms') return roomsView();
    if ((m = p.match(/^\/t\/(\d+)$/))) return tenantView(+m[1]);
    if (p === '/out') return outView();
    if (p === '/sms') return smsView();
    if (p === '/settings') return settingsView();
    location.hash = '#/';
  }
  window.addEventListener('hashchange', function () { if (ME) route(); });
  function reload() { route(); }

  /* ── 홈 (대시보드) ── */
  function dashView() {
    frame(ME.bizName || '고시원 관리', {}, h('p', { class: 'loading', text: '불러오는 중…' }));
    api('dash').then(function (r) {
      if (!r.ok) return;
      TODAY = r.today;
      var c = r.counts;
      var todoIcon = { checkin: '🔑', checkout: '🚪', call: '📞' };
      frame(ME.bizName || '고시원 관리', {}, h('div', null,
        h('div', { class: 'sec' },
          h('div', { class: 'grid4' },
            h('div', { class: 'stat' }, h('span', { text: '전체 호실' }), h('b', { text: c.rooms })),
            h('div', { class: 'stat' }, h('span', { text: '입실' }), h('b', { text: c.live })),
            h('div', { class: 'stat' }, h('span', { text: '공실' }), h('b', { text: c.vacant })),
            h('div', { class: 'stat' + (c.late ? ' red' : '') }, h('span', { text: '미납' }), h('b', { text: c.late }))),
          (c.reserved || c.repair) ? h('p', { class: 'note', text: (c.reserved ? '입실예정 ' + c.reserved + '실 ' : '') + (c.repair ? '· 수리중 ' + c.repair + '실' : '') }) : null,
          h('h2', { text: '오늘 할 일' }),
          r.todo.length ? h('ul', { class: 'list' }, r.todo.map(function (t) { return h('li', { class: 'todo', onclick: function () { location.hash = '#/t/' + t.id; } }, h('span', { class: 'ic', text: todoIcon[t.kind] }), h('span', { text: t.text })); }))
            : h('p', { class: 'empty', text: '없습니다 👍' }),
          h('h2', { text: '미납 ' + (r.late.length ? '· 합계 ' + man(r.owed) : '') }),
          r.late.length ? h('ul', { class: 'list' }, r.late.map(function (x) { return h('li', { class: 'todo', onclick: function () { location.hash = '#/t/' + x.id; } }, h('b', { text: x.room + '호' }), h('span', { text: x.name + ' · ' + man(x.owed) }), h('span', { class: 'pill r', text: 'D+' + x.days })); }))
            : h('p', { class: 'empty', text: '미납자가 없습니다' })
        )));
    });
  }

  /* ── 호실 ── */
  var roomFilter = 'all';
  function roomsView() {
    frame('호실', {}, h('p', { class: 'loading', text: '불러오는 중…' }));
    api('rooms').then(function (r) {
      if (!r.ok) return;
      TODAY = r.today;
      var filters = [['all', '전체'], ['late', '미납'], ['vacant', '공실'], ['leaving', '퇴실예정'], ['reserved', '입실예정']];
      var listEl = h('div', { class: 'list' });
      function paint() {
        listEl.textContent = '';
        var shown = r.rooms.filter(function (x) {
          if (roomFilter === 'all') return true;
          if (roomFilter === 'late') return x.tenant && x.tenant.ledger && x.tenant.ledger.code === 'late';
          return x.state === roomFilter;
        });
        if (!shown.length) listEl.appendChild(h('p', { class: 'empty', text: r.rooms.length ? '해당하는 호실이 없습니다' : '호실이 없습니다. 설정 → 호실에서 추가해 주세요' }));
        shown.forEach(function (x) { listEl.appendChild(roomCard(x)); });
      }
      var chips = h('div', { class: 'chips' }, filters.map(function (f) {
        return h('button', { type: 'button', class: 'chip' + (roomFilter === f[0] ? ' on' : ''), onclick: function () { roomFilter = f[0]; Array.prototype.forEach.call(chips.children, function (c) { c.classList.remove('on'); }); this.classList.add('on'); paint(); }, text: f[1] });
      }));
      frame('호실', {}, h('div', { class: 'sec' }, chips, listEl));
      paint();
    });
  }
  function roomCard(x) {
    var t = x.tenant;
    var l = t && t.ledger;
    var card = h('div', { class: 'room' + (l && l.code === 'late' ? ' late' : ''), onclick: function () { if (t) location.hash = '#/t/' + t.id; } },
      h('div', { class: 'hd' }, h('span', { class: 'no', text: x.no }), h('span', { class: 'ty', text: x.type || '' }), statePill(x.state)));
    if (!t) {
      if (x.state === 'vacant') card.appendChild(h('div', { class: 'acts' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: function (e) { e.stopPropagation(); registerSheet(x); }, text: '+ 입실 등록' })));
      return card;
    }
    card.appendChild(h('div', { class: 'who', text: t.name + (t.sms_off ? ' 🔕' : '') }));
    if (t.status === 'reserved') {
      card.appendChild(h('div', { class: 'line' }, h('span', { text: '입실 예정일 ' + md(t.move_in) }), t.checkinDue ? h('span', { class: 'pill b', text: '입실 확인 필요' }) : null));
      if (t.checkinDue) card.appendChild(h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: function (e) { e.stopPropagation(); checkinSheet(t, x); }, text: '🔑 입실 확인' })));
      return card;
    }
    card.appendChild(h('div', { class: 'line' }, h('span', { text: '월세 ' + man(t.rent) }), h('span', { text: (l.code === 'late' ? '미납분 ' : '다음 납부 ') + md(l.nextDue) }), ledgerPill(l), t.leave_date ? h('span', { class: 'pill a', text: '퇴실 ' + md(t.leave_date) }) : null));
    if (l.code !== 'paid') card.appendChild(h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: function (e) { e.stopPropagation(); paySheet(t, x.no, l); }, text: '💰 입금 확인' })));
    return card;
  }

  /* ── 입력 창들 ── */
  var TYPES = ['', '넓은 외창', '넓은 내창', '외창', '내창'];
  function tenantInputs(t, room) {
    t = t || {};
    return [
      field('이름', inp('text', 'name', t.name)),
      field('휴대전화', inp('tel', 'phone', t.phone, { inputmode: 'numeric', placeholder: '010-0000-0000' })),
      h('div', { class: 'row' }, field('보증금 (만원)', inp('number', 'deposit', manIn(t.deposit), { inputmode: 'decimal', step: 'any', min: 0 })), field('성별', sel('gender', ['', '남', '여'], t.gender))),
      field('마스터 (비번)', inp('text', 'master', t.master, { autocomplete: 'off' }), '이 사이트에만 저장 (노션에 보내지 않음)'),
      field('비고', h('textarea', { name: 'memo', rows: 2 }, t.memo || '')),
      check('cash_receipt', '현금영수증 발급', t.cash_receipt),
      check('sms_off', '자동 문자 보내지 않음 (단기·특수 입실자)', t.sms_off)
    ];
  }
  function registerSheet(room) {
    var close;
    var modeSel = sel('mode', [['reserved', '입실예정으로 등록 (입실일에 확인)'], ['living', '이미 살고 있는 분 등록']], 'reserved');
    var paidBox = check('paidCurrent', '이번 회차 월세는 이미 받음', false);
    paidBox.hidden = true;
    modeSel.addEventListener('change', function () { paidBox.hidden = modeSel.value !== 'living'; });
    var f = submitForm([
      field('등록 방식', modeSel),
      h('div', { class: 'row' }, field('입실일', inp('date', 'move_in', TODAY)), field('월세 (만원)', inp('number', 'rent', '', { inputmode: 'decimal', step: 'any', min: 0 }))),
      paidBox
    ].concat(tenantInputs(null, room)), '등록', function (d) {
      d.room_id = room.id;
      return api('tenant/create', d).then(function (r) { if (r.ok) { close(); toast(room.no + '호 등록했습니다'); location.hash = '#/t/' + r.id; } return r; });
    });
    close = sheet(room.no + '호 입실 등록', f);
  }
  function paySheet(t, roomNo, l) {
    var close;
    var due = l && l.code !== 'paid' ? (l.code === 'late' || l.code === 'today' ? l.owed : l.next) : t.rent;
    var f = submitForm([
      l && l.due ? h('p', { class: 'note', text: '가장 오래된 미납분: ' + md(l.due) + ' 납부분 · 남은 금액 ' + man(l.next) + (l.openCount > 1 ? ' (미납 ' + l.openCount + '회차)' : '') }) : null,
      h('div', { class: 'row' }, field('입금액 (만원)', inp('number', 'amount', manIn(due), { inputmode: 'decimal', step: 'any', min: 0 })), field('입금일', inp('date', 'paid_on', TODAY))),
      field('방법', sel('method', ['계좌', '현금', '카드', '기타'], '계좌')),
      field('메모', inp('text', 'memo', '', { placeholder: '선택' })),
      h('p', { class: 'note', text: '오래된 납부분부터 채워지고, 남는 돈은 다음 납부분으로 넘어갑니다.' })
    ], '입금 확인', function (d) {
      d.tenant_id = t.id;
      return api('pay', d).then(function (r) { if (r.ok) { close(); toast('입금 확인했습니다'); reload(); } return r; });
    });
    close = sheet(roomNo + '호 ' + t.name + ' 입금 확인', f);
  }
  function checkinSheet(t, room) {
    var close;
    var f = submitForm([
      h('p', { class: 'note', text: '실제로 입실한 날을 확인해 주세요. 입실 확인 후부터 장부와 자동 문자가 시작됩니다.' }),
      field('실제 입실일', inp('date', 'move_in', t.move_in <= TODAY ? t.move_in : TODAY)),
      check('firstPaid', '첫 달 월세 받음', true),
      h('div', { class: 'row' }, field('첫 달 입금액 (만원)', inp('number', 'firstAmount', manIn(t.rent), { inputmode: 'decimal', step: 'any' })), field('방법', sel('method', ['계좌', '현금', '카드', '기타'], '계좌')))
    ], '입실 확인', function (d) {
      d.id = t.id;
      return api('tenant/checkin', d).then(function (r) { if (r.ok) { close(); toast('입실 확인했습니다'); reload(); } return r; });
    });
    close = sheet((room ? room.no + '호 ' : '') + t.name + ' 입실 확인', f);
  }

  /* ── 입실자 상세 ── */
  function tenantView(id) {
    frame('입실자', { back: true }, h('p', { class: 'loading', text: '불러오는 중…' }));
    api('tenant?id=' + id).then(function (r) {
      if (!r.ok) { frame('입실자', { back: true }, h('p', { class: 'loading', text: r.error })); return; }
      TODAY = r.today;
      var t = r.tenant, l = r.ledger, room = r.room;
      var active = t.status === 'in' || t.status === 'leaving';
      var acts = [];
      if (t.status === 'reserved') {
        acts.push(h('button', { class: 'btn', type: 'button', onclick: function () { checkinSheet(t, room); }, text: '🔑 입실 확인' }));
        acts.push(h('button', { class: 'btn redg', type: 'button', onclick: function () { cancelSheet(t); }, text: '입실 취소' }));
      }
      if (active || t.status === 'out') acts.push(h('button', { class: 'btn', type: 'button', onclick: function () { paySheet(t, room.no, l); }, text: '💰 입금 확인' }));
      if (t.status === 'in') acts.push(h('button', { class: 'btn ghost', type: 'button', onclick: function () { leavingSheet(t); }, text: '퇴실예정으로' }));
      if (t.status === 'leaving') acts.push(h('button', { class: 'btn ghost', type: 'button', onclick: function () { api('tenant/leaving', { id: t.id, leave: false }).then(function (x) { x.ok ? (toast('계속 거주로 바꿨습니다'), reload()) : alert(x.error); }); }, text: '퇴실예정 취소' }));
      if (active) acts.push(h('button', { class: 'btn redg', type: 'button', onclick: function () { checkoutSheet(t, room); }, text: '🚪 퇴실 처리' }));
      var editable = t.status !== 'out' && t.status !== 'cancelled';

      var allocBy = {};
      r.allocations.forEach(function (a) { (allocBy[a.payment_id] = allocBy[a.payment_id] || []).push(md(a.due) + '분 ' + man(a.amount)); });
      var content = h('div', null,
        h('div', { class: 'sec' },
          h('div', { class: 'card' },
            h('div', { class: 'row', style: 'align-items:center' }, h('span', { class: 'big', text: room.no + '호 ' + t.name }), h('span', { style: 'flex:0' }, statePill(t.status))),
            l ? h('div', { style: 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, ledgerPill(l), h('span', { class: 'note', text: '다음 납부 ' + md(l.nextDue) + (l.code === 'late' ? ' · 미납 ' + man(l.owed) : '') + (r.credit > 0 ? ' · 선입금 ' + man(r.credit) : '') })) : null,
            t.status === 'leaving' ? h('p', { class: 'note', text: '퇴실예정일 ' + (t.leave_date ? md(t.leave_date) : '미정') + ' · 자동 문자 중단됨' }) : null),
          acts.length ? h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, acts) : null,
          h('h2', { text: '정보' }),
          h('div', { class: 'card' },
            h('dl', { class: 'kv' },
              h('dt', { text: '전화' }), h('dd', null, h('a', { href: 'tel:' + t.phone, text: t.phone })),
              h('dt', { text: '입실일' }), h('dd', { text: md(t.move_in) + ' ' + t.move_in.slice(0, 4) }),
              h('dt', { text: '월세' }), h('dd', { text: man(t.rent) }),
              h('dt', { text: '보증금' }), h('dd', { text: man(t.deposit) + (t.dep_done_at ? ' (반환 ' + man(t.dep_refund) + (t.dep_deduct ? ' · 공제 ' + man(t.dep_deduct) + ' ' + (t.dep_note || '') : '') + ')' : '') }),
              h('dt', { text: '타입' }), h('dd', { text: room.type || '-' }),
              h('dt', { text: '성별' }), h('dd', { text: t.gender || '-' }),
              h('dt', { text: '마스터' }), h('dd', { text: t.master || '-' }),
              h('dt', { text: '현금영수증' }), h('dd', { text: t.cash_receipt ? '발급' : '-' }),
              h('dt', { text: '자동 문자' }), h('dd', { text: t.sms_off ? '보내지 않음' : '보냄' }),
              h('dt', { text: '비고' }), h('dd', { text: t.memo || '-' }),
              t.out_date ? [h('dt', { text: t.status === 'cancelled' ? '취소일' : '퇴실일' }), h('dd', { text: t.out_date })] : null),
            editable ? h('div', { class: 'row', style: 'margin-top:10px' },
              h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { editSheet(t, room); }, text: '정보 수정' }),
              t.status !== 'reserved' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { rentSheet(t); }, text: '월세 변경' }) : null) : null),
          r.charges.length ? [h('h2', { text: '납부 장부' }), h('div', { class: 'card' }, h('table', { class: 'tbl' },
            h('tr', null, h('th', { text: '납부일' }), h('th', { class: 'num', text: '금액' }), h('th', { class: 'num', text: '받음' }), h('th', { text: '상태' })),
            r.charges.map(function (c) {
              var st = c.void ? h('span', { class: 'pill', text: '해당 없음' }) : c.paid >= c.amount ? h('span', { class: 'pill g', text: '완납' }) : c.paid > 0 ? h('span', { class: 'pill a', text: '부분' }) : c.due < TODAY ? h('span', { class: 'pill r', text: '미납' }) : h('span', { class: 'pill', text: '예정' });
              return h('tr', null, h('td', { class: c.void ? 'x' : '', text: md(c.due) + ' ' + c.due.slice(2, 4) }), h('td', { class: 'num' + (c.void ? ' x' : ''), text: man(c.amount) }), h('td', { class: 'num', text: man(c.paid) }), h('td', null, st));
            })))] : null,
          r.payments.length ? [h('h2', { text: '입금 내역' }), h('div', { class: 'card' }, h('table', { class: 'tbl' },
            h('tr', null, h('th', { text: '입금일' }), h('th', { class: 'num', text: '금액' }), h('th', { text: '내용' }), h('th', null)),
            r.payments.map(function (p) {
              var x = !!p.cancelled_at;
              return h('tr', null, h('td', { class: x ? 'x' : '', text: md(p.paid_on) }), h('td', { class: 'num' + (x ? ' x' : ''), text: man(p.amount) }),
                h('td', null, (p.method || '') + (p.memo ? ' · ' + p.memo : ''), h('br'), h('small', { class: 'note', text: x ? '취소: ' + p.cancel_reason + ' (' + p.cancelled_by + ')' : (allocBy[p.id] || ['선입금']).join(', ') + ' · ' + (p.by_name || '') })),
                h('td', null, x ? null : h('button', { class: 'link', type: 'button', onclick: function () { payCancelSheet(p); }, text: '취소' })));
            })))] : null,
          r.rents.length ? [h('h2', { text: '월세 변경' }), h('ul', { class: 'log card' }, r.rents.map(function (x) { return h('li', null, x.eff_date + '부터 ' + man(x.old_rent) + ' → ' + man(x.new_rent), h('small', { text: ' · ' + (x.by_name || '') })); }))] : null,
          h('h2', { text: '변경 이력' }),
          h('ul', { class: 'log card' }, r.log.length ? r.log.map(function (x) { return h('li', null, h('small', { text: kt(x.at) + ' · ' + (x.who || '') + ' ' }), h('b', { text: x.action }), x.detail ? ' · ' + x.detail : ''); }) : h('li', { text: '없음' }))
        ));
      frame(room.no + '호 ' + t.name, { back: true }, content);
    });
  }
  function editSheet(t, room) {
    var close;
    api('rooms').then(function (rr) {
      var rooms = (rr.rooms || []).filter(function (x) { return x.id === room.id || x.state === 'vacant'; }).map(function (x) { return [x.id, x.no + '호' + (x.id === room.id ? ' (지금)' : '')]; });
      var children = [field('호실', sel('room_id', rooms, room.id), '방 이동은 비어 있는 호실로만'), field('입실일', inp('date', 'move_in', t.move_in), t.status === 'reserved' ? '' : '입금 기록이 있으면 바꿀 수 없습니다')].concat(tenantInputs(t, room));
      close = sheet(room.no + '호 ' + t.name + ' 정보 수정', submitForm(children, '저장', function (d) {
        d.id = t.id;
        return api('tenant/update', d).then(function (r) { if (r.ok) { close(); toast('저장했습니다'); reload(); } return r; });
      }));
    });
  }
  function rentSheet(t) {
    var close = sheet(t.name + ' 월세 변경', submitForm([
      h('p', { class: 'note', text: '지금 월세 ' + man(t.rent) + '. 이미 만들어진 납부분 금액은 그대로 두고, 이후 납부분부터 새 월세가 적용됩니다.' }),
      h('div', { class: 'row' }, field('새 월세 (만원)', inp('number', 'rent', '', { inputmode: 'decimal', step: 'any' })), field('적용일', inp('date', 'eff_date', TODAY))),
      check('applyOpen', '이미 만들어졌지만 아직 안 받은 납부분에도 적용', false)
    ], '변경', function (d) { d.id = t.id; return api('tenant/rent', d).then(function (r) { if (r.ok) { close(); toast('월세를 바꿨습니다'); reload(); } return r; }); }));
  }
  function leavingSheet(t) {
    var close = sheet(t.name + ' 퇴실예정', submitForm([
      h('p', { class: 'note', text: '퇴실예정으로 바꾸면 자동 문자가 멈춥니다. 퇴실예정일 이후의 납부분은 받지 않습니다.' }),
      field('퇴실예정일', inp('date', 'leave_date', ''), '모르면 비워 두기')
    ], '퇴실예정으로 변경', function (d) { d.id = t.id; return api('tenant/leaving', d).then(function (r) { if (r.ok) { close(); toast('퇴실예정으로 바꿨습니다'); reload(); } return r; }); }));
  }
  function cancelSheet(t) {
    var close = sheet(t.name + ' 입실 취소', submitForm([
      h('p', { class: 'note', text: '입실하지 않은 경우입니다. 기록은 퇴실 기록에 남고 호실은 비워집니다.' }),
      field('사유', inp('text', 'reason', ''))
    ], '입실 취소', function (d) { d.id = t.id; return api('tenant/cancel', d).then(function (r) { if (r.ok) { close(); toast('입실 취소했습니다'); location.hash = '#/rooms'; } return r; }); }, { danger: true }));
  }
  function payCancelSheet(p) {
    var close = sheet('입금 취소', submitForm([
      h('p', { class: 'note', text: md(p.paid_on) + ' ' + man(p.amount) + ' 입금을 취소합니다. 기록은 지워지지 않고 "취소"로 남습니다.' }),
      field('취소 사유', inp('text', 'reason', '', { placeholder: '예: 잘못 눌렀음' }))
    ], '입금 취소', function (d) { d.id = p.id; return api('pay/cancel', d).then(function (r) { if (r.ok) { close(); toast('입금을 취소했습니다'); reload(); } return r; }); }, { danger: true }));
  }
  function checkoutSheet(t, room) {
    var close;
    var info = h('div', { class: 'warn', text: '퇴실일을 고르면 정산 내용을 보여 드립니다.' });
    var outInp = inp('date', 'out_date', t.leave_date || TODAY);
    function preview() {
      api('checkout/preview?id=' + t.id + '&out_date=' + outInp.value).then(function (r) {
        if (!r.ok) { info.textContent = r.error; return; }
        info.textContent = '보증금 ' + man(r.deposit) + ' · 퇴실 전 미납 ' + man(r.owed) + (r.refundable ? ' · 퇴실일 이후분으로 받은 돈 ' + man(r.refundable) + ' (돌려줄 금액)' : '');
      });
    }
    outInp.addEventListener('change', preview);
    var f = submitForm([
      field('퇴실일', outInp), info,
      h('div', { class: 'row' }, field('보증금 반환액 (만원)', inp('number', 'dep_refund', manIn(t.deposit), { inputmode: 'decimal', step: 'any' })), field('공제액 (만원)', inp('number', 'dep_deduct', '0', { inputmode: 'decimal', step: 'any' }))),
      field('공제 사유', inp('text', 'dep_note', '', { placeholder: '공제가 있으면 적어 주세요 (예: 미납 월세, 청소비)' })),
      check('dep_to_rent', '공제액을 미납 월세에 먼저 충당 (장부에 "보증금 공제" 입금으로 기록)', true)
    ], '퇴실 처리', function (d) {
      d.id = t.id;
      return api('tenant/checkout', d).then(function (r) { if (r.ok) { close(); toast(room.no + '호 퇴실 처리했습니다' + (r.owed ? ' (남은 미납 ' + man(r.owed) + ')' : '')); location.hash = '#/rooms'; } return r; });
    }, { danger: true, confirm: room.no + '호 ' + t.name + '님을 퇴실 처리할까요? 호실이 공실로 바뀝니다.' });
    close = sheet(room.no + '호 ' + t.name + ' 퇴실 처리', f);
    preview();
  }

  /* ── 검색 ── */
  function searchSheet() {
    var res = h('ul', { class: 'list' });
    var q = inp('search', 'q', '', { placeholder: '이름 · 전화번호 · 호실', autofocus: true });
    var timer;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        api('search?q=' + encodeURIComponent(q.value)).then(function (r) {
          res.textContent = '';
          (r.list || []).forEach(function (x) { res.appendChild(h('li', { class: 'todo', onclick: function () { close(); location.hash = '#/t/' + x.id; } }, h('b', { text: x.room + '호' }), h('span', { text: x.name + ' · ' + x.phone }), statePill(x.status))); });
          if (q.value && !(r.list || []).length) res.appendChild(h('p', { class: 'empty', text: '찾지 못했습니다' }));
        });
      }, 250);
    });
    var close = sheet('검색', h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, q, res));
    setTimeout(function () { q.focus(); }, 50);
  }

  /* ── 문자 (5단계) ── */
  function smsView() {
    frame('문자', {}, h('div', { class: 'sec' }, h('div', { class: 'card' }, h('b', { text: '자동 문자 · 공지 문자' }), h('p', { class: 'note', text: '다음 단계에서 추가됩니다 (테스트 모드부터).' }))));
  }

  /* ── 퇴실 기록 ── */
  function outView() {
    frame('퇴실 기록', {}, h('p', { class: 'loading', text: '불러오는 중…' }));
    api('out').then(function (r) {
      if (!r.ok) return;
      frame('퇴실 기록', {}, h('div', { class: 'sec' },
        h('p', { class: 'note', text: '퇴실 3년 뒤 이름·전화번호는 자동으로 지워집니다.' }),
        r.list.length ? h('ul', { class: 'list' }, r.list.map(function (x) {
          return h('li', { class: 'room', onclick: function () { location.hash = '#/t/' + x.id; } },
            h('div', { class: 'hd' }, h('span', { class: 'no', text: x.room }), h('span', { class: 'ty', text: x.name }), statePill(x.status)),
            h('div', { class: 'line' }, h('span', { text: x.move_in + ' ~ ' + (x.out_date || '') }), x.status === 'out' ? h('span', { text: '보증금 ' + man(x.deposit) + ' · 반환 ' + man(x.dep_refund) + (x.dep_deduct ? ' · 공제 ' + man(x.dep_deduct) : '') }) : null, x.owed > 0 ? h('span', { class: 'pill r', text: '미납 ' + man(x.owed) }) : null));
        })) : h('p', { class: 'empty', text: '아직 없습니다' })));
    });
  }

  /* ── 설정 ── */
  function settingsView() {
    var owner = ME.role === 'owner';
    var box = h('div', { class: 'sec' });
    frame('설정', {}, box);
    box.appendChild(h('div', { class: 'card' }, h('b', { text: ME.name + ' (' + (owner ? '최고 관리자' : '일반 관리자') + ')' }), h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: pwSheet, text: '비밀번호 변경' }),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { api('logout', {}).then(function () { ME = null; boot(); }); }, text: '로그아웃' }))));
    if (ME.dev) box.appendChild(devBox());
    if (!owner) { box.appendChild(h('p', { class: 'note', text: '설정·호실·관리자 관리는 최고 관리자만 할 수 있습니다.' })); return; }
    // 상호
    api('settings').then(function (s) {
      box.insertBefore(h('div', null, h('h2', { text: '운영 정보' }), h('div', { class: 'card' }, submitForm([field('상호', inp('text', 'bizName', s.bizName))], '저장', function (d) {
        return api('settings', d).then(function (r) { if (r.ok) { ME.bizName = d.bizName; toast('저장했습니다'); } return r; });
      }), h('p', { class: 'note', style: 'margin-top:8px', text: '발신번호·계좌 문구·문자 문구는 문자 단계에서 추가됩니다.' }))), box.children[1] || null);
    });
    // 호실
    var roomsBox = h('div', { class: 'card' });
    box.appendChild(h('h2', { text: '호실' }));
    box.appendChild(roomsBox);
    function paintRooms() {
      api('rooms').then(function (r) {
        roomsBox.textContent = '';
        roomsBox.appendChild(h('table', { class: 'tbl' }, h('tr', null, h('th', { text: '호실' }), h('th', { text: '타입' }), h('th', { text: '상태' }), h('th', null)),
          (r.rooms || []).map(function (x) { return h('tr', null, h('td', { text: x.no }), h('td', { text: x.type || '-' }), h('td', null, statePill(x.state)), h('td', null, h('button', { class: 'link', type: 'button', onclick: function () { roomSheet(x, paintRooms); }, text: '수정' }))); })));
        roomsBox.appendChild(h('button', { class: 'btn sm ghost', style: 'margin-top:10px', type: 'button', onclick: function () { roomSheet(null, paintRooms); }, text: '+ 호실 추가' }));
      });
    }
    paintRooms();
    // 관리자
    var adminsBox = h('div', { class: 'card' });
    box.appendChild(h('h2', { text: '관리자' }));
    box.appendChild(adminsBox);
    function paintAdmins() {
      api('admins').then(function (r) {
        adminsBox.textContent = '';
        adminsBox.appendChild(h('ul', { class: 'log' }, (r.admins || []).map(function (a) {
          return h('li', { class: 'row', style: 'align-items:center' }, h('span', { text: a.name + ' · ' + a.username + ' · ' + (a.role === 'owner' ? '최고' : '일반') + (a.active ? '' : ' (꺼짐)') }),
            a.id === ME.id ? h('span', { class: 'note', style: 'flex:0;white-space:nowrap', text: '나' }) : h('button', { class: 'link', style: 'flex:0;white-space:nowrap', type: 'button', onclick: function () { api('admin/active', { id: a.id, active: !a.active }).then(function (x) { x.ok ? paintAdmins() : alert(x.error); }); }, text: a.active ? '끄기' : '켜기' }));
        })));
        adminsBox.appendChild(h('button', { class: 'btn sm ghost', style: 'margin-top:10px', type: 'button', onclick: function () { inviteSheet(paintAdmins); }, text: '+ 관리자 초대' }));
      });
    }
    paintAdmins();
    // 변경 이력
    var logBox = h('ul', { class: 'log card' });
    box.appendChild(h('h2', { text: '변경 이력' }));
    box.appendChild(logBox);
    api('audit').then(function (r) {
      (r.list || []).forEach(function (x) { logBox.appendChild(h('li', null, h('small', { text: kt(x.at) + ' · ' + (x.who || '') + (x.room ? ' · ' + x.room + '호' : '') + ' ' }), h('b', { text: x.action }), x.detail ? ' · ' + x.detail : '')); });
      if (!(r.list || []).length) logBox.appendChild(h('li', { text: '없음' }));
    });
  }
  function roomSheet(x, done) {
    x = x || {};
    var close = sheet(x.id ? x.no + '호 수정' : '호실 추가', h('div', null, submitForm([
      h('div', { class: 'row' }, field('호실 번호', inp('text', 'no', x.no)), field('정렬 순서', inp('number', 'sort', x.sort || '', { inputmode: 'numeric' }))),
      field('타입', sel('type', TYPES, x.type)),
      field('구분', sel('kind', [['room', '일반 호실'], ['office', '사무실']], x.kind || 'room')),
      check('repair', '수리중 (입실자 등록 막기)', x.repair),
      field('메모', inp('text', 'memo', x.memo))
    ], '저장', function (d) { if (x.id) d.id = x.id; return api('room/save', d).then(function (r) { if (r.ok) { close(); done(); } return r; }); }),
    x.id ? h('button', { class: 'btn full redg', style: 'margin-top:10px', type: 'button', onclick: function () { if (confirm(x.no + '호를 지울까요?')) api('room/delete', { id: x.id }).then(function (r) { r.ok ? (close(), done()) : alert(r.error); }); }, text: '호실 지우기' }) : null));
  }
  function inviteSheet(done) {
    var out = h('div');
    var close = sheet('관리자 초대', h('div', null, submitForm([
      field('이름', inp('text', 'name', '')),
      field('권한', sel('role', [['staff', '일반 관리자 (입실자·입금·문자)'], ['owner', '최고 관리자 (모든 기능)']], 'staff'))
    ], '초대 링크 만들기', function (d) {
      return api('invite', d).then(function (r) {
        if (r.ok) {
          var link = location.origin + '/#invite=' + r.token;
          var li = inp('text', 'link', link, { readonly: true });
          out.textContent = '';
          out.appendChild(h('div', { class: 'warn', style: 'margin-top:12px' }, '이 링크를 ' + d.name + '님에게 카톡으로 보내 주세요. 3일 안에 한 번만 쓸 수 있습니다.'));
          out.appendChild(h('div', { class: 'copy', style: 'margin-top:8px' }, li, h('button', { class: 'btn sm', type: 'button', onclick: function () { li.select(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('복사했습니다'); }, function () { document.execCommand('copy'); toast('복사했습니다'); }); }, text: '복사' })));
          done();
        }
        return r;
      });
    }), out));
  }
  function pwSheet() {
    var close = sheet('비밀번호 변경', submitForm([
      field('지금 비밀번호', inp('password', 'old', '', { autocomplete: 'current-password' })),
      field('새 비밀번호', inp('password', 'new', '', { autocomplete: 'new-password' }), '8자 이상')
    ], '변경', function (d) { return api('password', d).then(function (r) { if (r.ok) { close(); toast('비밀번호를 바꿨습니다'); } return r; }); }));
  }
  function devBox() {
    return h('div', { class: 'card' }, h('b', { text: '🧪 시험용 날짜 (개발 환경에서만 보임)' }), submitForm([field('오늘 날짜로 칠 날', inp('date', 'date', TODAY))], '적용', function (d) {
      return api('dev/today', d).then(function (r) { if (r.ok) { TODAY = d.date; toast('시험 날짜 ' + d.date); } return r; });
    }));
  }

  boot();
})();
