import json, urllib.request, http.cookiejar, time, os, sys
S=sys.argv[1]; B='http://127.0.0.1:8788/'
cj=http.cookiejar.CookieJar(); O=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None, raw=False):
    req=urllib.request.Request(B+'api/'+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try:
        r=O.open(req); d=r.read(); return d if raw else json.loads(d)
    except urllib.error.HTTPError as e: return json.loads(e.read())
fails=0
def ok(label, cond, extra=''):
    global fails
    print(('✅' if cond else '❌'), label, '' if cond else extra)
    if not cond: fails+=1
def lines(f): return [json.loads(l) for l in open(S+'/'+f)] if os.path.exists(S+'/'+f) else []
def nstate(**kw):
    s=json.load(open(S+'/notion_state.json')); s.update(kw); json.dump(s,open(S+'/notion_state.json','w'),ensure_ascii=False)
call('setup',{'bizName':'니오빌원룸텔','name':'엄경환','username':'kyung','password':'testpass123'})
call('dev/today',{'date':'2026-11-13'})
# ── 6. 솔라피 ──
call('sms/settings',{'senderPhone':'010-5872-6575','testPhone':'010-5872-6575','opPhones':'010-9000-1234','account':'국민 123-45-6789 엄경환'})
r=call('sms/test',{}); ok('시험 발송 (서명 검증 통과)', r.get('ok'), r)
sl=lines('solapi.log'); ok('발신·수신 번호 숫자만', sl and sl[-1]['from']=='01058726575' and sl[-1]['to']=='01058726575', sl[-1:])
st=call('sms'); ok('잔액 표시 4,500원', st['balance'] and st['balance']['balance']==4500, st.get('balance'))
d=call('dash'); ok('잔액 4,500원 < 기준 5,000원 → 충전 알림', any('잔액' in t['text'] for t in d['todo']), d['todo'])
# ── 8. 노션 가져오기 ──
ok('노션 주소 저장', call('notion/settings',{'roomsDb':'https://app.notion.com/p/2fc80bd3fbaf83c7b7098125b187fbf8'})['ok'])
pv=call('notion/preview',{}); bad=[x for x in pv['rows'] if x['issues']]
ok('미리보기 19줄 · 문제 줄 1개(309호)', len(pv['rows'])==19 and [b['no'] for b in bad]==['309'], (len(pv['rows']),bad))
r=call('notion/import',{}); ok('문제 있으면 가져오기 거부', not r['ok'] and '309' in r['error'], r)
s=json.load(open(S+'/notion_state.json')); s['rows']=[x for x in s['rows'] if x['no']!='309']; json.dump(s,open(S+'/notion_state.json','w'),ensure_ascii=False)
for i in range(6):
    r=call('notion/import',{})
    if not r.get('ok') or r['result']['done']: break
ok('가져오기 (나눠서 끝까지): 호실 18 · 입실자 15', r.get('ok') and r['result']['done'] and r['result']['rooms']==18 and r['result']['tenants']==15, r)
ok('두 번째 가져오기 거부', not call('notion/import',{})['ok'])
rooms=call('rooms')['rooms']; by={x['no']:x for x in rooms}
ok('사무실 · 공실 · 입실예정 · 퇴실예정 상태', by['사무실']['state']=='office' and by['306']['state']=='vacant' and by['305']['state']=='reserved' and by['304']['state']=='leaving', [(k,v['state']) for k,v in by.items()])
src={x['no']:x for x in json.load(open(S+'/notion_state.json'))['rows']}
mism=[]
for no,x in by.items():
    t=x['tenant']; n=src[no]
    if not t: continue
    if t['name']!=n['name'] or t['rent']!=n['rent']*10000 or t['move_in']!=n['move_in']: mism.append(no)
    if n['state'] in ('입실','퇴실예정') and n['paid']:
        tt=call('tenant?id=%d'%t['id'])
        if not any(p['method']=='기존' and p['amount']==n['rent']*10000 for p in tt['payments']): mism.append(no+'입금')
        if not any(c['paid']==c['amount'] for c in tt['charges']): mism.append(no+'배정')
ok('가져온 값 대조 (이름·월세·입실일·입금)', not mism, mism)
t1=call('tenant?id=%d'%by['201']['tenant']['id'])['tenant']; ok('마스터는 사이트에 저장', t1['master']=='#0000')
# ── 노션 백업 (자동 동기화 없음) ──
before=len(lines('notion.log'))
ok('가져온 뒤 자동 동기화 없음 (노션 수정 0건)', not any(x['op']=='patch' for x in lines('notion.log')))
r=call('notion/backup',{}); ok('노션에 백업 성공', r.get('ok') and r['result']['current']==15, r)
bk=[x for x in lines('notion.log') if x['op']=='backup'][-1]
ok('백업 위치: 니오빌 고시원 만실 고고! (제목 없는 칸 건너뜀)', bk['parent']=='3f880bd3fbaf809badc5dd1df8f8becb', bk['parent'])
ok('제목 "입실자 현황 날짜"', bk['title'].startswith('입실자 현황 2026-'), bk['title'])
t1,t2=bk['tables']
ok('표 2개: 현재 18호실 + 퇴실 기록', len(t1)==19 and t1[0][0]=='호실' and t2[0][0]=='호실', (len(t1),len(t2)))
ok('마스터(비번) 없음', not any('#0' in c for row in t1 for c in row) and '마스터' not in t1[0])
call('tenant/update',{'id':by['202']['tenant']['id'],'name':'이나래','phone':'010-2000-0002','deposit':50,'notion_off':True})
call('notion/backup',{}); bk2=[x for x in lines('notion.log') if x['op']=='backup'][-1]
row202=[r for r in bk2['tables'][0] if r[0]=='202'][0]; ok('"노션에 보내지 않음" → 이름·전화 가림', row202[2]=='(비공개)' and row202[3]=='', row202)
nb=call('notion'); ok('백업 목록 2개 (개수 제한 없음)', len(nb['backups'])==2)
ok('백업 삭제 (노션 휴지통)', call('notion/backup/delete',{'id':nb['backups'][-1]['id'],'day':'x'})['ok'] and any(x['op']=='archive' for x in lines('notion.log')))
ok('다른 페이지는 삭제 거부', not call('notion/backup/delete',{'id':'page-201'})['ok'])
tid=by['304']['tenant']['id']
call('tenant/checkout',{'id':tid,'out_date':'2026-11-13','dep_refund':50,'dep_deduct':0,'dep_notice':True})
call('notion/backup',{}); bk3=[x for x in lines('notion.log') if x['op']=='backup'][-1]
ok('퇴실 기록 표에 7일 전 통보 O', any(r[1]=='서파랑' and r[11]=='O' for r in bk3['tables'][1]), bk3['tables'][1][:3])
nstate(down=True); r=call('notion/backup',{}); ok('노션 오류면 화면에 실패 표시', not r['ok'] and '노션' in r['error'], r); nstate(down=False)
# ── 7. 공지 ──
pv=call('notice/preview',{'scope':'all','text':'[{상호}] {이름}님 {날짜} 방역','date':'2026-11-20'})
live=[x for x in call('rooms')['rooms'] if x['state']=='in']
ok('공지 대상 = 입실 중인 사람', pv['ok'] and pv['count']==len(live), (pv.get('count'),len(live)))
ok('{날짜} 없으면 거부', not call('notice/preview',{'scope':'all','text':'{날짜} 방역'})['ok'])
pv2=call('notice/preview',{'scope':'all','text':'방역','includeLeaving':True,'includeReserved':True}); ok('퇴실예정·입실예정 포함 선택 (퇴실예정 1명은 앞에서 퇴실 처리됨)', pv2['count']==pv['count']+1, (pv2['count'],pv['count']))
ok('인원 바뀌면 보내기 거부', not call('notice/send',{'scope':'all','text':'방역','expect':999})['ok'])
before=len(lines('solapi.log'))
r=call('notice/send',{'scope':'rooms','rooms':[by['201']['id'],by['204']['id'],by['205']['id']],'text':'[{상호}] {호실}호 {이름}님 안내','expect':3})
ok('호실 골라 공지: 3명 · 실패 1 · 불확실 1', r['ok'] and r['sent']==1 and len(r['failed'])==2, r)
ok('솔라피로 3건 요청', len(lines('solapi.log'))-before==3)
r=call('notice/send',{'scope':'tenant','tenant_id':by['202']['tenant']['id'],'text':'{이름}님 개별 안내','expect':1}); ok('개별 문자', r['ok'] and r['sent']==1, r)
# ── 자동 문자 실제 발송 (솔라피) ──
ok('실제 발송 전환', call('sms/settings',{'testMode':False})['ok'])
plan=call('sms')['plan']; r=call('sms/run',{}); print('   plan', len(plan), r.get('result'))
log=call('sms')['log']; st={l['status'] for l in log if l['kind'] in ('d10','d1','dp1','dp3')}
ok('자동 문자 실행 (성공/실패/불확실 구분)', r['ok'], r)
# ── 9. CSV · 백업 · 복구 ──
csv=call('export?what=tenants',raw=True); ok('CSV: 엑셀용 BOM + 머리글', csv.startswith(b'\xef\xbb\xbf') and '호실,이름'.encode() in csv[:40])
for w in ('arrears','payments','sms'): ok('CSV '+w, call('export?what='+w,raw=True).startswith(b'\xef\xbb\xbf'))
bk=json.loads(call('backup',raw=True)); ok('백업에 비밀번호·키 없음', 'admins' not in bk['tables'] and 'pw_hash' not in json.dumps(bk) and 'testsecret' not in json.dumps(bk))
counts={k:len(v) for k,v in bk['tables'].items()}
call('pay',{'tenant_id':by['202']['tenant']['id'],'amount':5,'paid_on':'2026-11-13'})
ok('복구 확인 문구 필요', not call('restore',{'data':bk,'confirm':'네'})['ok'])
r=call('restore',{'data':bk,'confirm':'복구'}); ok('복구', r.get('ok'), r)
bk2=json.loads(call('backup',raw=True)); t2={k:len(v) for k,v in bk2['tables'].items()}
ok('복구 후 백업 시점과 같음 (기록 표 제외)', all(t2[k]==counts[k] for k in counts if k not in ('audit',)) and bk2['tables']['payments']==bk['tables']['payments'], (counts,t2))
# ── 보관 기간 ──
call('dev/today',{'date':'2029-12-01'}); urllib.request.urlopen(B+'cdn-cgi/handler/scheduled?cron=30+0+*+*+*').read(); time.sleep(2)
t3=call('tenant?id=%d'%tid)['tenant']; ok('퇴실 3년 뒤 이름·전화·마스터 삭제', t3['name']=='(퇴실자)' and t3['phone']=='' and t3['master']=='' and t3['anon_at'], t3)
call('notion/backup',{}); bk4=[x for x in lines('notion.log') if x['op']=='backup'][-1]
ok('3년 지난 퇴실자는 백업 퇴실 표에서 빠짐', not any('서파랑' in r or '(퇴실자)' in r for r in bk4['tables'][1]), bk4['tables'][1][:2])
nb=call('notion'); ok('3년 지난 백업에 "3년 지남" 표시', any(b['old'] for b in nb['backups']))
call('dev/today',{'date':'2031-12-01'}); urllib.request.urlopen(B+'cdn-cgi/handler/scheduled?cron=30+0+*+*+*').read(); time.sleep(2)
td=call('tenant?id=%d'%tid); ok('퇴실 5년 뒤 장부 삭제', len(td['charges'])==0 and len(td['payments'])==0, (len(td['charges']),len(td['payments'])))
print('FAIL',fails) if fails else print('ALL PASS')
