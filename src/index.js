/* 고시원 관리 프로그램 – Worker 입구 (검색에 노출되지 않음) */
import { ensureSchema, countingDb } from './db.js';
import { handleApi } from './api.js';
import { runSms } from './sms.js';
import { getSetting } from './db.js';
import { retention } from './data.js';
import { kstToday } from './dates.js';

const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) return new Response(JSON.stringify({ ok: false, error: '데이터베이스가 연결되지 않았습니다' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      env = Object.assign({}, env, { DB: countingDb(env.DB, env.DEV === '1') });
      await ensureSchema(env.DB);
      const res = await handleApi(request, env, url.pathname.slice(5));
      const h = new Headers(res.headers);
      if (env.DB.count > 35) console.log('D1 queries', url.pathname, env.DB.count);
      if (env.DEV === '1') h.set('X-DB-Queries', String(env.DB.count));
      h.set('X-Robots-Tag', NOINDEX['X-Robots-Tag']);
      return new Response(res.body, { status: res.status, headers: h });
    }
    return env.ASSETS.fetch(request);
  },
  // 매일 09:00 (한국 시간): 납부 예정분 만들기 → 자동 문자 (테스트 모드면 대상만 기록)
  // 09:30에는 보관 기간 정리 (쿼리 한도 때문에 문자와 따로 실행)
  async scheduled(event, env, ctx) {
    env = Object.assign({}, env, { DB: countingDb(env.DB, env.DEV === '1') });
    await ensureSchema(env.DB);
    const today = (env.DEV === '1' && (await getSetting(env.DB, 'dev_today', null))) || kstToday();
    const job = event && event.cron === '30 0 * * *' ? 'retention' : 'sms';
    ctx.waitUntil((async () => {
      let err = null;
      if (job === 'sms') { try { await runSms(env, { trigger: 'cron', today }); } catch (e) { err = String(e && e.message); console.log('sms failed', e && e.stack); } }
      else { try { await retention(env, today); } catch (e) { err = String(e && e.message); console.log('retention failed', e && e.stack); } }
      console.log('cron', job, 'D1 queries', env.DB.count);
      // 개발 모드: 시험용으로 가장 많이 쓴 쿼리 수·오류를 남김
      if (env.DEV === '1') {
        const prev = await env.DB.real.prepare("SELECT value FROM settings WHERE key = 'dev_cron'").first();
        const p = prev ? JSON.parse(prev.value) : { max: 0, errors: [] };
        p.max = Math.max(p.max, env.DB.count);
        if (err) p.errors.push(today + ' ' + job + ': ' + err);
        await env.DB.real.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dev_cron', ?)").bind(JSON.stringify(p)).run();
      }
    })());
  }
};
