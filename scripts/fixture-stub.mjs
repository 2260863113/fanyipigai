/**
 * 页面里的批改接口桩。
 *
 * 用途：截屏与离线演示需要"已经批改好"的界面，但不该为此花 API 钱。
 * 这个桩把 /api/judge 的响应替换成给定的批改结果，前端拿到的东西与真实接口完全同形，
 * 因此走的是同一套校验与渲染代码——截出来的界面与真实使用一致。
 *
 * 用法：由 scripts/shots.mjs 读入，经 CDP 在页面加载前注入。
 */

/** 生成注入到页面里的脚本源码。payload 是接口成功时的响应体。 */
export function buildStubSource(payload) {
  return `
    (() => {
      const payload = ${JSON.stringify(payload)};
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!url.includes('/api/judge')) return original(input, init);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      window.__judgeStub = true;
    })();
  `
}
