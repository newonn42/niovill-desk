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
day('2026-11-18')
for no in ['601','602','603','604']: call('room/save',{'no':no})
R={r['no']:r['id'] for r in call('rooms')['rooms']}
A=call('tenant/create',{'room_id':R['601'],'name':'월세','phone':'01011112222','move_in':'2026-09-05','rent':35,'deposit':0,'mode':'living','paidCurrent':True})['id']
B2=call('tenant/create',{'room_id':R['602'],'name':'이주','phone':'01011113333','move_in':'2026-11-10','rent':18,'deposit':0,'mode':'living','cycle':'2w','paidCurrent':False})['id']
C=call('tenant/create',{'room_id':R['603'],'name':'','phone':'','move_in':'2026-11-25','rent':30,'deposit':0,'mode':'reserved'})['id']
call('tenant/leaving',{'id':A,'leave_date':'2026-12-05'})
# 현금영수증
r=call('rooms'); ok('호실: 이번 달 ym', r['ym']=='2026-11')
r=call('cash/toggle',{'tenant_id':A,'done':True}); ok('현영 체크', r.get('ok'))
r=call('rooms'); t=[x for x in r['rooms'] if x['no']=='601'][0]['tenant']; ok('호실표에 체크 표시', t['cr'] is True, t)
r=call('cash/toggle',{'tenant_id':A,'done':True}); ok('두 번 눌러도 1개', r.get('ok'))
call('cash/toggle',{'tenant_id':A,'done':False}); t=[x for x in call('rooms')['rooms'] if x['no']=='601'][0]['tenant']; ok('체크 해제', t['cr'] is False)
call('cash/toggle',{'tenant_id':A,'done':True})
day('2026-12-01'); t=[x for x in call('rooms')['rooms'] if x['no']=='601'][0]['tenant']; ok('다음 달엔 다시 빈칸', t['cr'] is False and call('rooms')['ym']=='2026-12')
day('2026-11-18')
# 달력
c=call('calendar?ym=2026-11'); ev=c['events']
ok('601 11/5 납부 완납', any(e['tid']==A and e['day']=='2026-11-05' and e['st']=='paid' for e in ev if e['kind']=='due'), ev)
ok('602 2주: 11/10 미납 · 11/24 예정', any(e['tid']==B2 and e['day']=='2026-11-10' and e['st']=='late' for e in ev if e['kind']=='due') and any(e['tid']==B2 and e['day']=='2026-11-24' for e in ev if e['kind']=='due'), [e for e in ev if e.get('tid')==B2])
ok('603 입실예정 11/25', any(e['kind']=='in' and e['day']=='2026-11-25' and e['name']=='(이름 미정)' for e in ev))
c=call('calendar?ym=2026-12'); ev=c['events']
ok('12월: 601 퇴실예정 12/5 · 12/5 납부일 없음', any(e['kind']=='leave' and e['day']=='2026-12-05' for e in ev) and not any(e.get('tid')==A and e['kind']=='due' for e in ev), ev)
ok('12월: 602 12/8·12/22 예정', sorted(e['day'] for e in ev if e.get('tid')==B2 and e['kind']=='due')==['2026-12-08','2026-12-22'], ev)
c=call('calendar?ym=2027-03'); ok('먼 달도 예정 계산 (602 3월)', len([e for e in c['events'] if e.get('tid')==B2])>=2, c['events'])
r=call('memo/save',{'day':'2026-11-20','text':'605호 방보기 2시'}); ok('메모 추가', r.get('ok'))
m=[e for e in call('calendar?ym=2026-11')['events'] if e['kind']=='memo'][0]
r=call('memo/save',{'id':m['id'],'day':'2026-11-21','text':'방보기 3시로 변경'}); m2=[e for e in call('calendar?ym=2026-11')['events'] if e['kind']=='memo'][0]; ok('메모 수정 (날짜·내용)', m2['day']=='2026-11-21' and m2['text']=='방보기 3시로 변경', m2)
r=call('memo/save',{'day':'2026-11-20','text':''}); ok('빈 메모 거부', not r.get('ok'))
call('memo/delete',{'id':m['id']}); ok('메모 삭제', not any(e['kind']=='memo' for e in call('calendar?ym=2026-11')['events']))
print('FAIL',fails) if fails else print('ALL PASS')
