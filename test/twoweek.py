# 2주 계약 시나리오 (개발 서버: DEV=1, SMS_MOCK=1)
import json, urllib.request, http.cookiejar, sys
B='http://127.0.0.1:8788/'
cj=http.cookiejar.CookieJar(); O=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None):
    req=urllib.request.Request(B+'api/'+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try: return json.loads(O.open(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
fails=0
def ok(label, cond, extra=''):
    global fails
    print(('✅' if cond else '❌'), label, '' if cond else extra)
    if not cond: fails+=1
call('setup',{'bizName':'니오빌원룸텔','name':'엄경환','username':'kyung','password':'testpass123'})
day=lambda d: call('dev/today',{'date':d})
day('2026-11-20')
call('room/save',{'no':'601'}); call('room/save',{'no':'602'})
R={r['no']:r['id'] for r in call('rooms')['rooms']}
r=call('tenant/create',{'room_id':R['601'],'name':'단기','phone':'01033334444','move_in':'2026-11-20','rent':18,'deposit':10,'mode':'living','paidCurrent':True,'cycle':'2w'}); A=r['id']
t=call('tenant?id=%d'%A); ok('2주 계약 등록 · 입금됨 · 다음 12/4', t['ledger']['code']=='paid' and t['ledger']['nextDue']=='2026-12-04' and t['tenant']['cycle']=='2w', t['ledger'])
call('sms/settings',{'senderPhone':'01012345678','account':'국민 1-2-3','opPhones':'01090001234'})
day('2026-11-24'); call('rooms'); t=call('tenant?id=%d'%A); ok('D-10(11/24)에 12/4분 18만원 생성', t['charges'][0]['due']=='2026-12-04' and t['charges'][0]['amount']==180000, t['charges'][:1])
plan=call('sms')['plan']; p=[x for x in plan if x['name']=='단기']
ok('2주 계약도 D-10 안내 + 퇴실 7일 전 통보 문구', p and p[0]['kind']=='d10' and '11월 27일' in p[0]['text'] and '7일 전' in p[0]['text'], p[:1])
call('pay',{'tenant_id':A,'amount':18,'paid_on':'2026-11-24'})
day('2026-12-08'); call('rooms'); t=call('tenant?id=%d'%A); ok('다음 납부분 12/18 생성', t['charges'][0]['due']=='2026-12-18', [c['due'] for c in t['charges']])
day('2026-12-19'); t=call('tenant?id=%d'%A); ok('12/18 미납 D+1', t['ledger']['code']=='late' and t['ledger']['days']==1, t['ledger'])
p=[x for x in call('sms')['plan'] if x['name']=='단기']; ok('D+1 미납 문자', p and p[0]['kind']=='dp1', p[:1])
call('pay',{'tenant_id':A,'amount':18,'paid_on':'2026-12-19'})
r=call('tenant/cycle',{'id':A,'cycle':'month','rent':34,'eff_date':'2027-01-01'}); ok('2주 → 월 단위 변경 (1/1부터 34만원)', r.get('ok'), r)
day('2026-12-21'); call('rooms'); ok('D-10 전(12/21)엔 1/1분 없음', not any(c['due']=='2027-01-01' for c in call('tenant?id=%d'%A)['charges']))
day('2026-12-22'); call('rooms'); t=call('tenant?id=%d'%A); ok('첫 월 납부분 1/1 · 34만원', t['charges'][0]['due']=='2027-01-01' and t['charges'][0]['amount']==340000 and t['tenant']['cycle']=='month', t['charges'][:2])
ok('지난 2주 장부 그대로', [c['due'] for c in t['charges']][1:]==['2026-12-18','2026-12-04','2026-11-20'] and all(c['paid']==c['amount'] for c in t['charges'][1:]), [(c['due'],c['paid']) for c in t['charges']])
day('2027-01-22'); call('rooms'); t=call('tenant?id=%d'%A); ok('다음은 2/1 (월 단위)', any(c['due']=='2027-02-01' for c in t['charges']), [c['due'] for c in t['charges']])
# 입실예정 2주 → 입실 확인
r=call('tenant/create',{'room_id':R['602'],'name':'예정','phone':'01055556666','move_in':'2027-01-25','rent':20,'deposit':0,'mode':'reserved','cycle':'2w'}); B2=r['id']
ok('입실예정 금액·단위 수정', call('tenant/update',{'id':B2,'name':'예정','phone':'01055556666','deposit':0,'cycle':'2w','rent':19,'move_in':'2027-01-25'})['ok'] and call('tenant?id=%d'%B2)['tenant']['rent']==190000)
day('2027-01-25'); call('tenant/checkin',{'id':B2,'firstPaid':True}); t=call('tenant?id=%d'%B2)
ok('입실 확인 후 2주 주기 · 다음 2/8', t['ledger']['nextDue']=='2027-02-08', t['ledger'])
print('FAIL',fails) if fails else print('ALL PASS')
