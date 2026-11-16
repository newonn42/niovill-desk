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
call('setup',{'bizName':'니오빌원룸텔','name':'엄경환','username':'kyung','password':'testpass123'})
day=lambda d: call('dev/today',{'date':d})
day('2026-11-16')
call('room/save',{'no':'602'})
R={r['no']:r['id'] for r in call('rooms')['rooms']}
r=call('tenant/create',{'room_id':R['602'],'name':'','phone':'','move_in':'2026-11-17','rent':19,'deposit':0,'mode':'reserved'}); ok('예약: 이름·번호 없이 등록', r.get('ok'), r); A=r.get('id')
r=call('tenant/create',{'room_id':R['602'],'name':'','phone':'','move_in':'2026-11-17','rent':19,'deposit':0,'mode':'living'}); ok('이미 사는 분은 이름 필수', not r.get('ok'), r)
b=call('rooms'); x=[y for y in b['rooms'] if y['no']=='602'][0]; ok('호실판에 예약 표시', x['tenant'] and x['tenant']['name']=='', x)
day('2026-11-17'); d=call('dash'); ok('할 일: 이름·번호 입력 필요', any('이름·번호 입력 필요' in t['text'] for t in d['todo']), d['todo'])
r=call('tenant/checkin',{'id':A}); ok('이름·번호 없으면 입실 확인 막힘', not r.get('ok') and '이름과 전화번호' in r.get('error',''), r)
t=call('tenant?id=%d'%A)['tenant']
r=call('tenant/update',dict(id=A,name='홍길동',phone='01012341234',move_in=t['move_in'],deposit=5,rent=19)); ok('정보 수정으로 이름·번호 입력', r.get('ok'), r)
r=call('tenant/checkin',{'id':A,'firstPaid':True}); ok('입실 확인 성공', r.get('ok'), r)
print('FAIL',fails) if fails else print('ALL PASS')
