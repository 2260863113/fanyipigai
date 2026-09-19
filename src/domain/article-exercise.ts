/**
 * 把文章库里的一篇选段，变成本站通用的**题目**对象。
 *
 * 与自定义题（domain/custom.ts）走的是同一条路：文章库与自定义题都没有手写的示例作答，
 * 因此两者的 Exercise 都只由文本本身推导出来。差别在于：
 *   文章库的领域是**已经定好的**（选了哪个领域就是哪个），方向也是；
 *   自定义题的领域为空、方向靠猜。
 *
 * 为什么不给文章库生成参考译文：新闻没有现成译文，预生成 48 篇要花真钱且多数练不到。
 * 参考译文改为按需由 AI 生成、缓存在浏览器里（见 ADR 0007）。
 */

import type { Exercise } from './types'
import type { ArticleExcerpt } from './articles'
import { labelOfDomain } from './articles'

/** 按篇幅粗估建议用时：与自定义题同一口径（每 25 个单位一分钟，最少 5 分钟）。 */
function suggestedMinutesOf(units: number): number {
  return Math.max(5, Math.round(units / 25))
}

export function exerciseOfArticle(article: ArticleExcerpt): Exercise {
  return {
    id: article.id,
    direction: article.direction,
    /*
     * 题型固定成「文章题」：文章库是**整篇/整段语篇**的练习材料。
     * 用户可以把同一篇切成段落题或句子题来练（见 App 的题型切换），
     * 但那是在文章题之上的再切分，题目本身的默认形态就是文章。
     */
    mode: 'article',
    /*
     * 文章的说话方式按「新闻编译」算，与来源一致（都是新闻媒体的报道文字）。
     * 它只影响提示词里对语体的要求，不影响任何校验。
     */
    genre: 'news',
    topic: labelOfDomain(article.domain),
    source: article.excerpt,
    referenceTranslation: '',
    suggestedMinutes: suggestedMinutesOf(article.units),
  }
}
