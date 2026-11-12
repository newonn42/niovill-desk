/* 고시원 관리 프로그램 – Worker 입구 (검색에 노출되지 않음) */
import { ensureSchema } from './db.js';
import { handleApi } from './api.js';
import { runSms } from './sms.js';
import { getSetting } from './db.js';
import { retention } from './data.js';
import { processQueue } from './notion.js';
import { kstToday } from './dates.js';

const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) return new Response(JSON.stringify({ ok: false, error: '데이터베이스가 연결되지 않았습니다' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      await ensureSchema(env.DB);
      const res = await handleApi(request, env, url.pathname.slice(5));
      // 바뀐 내용은 응답 뒤에 노션으로 (실패해도 화면에는 영향 없음)
      if (request.method === 'POST' && res.status === 200 && ctx) ctx.waitUntil(processQueue(env, 6).catch(() => {}));
      const h = new Headers(res.headers);
      h.set('X-Robots-Tag', NOINDEX['X-Robots-Tag']);
      return new Response(res.body, { status: res.status, headers: h });
    }
    return env.ASSETS.fetch(request);
  },
  // 매일 09:00 (한국 시간): 납부 예정분 만들기 → 자동 문자 (테스트 모드면 대상만 기록)
  async scheduled(event, env, ctx) {
    await ensureSchema(env.DB);
    const today = (env.DEV === '1' && (await getSetting(env.DB, 'dev_today', null))) || kstToday();
    ctx.waitUntil((async () => {
      try { await runSms(env, { trigger: 'cron', today }); } catch (e) { console.log('sms failed', e && e.stack); }
      try { await retention(env, today); } catch (e) { console.log('retention failed', e && e.stack); }
      try { await processQueue(env, 8); } catch (e) { console.log('notion failed', e && e.stack); }
    })());
  }
};
