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
      var todoIcon = { checkin: '🔑', checkout: '🚪', call: '📞', sms: '✉️', notion: '🔄' };
      frame(ME.bizName || '고시원 관리', {}, h('div', null,
        h('div', { class: 'sec' },
          h('div', { class: 'grid4' },
            h('div', { class: 'stat' }, h('span', { text: '전체 호실' }), h('b', { text: c.rooms })),
            h('div', { class: 'stat' }, h('span', { text: '입실' }), h('b', { text: c.live })),
            h('div', { class: 'stat' }, h('span', { text: '공실' }), h('b', { text: c.vacant })),
            h('div', { class: 'stat' + (c.late ? ' red' : '') }, h('span', { text: '미납' }), h('b', { text: c.late }))),
          smsBanner(r.sms),
          (c.reserved || c.repair) ? h('p', { class: 'note', text: (c.reserved ? '입실예정 ' + c.reserved + '실 ' : '') + (c.repair ? '· 수리중 ' + c.repair + '실' : '') }) : null,
          h('h2', { text: '오늘 할 일' }),
          r.todo.length ? h('ul', { class: 'list' }, r.todo.map(function (t) { return h('li', { class: 'todo', onclick: function () { location.hash = t.id ? '#/t/' + t.id : t.kind === 'notion' ? '#/settings' : '#/sms'; } }, h('span', { class: 'ic', text: todoIcon[t.kind] }), h('span', { text: t.text })); }))
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
      check('sms_off', '자동 문자 보내지 않음 (단기·특수 입실자)', t.sms_off),
      check('notion_off', '노션에 이름·전화 보내지 않음 (본인이 국외 이전을 원하지 않을 때)', t.notion_off)
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
      if (active || t.status === 'reserved') acts.push(h('button', { class: 'btn ghost', type: 'button', onclick: function () { noticeSheet({ id: t.id, label: room.no + '호 ' + t.name }); }, text: '✉️ 문자 보내기' }));
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
          r.sms && r.sms.length ? [h('h2', { text: '받은 자동 문자' }), h('ul', { class: 'log card' }, r.sms.map(function (x) { var st = STATUS[x.status] || [x.status, '']; return h('li', null, h('small', { text: kt(x.updated_at) + ' ' }), (KIND[x.kind] || x.kind) + ' ', h('span', { class: 'pill ' + st[1], text: st[0] })); }))] : null,
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

  /* ── 문자 ── */
  var MODE = { test: ['🧪 테스트 모드', 'b', '보내지 않고 오늘 보낼 대상·문구만 기록합니다'], live: ['🟢 실제 발송 중', 'g', '매일 오전 9시에 자동으로 보냅니다'], stopped: ['⛔ 긴급 정지', 'r', '자동 문자를 보내지 않습니다'] };
  function smsBanner(sm) {
    if (!sm) return null;
    var m = MODE[sm.mode];
    return h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:4px;cursor:pointer', onclick: function () { location.hash = '#/sms'; } },
      h('div', null, h('span', { class: 'pill ' + m[1], text: m[0] }), sm.lastRun ? h('span', { class: 'note', text: '  마지막 실행 ' + kt(sm.lastRun.at) + ' · 대상 ' + sm.lastRun.planned + '건' + (sm.lastRun.mode === 'live' ? ' · 보냄 ' + sm.lastRun.sent + (sm.lastRun.failed ? ' · 실패 ' + sm.lastRun.failed : '') : '') }) : h('span', { class: 'note', text: '  아직 실행 기록 없음' })),
      sm.noAccount ? h('div', { class: 'warn', text: '입금계좌 문구가 비어 있어 D-1·미납 문자가 보류됩니다 → 설정에서 입력' }) : null);
  }
  var STATUS = { pending: ['대기', ''], sending: ['요청 중', 'b'], sent: ['성공', 'g'], failed: ['실패', 'r'], unknown: ['결과 확인 필요', 'a'], cancelled: ['취소', ''] };
  var KIND = { d10: 'D-10 안내', d1: 'D-1 안내', dp1: 'D+1 미납', dp3: 'D+3 미납', op3: '운영자 미납 알림', opin: '운영자 입실 알림' };
  var RUNMODE = { test: '테스트', live: '발송', stopped: '정지', deferred: '시간대 밖' };
  function smsView() {
    frame('문자', {}, h('p', { class: 'loading', text: '불러오는 중…' }));
    api('sms').then(function (r) {
      if (!r.ok) return;
      TODAY = r.today;
      var m = MODE[r.mode];
      var owner = ME.role === 'owner';
      var head = h('div', { class: 'card' },
        h('div', { class: 'row', style: 'align-items:center' }, h('span', { class: 'big', style: 'font-size:17px', text: m[0] }),
          r.mode === 'stopped' ? h('button', { class: 'btn sm', style: 'flex:0;white-space:nowrap', type: 'button', onclick: function () { stopToggle(false); }, text: '다시 시작' })
            : h('button', { class: 'btn sm red', style: 'flex:0;white-space:nowrap', type: 'button', onclick: function () { if (confirm('자동 문자를 모두 멈출까요?')) stopToggle(true); }, text: '⛔ 긴급 정지' })),
        h('p', { class: 'note', text: m[2] }),
        h('p', { class: 'note', text: '이번 달 보낸 문자 ' + r.month.count + '건 · 약 ' + r.month.cost.toLocaleString('ko-KR') + '원 (부가세 별도)' + (r.balance ? ' · 솔라피 잔액 ' + (r.balance.balance + r.balance.point).toLocaleString('ko-KR') + '원' : '') }),
        !r.cfg.solapi ? h('div', { class: 'warn', text: '솔라피 키가 설정되지 않았습니다 (Cloudflare → 변수 및 비밀에 SOLAPI_KEY, SOLAPI_SECRET)' }) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: function () { noticeSheet(null); }, text: '📢 공지 문자' }),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: function () {
            if (!r.cfg.testPhone) return alert('설정에서 "시험 발송 받을 번호"를 먼저 넣어 주세요');
            if (!confirm(r.cfg.testPhone + '로 시험 문자 1건을 보냅니다')) return;
            api('sms/test', {}).then(function (x) { x.ok ? (toast('시험 문자를 보냈습니다'), reload()) : alert(x.error); });
          }, text: '내 번호로 시험 발송' })),
        !r.cfg.account ? h('div', { class: 'warn' }, '입금계좌 문구가 비어 있습니다. ', owner ? h('a', { href: '#/settings', text: '설정으로 이동' }) : '최고 관리자에게 요청해 주세요') : null,
        r.attention ? h('div', { class: 'warn', text: '결과 확인이 필요한 문자 ' + r.attention + '건 (아래 발송 기록)' }) : null);
      function stopToggle(stop) { api('sms/stop', { stop: stop }).then(function (x) { x.ok ? (toast(stop ? '정지했습니다' : '다시 시작했습니다'), reload()) : alert(x.error); }); }
      var planList = r.plan.length ? h('ul', { class: 'list' }, r.plan.map(function (p) {
        var body = h('pre', { style: 'white-space:pre-wrap;font:inherit;font-size:13px;margin:8px 0 0;background:var(--bg);padding:10px;border-radius:10px', hidden: true, text: p.text });
        return h('li', { class: 'card', style: 'padding:12px' },
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('b', { text: p.room + '호 ' + p.name }), h('span', { class: 'pill ' + (p.kind.indexOf('op') === 0 ? 'b' : ''), text: p.kindName }), p.retry ? h('span', { class: 'pill a', text: '재시도' }) : null, p.blocked ? h('span', { class: 'pill r', text: '보류: ' + p.blocked }) : null),
          h('div', { class: 'note', text: '받는 번호 ' + p.to + ' · ' + p.type + ' · ' + md(p.due) + ' 기준' }),
          h('button', { class: 'link', type: 'button', onclick: function () { body.hidden = !body.hidden; this.textContent = body.hidden ? '문구 보기' : '문구 접기'; }, text: '문구 보기' }), body);
      })) : h('p', { class: 'empty', text: '오늘 보낼 문자가 없습니다' });
      var runBtn = h('button', { class: 'btn full ghost', type: 'button', onclick: function () {
        if (r.mode === 'live' && !confirm('지금 실제로 ' + r.plan.filter(function (p) { return !p.blocked; }).length + '건을 보냅니다. 계속할까요?')) return;
        runBtn.disabled = true;
        api('sms/run', {}).then(function (x) { runBtn.disabled = false; if (!x.ok) return alert(x.error); var z = x.result; toast(z.skipped || (RUNMODE[z.mode] || z.mode) + ' 실행: 대상 ' + z.planned + '건' + (z.mode === 'live' ? ' · 보냄 ' + z.sent + ' · 실패 ' + z.failed : '')); reload(); });
      }, text: r.mode === 'live' ? '지금 보내기 (원래는 매일 9시 자동)' : '지금 실행해 기록 남기기 (보내지 않음)' });
      var logList = h('ul', { class: 'log card' }, r.log.length ? r.log.map(function (l) {
        var st = STATUS[l.status] || [l.status, ''];
        var need = l.status === 'unknown' || (l.status === 'failed' && l.tries >= 2);
        return h('li', null, h('small', { text: kt(l.updated_at) + ' ' }), h('b', { text: (l.room ? l.room + '호 ' + (l.name || '') : '') + ' ' }), (KIND[l.kind] || l.kind) + ' → ' + l.to_phone + ' ', h('span', { class: 'pill ' + st[1], text: st[0] }), l.err ? h('small', { text: ' ' + l.err }) : null,
          need ? h('div', { class: 'row', style: 'margin-top:4px' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { resolve(l.id, 'sent'); }, text: '실제로 감' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { resolve(l.id, 'resend'); }, text: '다시 보내기' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: function () { resolve(l.id, 'drop'); }, text: '안 보냄' })) : null);
      }) : h('li', { text: '아직 없습니다' }));
      function resolve(id, result) { api('sms/resolve', { id: id, result: result }).then(function (x) { x.ok ? reload() : alert(x.error); }); }
      var runsList = h('ul', { class: 'log card' }, r.runs.length ? r.runs.map(function (x) {
        return h('li', null, h('small', { text: kt(x.at) + ' · ' + (x.trigger === 'cron' ? '자동' : '수동') + ' ' }), h('b', { text: RUNMODE[x.mode] || x.mode }), ' · 대상 ' + x.planned + (x.mode === 'live' ? ' · 보냄 ' + x.sent + ' · 실패 ' + x.failed : '') + (x.blocked ? ' · 보류 ' + x.blocked : ''), x.note ? h('small', { text: ' ' + x.note }) : null);
      }) : h('li', { text: '아직 없습니다' }));
      frame('문자', {}, h('div', { class: 'sec' }, head,
        h('h2', { text: '오늘 보낼 문자 ' + r.plan.length + '건' }), r.plan.length ? h('p', { class: 'note', text: '예상 비용 약 ' + r.estimate + '원 (부가세 별도) · 입금 확인·퇴실예정·문자 제외로 바꾸면 바로 빠집니다' }) : null,
        planList, runBtn,
        h('h2', { text: '발송 기록' }), logList,
        h('h2', { text: '실행 기록' }), runsList));
    });
  }

  /* ── 공지 · 개별 문자 ── */
  function noticeSheet(single) {
    var close;
    var wrap = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
    close = sheet(single ? single.label + '에게 문자' : '공지 문자', wrap);
    Promise.all([api('notice/templates'), single ? Promise.resolve(null) : api('rooms')]).then(function (res) {
      var tpls = (res[0] && res[0].templates) || [];
      var rooms = res[1] ? res[1].rooms.filter(function (x) { return x.tenant; }) : [];
      var ta = h('textarea', { rows: 6, placeholder: '보낼 내용' });
      var tplSel = h('select', null, h('option', { value: '', text: '템플릿 고르기' }), tpls.map(function (t, i) { return h('option', { value: i, text: t.name }); }));
      tplSel.addEventListener('change', function () { if (tplSel.value !== '') ta.value = tpls[+tplSel.value].text; });
      var date = inp('date', 'date', '');
      var scope = single ? null : sel('scope', [['all', '입실 중인 전체'], ['rooms', '호실 고르기']], 'all');
      var roomBox = h('div', { style: 'display:none;grid-template-columns:repeat(3,1fr);gap:6px' }, rooms.map(function (x) { return h('label', { class: 'c', style: 'font-weight:500' }, h('input', { type: 'checkbox', value: x.id }), x.no + ' ' + x.tenant.name); }));
      if (scope) scope.addEventListener('change', function () { roomBox.style.display = scope.value === 'rooms' ? 'grid' : 'none'; });
      var incL = check('includeLeaving', '퇴실예정 포함', false), incR = check('includeReserved', '입실예정 포함', false);
      var out = h('div');
      var err = h('p', { class: 'err', hidden: true });
      function body() {
        var b = { text: ta.value, date: date.value };
        if (single) { b.scope = 'tenant'; b.tenant_id = single.id; }
        else {
          b.scope = scope.value;
          b.rooms = Array.prototype.filter.call(roomBox.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return +i.value; });
          b.includeLeaving = incL.querySelector('input').checked; b.includeReserved = incR.querySelector('input').checked;
        }
        return b;
      }
      var pv = h('button', { class: 'btn full ghost', type: 'button', text: '미리보기', onclick: function () {
        err.hidden = true; out.textContent = '';
        api('notice/preview', body()).then(function (r) {
          if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
          var send = h('button', { class: 'btn full', type: 'button', text: r.count + '명에게 보내기 (약 ' + r.cost + '원)', onclick: function () {
            if (!confirm(r.count + '명에게 문자를 보냅니다. 보내면 취소할 수 없습니다.')) return;
            send.disabled = true;
            var b = body(); b.expect = r.count;
            api('notice/send', b).then(function (x) {
              send.disabled = false;
              if (!x.ok) { err.textContent = x.error; err.hidden = false; return; }
              out.textContent = '';
              out.appendChild(h('div', { class: x.failed.length ? 'warn' : 'card' }, '보냄 ' + x.sent + '건' + (x.failed.length ? ' · 실패 ' + x.failed.length + '건: ' + x.failed.join(', ') : '')));
              toast('보냈습니다');
            });
          } });
          out.appendChild(h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:8px' },
            h('b', { text: '대상 ' + r.count + '명 · ' + r.type + ' · 약 ' + r.cost + '원 (부가세 별도)' }),
            h('p', { class: 'note', text: r.targets.join(', ') }),
            r.sample ? h('pre', { style: 'white-space:pre-wrap;font:inherit;font-size:13px;margin:0;background:var(--bg);padding:10px;border-radius:10px', text: r.sample }) : null,
            r.count ? send : h('p', { class: 'empty', text: '보낼 대상이 없습니다' })));
        });
      } });
      var saveTpl = h('button', { class: 'link', type: 'button', text: '이 문구를 템플릿으로 저장', onclick: function () {
        var name = prompt('템플릿 이름'); if (!name || !ta.value) return;
        tpls.push({ name: name, text: ta.value });
        api('notice/templates', { templates: tpls }).then(function (x) { x.ok ? toast('저장했습니다') : alert(x.error); });
      } });
      add(wrap, [field('템플릿', tplSel), field('내용', ta, '{호실} {이름} {날짜} {월세} {보증금} {입실일} {상호} 사용 가능'), field('{날짜}에 넣을 날', date),
        scope ? field('대상', scope) : null, scope ? roomBox : null, scope ? h('div', { class: 'row' }, incL, incR) : null, saveTpl, err, pv, out]);
    });
  }

  /* ── 설정: 노션 · 백업 ── */
  function notionBox() {
    var box = h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' });
    function paint() {
      api('notion').then(function (r) {
        box.textContent = '';
        if (!r.ok) return add(box, h('p', { class: 'err', text: r.error }));
        if (!r.token) add(box, h('div', { class: 'warn', text: '노션 토큰이 없습니다 (Cloudflare → 변수 및 비밀에 NOTION_TOKEN)' }));
        add(box, submitForm([field('입실자 현황 데이터베이스 주소', inp('text', 'roomsDb', r.roomsDb, { placeholder: 'https://www.notion.so/...' })), field('퇴실 기록 데이터베이스 주소', inp('text', 'outDb', r.outDb, { placeholder: '비워 두고 아래 [만들기]를 눌러도 됨' }))], '노션 주소 저장', function (d) {
          return api('notion/settings', d).then(function (x) { if (x.ok) { toast('저장했습니다'); paint(); } return x; });
        }));
        var q = r.queue || {};
        add(box, h('p', { class: 'note', text: '동기화: ' + (r.last ? '마지막 ' + kt(r.last.at.replace('T', ' ').slice(0, 19)) + ' · 성공 ' + r.last.ok + (r.last.failed ? ' · 실패 ' + r.last.failed : '') : '아직 없음') + ' · 대기 ' + (q.waiting || 0) + '건' + (q.failing ? ' · 재시도 중 ' + q.failing + '건 (' + (q.err || '') + ')' : '') }));
        var act = function (path, label, conf) {
          return h('button', { class: 'btn sm ghost', type: 'button', text: label, onclick: function () {
            if (conf && !confirm(conf)) return;
            var b = this; b.disabled = true;
            api(path, {}).then(function (x) { b.disabled = false; if (!x.ok) return alert(x.error); toast('완료' + (x.result && x.result.ok != null ? ': 성공 ' + x.result.ok + ' · 실패 ' + x.result.failed : '')); paint(); });
          } });
        };
        if (!r.imported) {
          var prev = h('div');
          add(box, h('div', { class: 'warn', text: '처음 한 번: 노션 입실자 현황을 이 사이트로 가져옵니다. 가져온 뒤부터는 이 사이트에서만 고치고, 노션은 보기 전용이 됩니다.' }));
          add(box, h('button', { class: 'btn sm', type: 'button', text: '1. 가져올 내용 미리보기', onclick: function () {
            prev.textContent = '불러오는 중…';
            api('notion/preview', {}).then(function (x) {
              prev.textContent = '';
              if (!x.ok) return add(prev, h('p', { class: 'err', text: x.error }));
              var bad = x.rows.filter(function (y) { return y.issues.length; });
              add(prev, h('table', { class: 'tbl' }, h('tr', null, h('th', { text: '호실' }), h('th', { text: '상태' }), h('th', { text: '이름' }), h('th', { text: '입실일' }), h('th', { text: '월세' }), h('th', { text: '확인' })),
                x.rows.map(function (y) { return h('tr', null, h('td', { text: y.no }), h('td', { text: y.state }), h('td', { text: y.name || '' }), h('td', { text: y.move_in || '' }), h('td', { text: y.rent != null ? y.rent : '' }), h('td', { class: y.issues.length ? 'err' : '', text: y.issues.length ? y.issues.join(', ') : (y.paidFor ? '입금 체크 → ' + md(y.paidFor) + '분' : y.paid ? '입금✓' : '') + (y.sms_off ? ' 🔕' : '') })); })));
              add(prev, h('p', { class: 'note', text: '노션의 "입금" 체크는 가장 최근 납부일 몫으로 처리됩니다. 다음 납부일이 10일 안이면 그 몫은 미입금으로 시작하니, 이미 받았다면 가져온 뒤 [입금 확인]을 눌러 주세요.' }));
              add(prev, bad.length ? h('div', { class: 'warn', text: '빨간 줄을 노션에서 먼저 고친 뒤 다시 미리보기 해 주세요' })
                : h('button', { class: 'btn full', style: 'margin-top:8px', type: 'button', text: '2. ' + x.rows.length + '줄 가져오기', onclick: function () {
                  if (!confirm('노션 입실자 현황을 가져옵니다 (처음 한 번만). 계속할까요?')) return;
                  this.disabled = true;
                  api('notion/import', {}).then(function (z) { z.ok ? (toast('호실 ' + z.result.rooms + ' · 입실자 ' + z.result.tenants + '명 가져옴'), paint()) : alert(z.error); });
                } }));
            });
          } }), prev);
        }
        add(box, h('div', { class: 'row' }, r.outDb ? null : act('notion/outdb', '퇴실 기록 DB 만들기'), act('notion/sync', '지금 동기화'), act('notion/resync', '전체 다시 보내기', '노션의 모든 줄을 사이트 내용으로 다시 덮어씁니다')));
      });
    }
    paint();
    return box;
  }
  function dataBox() {
    var link = function (what, label) { return h('a', { class: 'btn sm ghost', href: '/api/export?what=' + what, download: '', text: label }); };
    var file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    var msg = h('p', { class: 'note' });
    file.addEventListener('change', function () {
      var f = file.files[0]; file.value = ''; if (!f) return;
      var c = prompt('지금 데이터가 모두 백업 파일 내용으로 바뀝니다. 계속하려면 "복구"라고 입력하세요');
      if (c !== '복구') return;
      msg.textContent = '복구 중…';
      f.text().then(function (t) {
        var data; try { data = JSON.parse(t); } catch (e) { msg.textContent = '백업 파일을 읽지 못했습니다'; return; }
        api('restore', { data: data, confirm: c }).then(function (x) { msg.textContent = x.ok ? '복구했습니다: ' + Object.keys(x.counts).map(function (k) { return k + ' ' + x.counts[k]; }).join(', ') : x.error; });
      });
    });
    return h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' },
      h('b', { text: '엑셀(CSV) 내려받기' }),
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, link('tenants', '입실자'), link('arrears', '미납 현황'), link('payments', '입금 내역'), link('sms', '문자 기록')),
      h('b', { text: '전체 백업' }),
      h('p', { class: 'note', text: '한 달에 한 번 내려받아 두세요. 비밀번호·솔라피·노션 키는 들어가지 않습니다. Cloudflare에서도 최근 7일 안의 시점으로 되돌릴 수 있습니다.' }),
      h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '/api/backup', download: '', text: '백업 내려받기' }), h('button', { class: 'btn sm redg', type: 'button', onclick: function () { file.click(); }, text: '백업에서 복구' })), file, msg,
      h('p', { class: 'note', text: '보관 기간: 퇴실 3년 뒤 이름·전화·마스터 자동 삭제, 5년 뒤 장부 삭제, 변경 이력 2년.' }));
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
    // 문자 설정
    var smsBox = h('div', { class: 'card' });
    box.appendChild(h('h2', { text: '문자' }));
    box.appendChild(smsBox);
    api('sms/settings').then(function (r) {
      if (!r.ok) return;
      var c = r.cfg;
      var tplFields = Object.keys(r.defaults).map(function (k) {
        var ta = h('textarea', { name: 'tpl_' + k, rows: 5 }, c.templates[k]);
        var pv = h('pre', { style: 'white-space:pre-wrap;font:inherit;font-size:12px;margin:0;background:var(--bg);padding:8px;border-radius:8px', hidden: true });
        var btn = h('button', { class: 'link', type: 'button', text: '미리보기', onclick: function () { api('sms/preview', { kind: k, text: ta.value }).then(function (x) { pv.hidden = false; pv.textContent = x.text + '\n\n(' + x.bytes + '바이트 · ' + x.type + ')'; }); } });
        var reset = h('button', { class: 'link', type: 'button', text: '기본 문구로', onclick: function () { ta.value = r.defaults[k]; } });
        return h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, h('b', { style: 'font-size:13px', text: r.kinds[k].name }), ta, h('div', { style: 'display:flex;gap:12px' }, btn, reset), pv);
      });
      smsBox.appendChild(submitForm([
        check('testMode', '테스트 모드 (보내지 않고 대상만 기록)', c.testMode),
        !r.solapi ? h('p', { class: 'note', text: '솔라피가 연결되기 전에는 테스트 모드만 쓸 수 있습니다.' }) : null,
        field('발신번호', inp('tel', 'senderPhone', c.senderPhone, { placeholder: '솔라피에 등록한 번호' })),
        field('시험 발송 받을 번호', inp('tel', 'testPhone', c.testPhone, { placeholder: '내 휴대폰' })),
        field('운영자 알림 번호', inp('text', 'opPhones', (c.opPhones || []).join(', '), { placeholder: '여러 개는 쉼표로' }), 'D+3 미납·입실 확인 알림을 받을 번호'),
        field('입금계좌 문구', inp('text', 'account', c.account, { placeholder: '예: 국민 123-45-6789 (예금주 엄경환)' }), '비어 있으면 D-1·미납 문자는 보류'),
        h('div', { class: 'row' }, field('보내기 시작 (시)', inp('number', 'windowStart', c.windowStart)), field('보내기 끝 (시)', inp('number', 'windowEnd', c.windowEnd))),
        h('p', { class: 'note', text: '문구에 쓸 수 있는 값: {상호} {호실} {이름} {납부일} {금액} {남은금액} {계좌} {퇴실통보일} {입실일} {월세} {보증금} {경과일}' })
      ].concat(tplFields), '문자 설정 저장', function (d) {
        var tpl = {};
        Object.keys(r.defaults).forEach(function (k) { tpl[k] = d['tpl_' + k]; });
        var body = { testMode: d.testMode, senderPhone: d.senderPhone, testPhone: d.testPhone, opPhones: d.opPhones, account: d.account, windowStart: d.windowStart, windowEnd: d.windowEnd, templates: tpl };
        if (c.testMode && !d.testMode && !confirm('⚠️ 실제 발송으로 바꿉니다. 내일 오전 9시부터 입실자에게 문자가 갑니다. 계속할까요?')) return Promise.resolve({ ok: false, error: '취소했습니다' });
        return api('sms/settings', body).then(function (x) { if (x.ok) { toast('저장했습니다'); c.testMode = d.testMode; } return x; });
      }));
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
    // 노션 · 백업
    box.appendChild(h('h2', { text: '노션' }));
    box.appendChild(notionBox());
    box.appendChild(h('h2', { text: '내려받기 · 백업' }));
    box.appendChild(dataBox());
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
