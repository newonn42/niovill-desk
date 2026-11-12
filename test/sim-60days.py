import json, urllib.request, urllib.parse, http.cookiejar, subprocess, datetime, os
B='http://127.0.0.1:8788/'
cj=http.cookiejar.CookieJar(); O=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None):
    req=urllib.request.Request(B+'api/'+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try: return json.loads(O.open(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
def cron(): urllib.request.urlopen(B+'cdn-cgi/handler/scheduled?cron=0+0+*+*+*').read()
fails=0
def ok(label, cond, extra=''):
    global fails
    print(('✅' if cond else '❌'), label, '' if cond else extra)
    if not cond: fails+=1
call('setup',{'bizName':'니오빌원룸텔','name':'엄경환','username':'kyung','password':'testpass123'})
call('dev/today',{'date':'2026-02-01'})
for no in range(201,210): call('room/save',{'no':str(no),'sort':no})
R={r['no']:r['id'] for r in call('rooms')['rooms']}
def reg(no,name,phone,mi,rent,mode='living',paid=False,**kw):
    d={'room_id':R[str(no)],'name':name,'phone':phone,'move_in':mi,'rent':rent,'deposit':50,'mode':mode,'paidCurrent':paid}; d.update(kw)
    r=call('tenant/create',d); assert r['ok'], r; return r['id']
T={}
T['A']=reg(201,'에이','01011110001','2026-01-31',32,paid=True)
T['B']=reg(202,'비','01011110002','2026-01-15',30)
T['C']=reg(203,'씨','01011110003','2026-02-05',30,mode='reserved',sms_off=True)
T['D']=reg(204,'디','01011110000','2026-01-20',30)          # 가짜 발송 실패 번호
T['E']=reg(205,'이','01011119999','2026-01-25',30)          # 결과 불확실 번호
T['F']=reg(206,'에프','01011110006','2026-01-22',30)
T['G']=reg(207,'지','01011110007','2026-01-28',30,paid=True)
T['H']=reg(208,'에이치','01011110008','2026-01-26',30,paid=True)
T['I']=reg(209,'아이','01011110009','2026-02-12',30,mode='reserved')
call('pay',{'tenant_id':T['H'],'amount':60,'paid_on':'2026-02-01'})   # 두 달 선입금
call('sms/settings',{'senderPhone':'01012345678','opPhones':'010-9000-1234','account':''})
d=datetime.date(2026,2,1)
while d<=datetime.date(2026,4,1):
    ds=d.isoformat(); call('dev/today',{'date':ds})
    if ds=='2026-02-05':
        log=call('sms')['log']; ok('테스트 모드 4일간 실제 기록 0건', len(log)==0, log[:2])
        runs=call('sms')['runs']; ok('테스트 모드 실행 기록 남음', sum(1 for x in runs if x['mode']=='test')>=4)
        call('tenant/checkin',{'id':T['C'],'move_in':'2026-02-05','firstPaid':True})
        ok('실제 발송 전환', call('sms/settings',{'testMode':False})['ok'])
    if ds=='2026-02-10': call('sms/settings',{'account':'국민 123-45-6789 엄경환'})
    if ds=='2026-03-05': call('sms/stop',{'stop':True})
    if ds=='2026-03-06': call('sms/stop',{'stop':False})
    if ds!='2026-02-18': cron()           # 2/18 하루 실행 누락
    if ds=='2026-02-20':
        cron()                            # 같은 날 두 번
        call('sms/run',{})                # 수동 한 번 더
        call('pay',{'tenant_id':T['G'],'amount':10,'paid_on':ds})
    if ds=='2026-02-13': call('tenant/checkin',{'id':T['I'],'move_in':'2026-02-12','firstPaid':True})
    if ds=='2026-02-17': call('tenant/leaving',{'id':T['F']})
    if ds=='2026-02-27': call('pay',{'tenant_id':T['A'],'amount':32,'paid_on':ds})
    if ds=='2026-03-22': call('pay',{'tenant_id':T['A'],'amount':32,'paid_on':ds})
    if ds in ('2026-03-12','2026-04-12'): call('pay',{'tenant_id':T['I'],'amount':30,'paid_on':ds})
    if ds in ('2026-03-05','2026-04-05'): call('pay',{'tenant_id':T['C'],'amount':30,'paid_on':ds})
    d+=datetime.timedelta(days=1)
q=subprocess.run(['npx','wrangler','d1','execute','desk-db','--local','--persist-to',os.environ['PERSIST'],'--json','--command',
  "SELECT t.name, l.kind, l.slot, l.status, l.tries, c.due, l.text FROM sms_log l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN charges c ON c.id=l.charge_id ORDER BY t.name, c.due, l.kind"],capture_output=True,text=True,cwd='/home/claude/desk')
rows=json.loads(q.stdout)[0]['results']
by=lambda n:[(r['kind'],r['due'][5:] if r['due'] else '',r['status'],r['tries']) for r in rows if r['name']==n and r['slot']=='T']
ops=[(r['name'],r['kind'],r['status']) for r in rows if r['slot']!='T']
print('A',by('에이')); print('B',by('비')); print('D',by('디')); print('E',by('이')); print('F',by('에프')); print('G',by('지')); print('ops',ops)
ok('A: D-10(2/18 누락→2/19) · D-1 · D-10(3/31분), 입금 후 미납 문자 없음', by('에이')==[('d1','02-28','sent',1),('d10','02-28','sent',1),('d10','03-31','sent',1)])
ok('B 미납: 2/15분·3/15분 각 4종 (정지일 3/5 → 3/6 보완)', sorted(by('비'))==sorted([(k,'02-15','sent',1) for k in ['d10','d1','dp1','dp3']]+[(k,'03-15','sent',1) for k in ['d10','d1','dp1','dp3']]))
ok('C 문자 제외 → 0건', by('씨')==[])
ok('D 실패 → 1번만 재시도 (tries 2)', all(r[2]=='failed' and r[3]==2 for r in by('디')) and len(by('디'))>0)
ok('E 결과 불확실 → 다시 보내지 않음', all(r[2]=='unknown' and r[3]==1 for r in by('이')) and len(by('이'))>0)
ok('F 퇴실예정 이후 중단 (D-10만)', by('에프')==[('d10','02-22','sent',1)])
ok('H 선입금 → 0건', by('에이치')==[])
g=[r for r in rows if r['name']=='지' and r['kind']=='d1' and r['due']=='2026-02-28']
ok('G 부분 입금 → D-1에 남은 금액 20만원', g and '20만원' in g[0]['text'], g)
ok('운영자: B 미납 2번 · I 입실 확인 1번', sorted([o for o in ops if o[0] in ('비','아이')])==sorted([('비','op3','sent'),('비','op3','sent'),('아이','opin','sent')]), ops)
ok('계좌 비어 있던 2/5~2/9엔 D-1 보류', not any(r['kind']=='d1' and r['due'] and r['due']<'2026-02-10' for r in rows))
runs=json.loads(subprocess.run(['npx','wrangler','d1','execute','desk-db','--local','--persist-to',os.environ['PERSIST'],'--json','--command',"SELECT day, trigger, mode FROM runs ORDER BY id"],capture_output=True,text=True,cwd='/home/claude/desk').stdout)[0]['results']
ok('2/20 자동 실행 1번만 (두 번째 건너뜀)', sum(1 for x in runs if x['day']=='2026-02-20' and x['trigger']=='cron')==1)
ok('3/5 긴급 정지 기록', any(x['day']=='2026-03-05' and x['mode']=='stopped' for x in runs))
ok('2/18 실행 없음 (누락 재현)', not any(x['day']=='2026-02-18' for x in runs))
st=call('sms'); ok('결과 확인 필요 표시', st['attention']>0)
lid=[l for l in st['log'] if l['status']=='unknown'][0]['id']; ok('관리자: 실제로 감 처리', call('sms/resolve',{'id':lid,'result':'sent'})['ok'])
print('FAIL',fails) if fails else print('ALL PASS')
