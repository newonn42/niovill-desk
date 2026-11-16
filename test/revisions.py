# 계획 수정본: 납부일 직접 수정 · 최근 입금 취소 · 7일 전 통보 · URL 금지 · 잔액 기준 (DEV=1, SMS_MOCK=1)
import json, urllib.request, http.cookiejar
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
day('2026-11-16'); call('room/save',{'no':'601'}); call('room/save',{'no':'602'})
R={r['no']:r['id'] for r in call('rooms')['rooms']}
A=call('tenant/create',{'room_id':R['601'],'name':'가','phone':'01011112222','move_in':'2026-06-15','rent':35,'deposit':50,'mode':'living','paidCurrent':False})['id']
t=call('tenant?id=%d'%A); ok('11/15분 미납 D+1', t['ledger']['code']=='late' and t['ledger']['due']=='2026-11-15', t['ledger'])
r=call('tenant/nextdue',{'id':A,'date':'2026-11-25'}); ok('다음 납부일 11/15 → 11/25', r.get('ok'), r)
t=call('tenant?id=%d'%A); ok('미납 사라지고 다음 납부 11/25 (35만원)', t['ledger']['code']=='upcoming' and t['ledger']['nextDue']=='2026-11-25' and t['charges'][0]['amount']==350000, (t['ledger'],t['charges'][:2]))
ok('11/15분은 해당 없음으로 남음', any(c['due']=='2026-11-15' and c['void'] for c in t['charges']))
day('2026-12-15'); call('rooms'); t=call('tenant?id=%d'%A); ok('이후도 25일 기준 (12/25)', any(c['due']=='2026-12-25' for c in t['charges']), [c['due'] for c in t['charges']])
call('pay',{'tenant_id':A,'amount':35,'paid_on':'2026-12-15'}); call('pay',{'tenant_id':A,'amount':10,'paid_on':'2026-12-15'})
r=call('pay/cancel-last',{'tenant_id':A}); t=call('tenant?id=%d'%A)
ok('최근 입금 취소 → 10만원 건만 취소', r.get('ok') and [p['amount'] for p in t['payments'] if p['cancelled_at']]==[100000], [(p['amount'],p['cancelled_at']) for p in t['payments']])
ok('사유 없어도 취소 가능 (기본 사유)', t['payments'][0]['cancel_reason']=='최근 입금 취소')
r=call('sms/settings',{'templates':{'d1':'[{상호}] 납부 안내 www.niovill.com 확인'}}); ok('문구에 주소 넣으면 거부', not r['ok'] and '인터넷 주소' in r['error'], r)
r=call('notice/preview',{'scope':'all','text':'공지 https://a.kr'}); ok('공지에 주소 넣으면 거부', not r['ok'], r)
ok('잔액 경고 기준 저장', call('sms/settings',{'balanceWarn':5000,'summaryPhone':'010-5872-6575'})['ok'] and call('sms/settings')['cfg']['balanceWarn']==5000)
ok('발신번호 변경 이력', call('sms/settings',{'senderPhone':'01011110000'})['ok'] and call('sms/settings',{'senderPhone':'01022220000'})['ok'] and any('답장도 새 번호' in (x['detail'] or '') for x in call('audit')['list']))
B2=call('tenant/create',{'room_id':R['602'],'name':'나','phone':'01033334444','move_in':'2026-10-01','rent':30,'deposit':50,'mode':'living','paidCurrent':True})['id']
call('tenant/leaving',{'id':B2,'leave_date':'2026-12-31'})
r=call('tenant/checkout',{'id':B2,'out_date':'2026-12-31','dep_refund':50,'dep_deduct':0,'dep_notice':True}); ok('퇴실 처리 (7일 전 통보 O)', r.get('ok'), r)
o=[x for x in call('out')['list'] if x['id']==B2][0]; ok('퇴실 기록에 7일 전 통보 저장', o['dep_notice']==1, o)
csv=urllib.request.urlopen(urllib.request.Request(B+'api/export?what=tenants')) if False else None
print('FAIL',fails) if fails else print('ALL PASS')
