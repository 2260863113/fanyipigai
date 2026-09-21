/**
 * 把文章库里的一篇，变成本站通用的**题目**对象。
 *
 * 与自定义题（domain/custom.ts）走的是同一条路：文章库与自定义题都没有手写的示例作答，
 * 因此两者的 Exercise 都只由文本本身推导出来。差别在于：
 *   文章库的领域是**已经定好的**（选了哪个领域就是哪个），方向也是；
 *   自定义题的领域为空、方向靠猜。
 *
 * ## 参考译文是**题目数据的一部分**（ADR 0003）
 *
 * 文章库自带参考译文，随材料进仓库，不再由 AI 现生成——同一篇前后两次练，
 * 看到的参考译文永远是同一份，分数才可比。这里塞的是**整篇**译文；
 * 界面上按"一页 = 一个自然段"取这一页对应的那几段（见 `ExerciseSource.pageReferenceOf`）。
 *
 * 译文**只给人看、从不发给模型**——批改请求里只有原文与学生的译文（见 ADR 0003 的补充）。
 */

import type { Exercise } from './types'
import type { Article } from './articles'
import { labelOfDomain } from './articles'

/** 按篇幅粗估建议用时：与自定义题同一口径（每 25 个单位一分钟，最少 5 分钟）。 */
function suggestedMinutesOf(units: number): number {
  return Math.max(5, Math.round(units / 25))
}

export function exerciseOfArticle(article: Article): Exercise {
  return {
    id: article.id,
    direction: article.direction,
    /*
     * 题型固定成「文章题」：文章库是**成篇**的练习材料。
     * 用户可以把同一篇切成段落题或句子题来练（见 App 的题型切换），
     * 但那是在文章题之上的再切分，题目本身的默认形态就是文章。
     */
    mode: 'article',
    /*
     * 文章的说话方式按「新闻编译」算。
     * 文章库的材料是围绕 2026 年事件编写的报道体文字，与新闻编译最接近；
     * 它只影响提示词里对语体的要求，不影响任何校验。
     */
    genre: 'news',
    topic: labelOfDomain(article.domain),
    source: article.text,
    referenceTranslation: article.reference,
    suggestedMinutes: suggestedMinutesOf(article.units),
  }
}
