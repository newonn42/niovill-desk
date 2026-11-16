# D1 무료 한도(요청당 쿼리 50번) 검사: 실제 니오빌과 같은 18호실 규모 (개발 서버는 한도를 넘으면 오류를 냄)
import json, urllib.request, http.cookiejar, sys, os, datetime
S=sys.argv[1]; B='http://127.0.0.1:8788/'
cj=http.cookiejar.CookieJar(); O=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
mx={}
def call(path, body=None, raw=False):
    req=urllib.request.Request(B+'api/'+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try: r=O.open(req)
    except urllib.error.HTTPError as e: r=e
    q=int(r.headers.get('X-DB-Queries') or 0); k=path.split('?')[0]; mx[k]=max(mx.get(k,0),q)
    d=r.read(); return d if raw else json.loads(d)
fails=0
def ok(label, cond, extra=''):
    global fails
    print(('✅' if cond else '❌'), label, '' if cond else extra)
    if not cond: fails+=1
def cron(c='0+0+*+*+*'):
    urllib.request.urlopen(B+'cdn-cgi/handler/scheduled?cron='+c).read()
    import time; time.sleep(0.3)
call('setup',{'bizName':'니오빌원룸텔','name':'엄경환','username':'kyung','password':'testpass123'})
call('dev/today',{'date':'2026-11-16'})
call('notion/settings',{'roomsDb':'https://app.notion.com/p/2fc80bd3fbaf83c7b7098125b187fbf8'})
pv=call('notion/preview',{}); ok('미리보기: 합계 줄 빼고 19줄, 빨간 줄 없음', len(pv['rows'])==19 and not any(x['issues'] for x in pv['rows']), [(x['no'],x['issues']) for x in pv['rows'] if x['issues']] or len(pv['rows']))
n=0
while True:
    n+=1; r=call('notion/import',{'choices':{'616':{'cycle':'2w'}}})
    ok('가져오기 %d번째 호출 성공'%n, r.get('ok'), r)
    if not r.get('ok') or r['result']['done'] or n>10: break
ok('여러 번 나눠 끝까지: 입실자 17명', r.get('ok') and r['result']['done'] and r['result']['tenants']==17, r)
ok('나눠 가져옴 (2번 이상)', n>=2, n)
ok('끝난 뒤 다시 가져오기 거부', not call('notion/import',{})['ok'])
ok('가져오기 끝 표시', call('notion')['imported'])
rooms=call('rooms')['rooms']; ok('호실 18 + 사무실', len(rooms)==19, len(rooms))
pv=call('notion/preview',{}); ok('미리보기: 이미 가져옴 표시', sum(1 for x in pv['rows'] if x.get('already'))==17)
# 화면 하나씩
for p in ['dash','rooms','sms','out','audit?limit=50','notion','settings','sms/settings','notice/templates']: call(p)
for x in rooms:
    if x.get('tenant'): call('tenant?id=%d'%x['tenant']['id'])
call('export?what=tenants',raw=True); call('export?what=arrears',raw=True); call('backup',raw=True)
r=call('notion/backup',{}); ok('노션 백업', r.get('ok'), r)
# 실제 발송으로 40일
call('sms/settings',{'testMode':False,'senderPhone':'010-5872-6575','summaryPhone':'010-5872-6575'})
cq=[]
d=datetime.date(2026,11,16)
for i in range(40):
    call('dev/today',{'date':d.isoformat()}); cron(); call('rooms')
    if i%9==0: call('pay',{'tenant_id':rooms[i%17]['tenant']['id'] if rooms[i%17].get('tenant') else rooms[0]['tenant']['id'],'amount':30,'paid_on':d.isoformat()})
    d+=datetime.timedelta(days=1)
cron('30+0+*+*+*')
log=call('sms')['log']; ok('40일 동안 문자 발송됨', any(l['status']=='sent' and l['kind'] in ('d10','d7') for l in log), log[:3])
ok('오류 없음 (sending/unknown 없음)', not any(l['status'] in ('sending','unknown','pending') for l in log), [l for l in log if l['status'] in ('sending','unknown','pending')][:3])
import subprocess
q=subprocess.run(['npx','wrangler','d1','execute','desk-db','--local','--persist-to',S,'--json','--command',"SELECT value FROM settings WHERE key='dev_cron'"],capture_output=True,text=True,cwd='/home/claude/desk')
dc=json.loads(json.loads(q.stdout)[0]['results'][0]['value']); print('자동 실행 최대 쿼리 수:', dc['max'])
ok('자동 실행: 오류 없음 · 쿼리 45번 이하', not dc['errors'] and dc['max']<=45, dc)
print('요청별 최대 쿼리 수:', sorted(mx.items(), key=lambda x:-x[1])[:8])
ok('모든 화면 쿼리 45번 이하', max(mx.values())<=45, mx)
print('FAIL',fails) if fails else print('ALL PASS')
