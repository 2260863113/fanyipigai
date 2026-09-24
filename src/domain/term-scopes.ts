/**
 * **术语范围**：术语栏自己那张**封闭的表**，与文章库的「话题领域」是**平行**的两张表。
 *
 * ## 为什么术语栏不共用「话题领域」
 *
 * 用户拍板（第 13 轮）：「术语模式用自己的领域，与社会经济这些领域平行」。
 * 理由是实情：术语库整批换成了两份机关名称材料（`国内机构.docx` / `国际机构.docx`），
 * 而这些机关名称**没有社会／经济／文化／生态／科技**这种板块属性——
 * 硬要共用那张表，就得给 143 条术语一条条凭空编一个板块，编出来的「领域」是假的。
 *
 * ⚠️ 因此「领域」与「范围」在全站是两个不同的概念（见 CONTEXT.md）：
 *   - **话题领域**：文章栏与句子栏用，五个板块，`articles.ts` 的 `ARTICLE_DOMAINS`；
 *   - **术语范围**：只有术语栏用，`TERM_SCOPES`，界面上的按钮写「范围」。
 * 两者**不互相隶属**，也**不共用**任何一条数据。写代码时别把它们当同一件事。
 *
 * ## 加一个范围要做的事
 *
 * 这份材料是**随代码进仓库的固定数据**（与文章库同一个做法）：
 * 往 `scripts/build-terms.mjs` 的 `SCOPES` 里加一条 + 把 docx 放仓库根目录 + 重跑
 * `node scripts/build-terms.mjs --write`。**不要手写数据文件**——那份文件顶上写着自动生成。
 */

/** 一张封闭的表：范围 id + 界面上的名字 + 材料文件名。顺序即界面上两张卡片的顺序。 */
export const TERM_SCOPES = [
  { id: 'cn-org', label: '国内机关名称', docx: '国内机构.docx' },
  { id: 'intl-org', label: '国际机关名称', docx: '国际机构.docx' },
] as const

export type TermScope = (typeof TERM_SCOPES)[number]['id']

/** 范围的中文名（界面上一律用它，不要另拼字符串）。 */
export function labelOfScope(scope: TermScope): string {
  return TERM_SCOPES.find((item) => item.id === scope)?.label ?? scope
}

/** 这个字符串是不是一个范围 id（题号解析与存储校验都要用它）。 */
export function isTermScope(value: string): value is TermScope {
  return TERM_SCOPES.some((item) => item.id === value)
}
