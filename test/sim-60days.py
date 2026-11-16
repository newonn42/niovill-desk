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
call('sms/settings',{'senderPhone':'01012345678','opPhones':'010-9000-1234','summaryPhone':'010-5872-6575','account':''})
d=datetime.date(2026,2,1)
while d<=datetime.date(2026,4,1):
    ds=d.isoformat(); call('dev/today',{'date':ds})
    if ds=='2026-02-05':
        log=[l for l in call('sms')['log'] if l['kind']!='summary']; ok('테스트 모드 4일간 입실자 문자 0건 (운영자 요약만)', len(log)==0, log[:2])
        runs=call('sms')['runs']; ok('테스트 모드 실행 기록 남음', sum(1 for x in runs if x['mode']=='test')>=4)
        call('tenant/checkin',{'id':T['C'],'move_in':'2026-02-05','firstPaid':True})
        ok('실제 발송 전환', call('sms/settings',{'testMode':False})['ok'])
    if ds=='2026-02-10': call('sms/settings',{'account':'국민 123-45-6789 엄경환'})
    if ds=='2026-03-05': call('sms/stop',{'stop':True})
    if ds=='2026-03-08': call('sms/stop',{'stop':False})   # 3/5~3/7 정지 → B의 3/15분 D-10 놓침, 3/8 D-7만
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
ok('A: D-10(2/18 누락→2/19) · D-7 · D-10(3/31분), 3/22 입금 후 D-7 없음', by('에이')==[('d10','02-28','sent',1),('d7','02-28','sent',1),('d10','03-31','sent',1)], by('에이'))
ok('B: 2/15분 D-10·D-7 / 3/15분은 정지로 D-10 놓침 → D-7만', by('비')==[('d10','02-15','sent',1),('d7','02-15','sent',1),('d7','03-15','sent',1)], by('비'))
b7=[r for r in rows if r['name']=='비' and r['kind']=='d7' and r['due']=='2026-03-15'][0]['text']
ok('D-7 문구: 오늘(3/8)이 마감 · 보증금 조항', '오늘(3월 8일(일))' in b7 and '보증금' in b7, b7)
b10a=[r for r in rows if r['name']=='비' and r['kind']=='d10' and r['due']=='2026-02-15'][0]['text']
ok('D-10 문구: 7일 전 통보', '7일 전' in b10a, b10a)
ok('D-1·D+1·D+3 문자 0건 (꺼짐)', not any(r['kind'] in ('d1','dp1','op3') for r in rows))
ok('C 문자 제외 → 0건', by('씨')==[])
ok('D 실패 → D-10은 1번 재시도 (tries 2)', [r for r in by('디') if r[0]=='d10']==[('d10','02-20','failed',2),('d10','03-20','failed',2)], by('디'))
ok('E 결과 불확실 → 다시 보내지 않음 · 2/18 누락일의 D-7은 안 감', by('이')==[('d10','02-25','unknown',1),('d10','03-25','unknown',1),('d7','03-25','unknown',1)], by('이'))
ok('F 퇴실예정(2/17) 이후 중단', by('에프')==[('d10','02-22','sent',1),('d7','02-22','sent',1)])
ok('H 선입금 → 0건', by('에이치')==[])
ok('운영자: I 입실 확인 1번만 (미납 알림 없음)', [o for o in ops if o[1]!='summary']==[('아이','opin','sent')], ops)
runs=json.loads(subprocess.run(['npx','wrangler','d1','execute','desk-db','--local','--persist-to',os.environ['PERSIST'],'--json','--command',"SELECT day, trigger, mode FROM runs ORDER BY id"],capture_output=True,text=True,cwd='/home/claude/desk').stdout)[0]['results']
ok('2/20 자동 실행 1번만 (두 번째 건너뜀)', sum(1 for x in runs if x['day']=='2026-02-20' and x['trigger']=='cron')==1)
ok('3/5 긴급 정지 기록', any(x['day']=='2026-03-05' and x['mode']=='stopped' for x in runs))
sm=json.loads(subprocess.run(['npx','wrangler','d1','execute','desk-db','--local','--persist-to',os.environ['PERSIST'],'--json','--command',"SELECT charge_id, text, status FROM sms_log WHERE kind='summary' ORDER BY charge_id"],capture_output=True,text=True,cwd='/home/claude/desk').stdout)[0]['results']
days=sorted({x['day'] for x in runs if x['trigger']=='cron'})
ok('매일 요약 문자: 자동 실행한 날마다 1통 (0건·테스트·정지일 포함)', len(sm)==len(days) and len({x['charge_id'] for x in sm})==len(sm), (len(sm),len(days)))
ok('요약 문자 내용: 날짜·발송·잔액', all('잔액' in x['text'] and x['text'].startswith('[니오빌원룸텔]') for x in sm) and any('테스트모드' in x['text'] for x in sm) and any('긴급정지' in x['text'] for x in sm), sm[:2])
ok('2/18 실행 없음 (누락 재현)', not any(x['day']=='2026-02-18' for x in runs))
st=call('sms'); ok('결과 확인 필요 표시', st['attention']>0)
lid=[l for l in st['log'] if l['status']=='unknown'][0]['id']; ok('관리자: 실제로 감 처리', call('sms/resolve',{'id':lid,'result':'sent'})['ok'])
print('FAIL',fails) if fails else print('ALL PASS')
