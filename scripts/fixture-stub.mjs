/**
 * 页面里的批改接口桩。
 *
 * 用途：截屏与离线演示需要"已经批改好"的界面，但不该为此花 API 钱。
 * 这个桩把 /api/judge 的响应替换成给定的批改结果，前端拿到的东西与真实接口完全同形，
 * 因此走的是同一套校验与渲染代码——截出来的界面与真实使用一致。
 *
 * payloads 是「示例作答 → 接口响应」的映射：
 * 桩按提交回来的作答文字判断是哪一道示例，返回对应结果，
 * 这样同一个桩就能服务切换题型后的多次提交（否则切到别的题会拿到不相干的批改）。
 *
 * 用法：由 scripts/visual.ts 读入，经 CDP 在页面加载前注入。
 */

/** 生成注入到页面里的脚本源码。payloads 是 [{ answer, payload }]。 */
export function buildStubSource(payloads) {
  const fallback = payloads[0]?.payload
  if (!fallback) throw new Error('接口桩没有可用的响应')
  return `
    (() => {
      const table = ${JSON.stringify(payloads)};
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!url.includes('/api/judge')) return original(input, init);

        // 按提交的作答反查是哪一道示例
        let submitted = '';
        try {
          const body = JSON.parse((init && init.body) || '{}');
          submitted = (body.answerSections || []).map((s) => s.text).join('\\n\\n').trim();
        } catch (error) {
          submitted = '';
        }
        const hit = table.find((item) => item.answer.trim() === submitted);
        return new Response(JSON.stringify((hit && hit.payload) || table[0].payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      window.__judgeStub = true;
    })();
  `
}
