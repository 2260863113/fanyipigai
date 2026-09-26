/**
 * **术语范围**：术语栏自己那张**封闭的表**，与文章库的「话题领域」是**平行**的两张表。
 *
 * ## 为什么术语栏不共用「话题领域」
 *
 * 用户拍板（第 13 轮）：「术语模式用自己的领域，与社会经济这些领域平行」。
 * 理由是实情：术语库整批换成了机关名称材料（`国内机构.docx` / `国际机构.docx`，后来又加上
 * 手册的当代术语／必背核心术语／必背用典），而这些术语**没有社会／经济／文化／生态／科技**
 * 这种板块属性——硬要共用那张表，就得给一千多条术语一条条凭空编一个板块，
 * 编出来的「领域」是假的。
 *
 * ⚠️ 因此「领域」与「范围」在全站是两个不同的概念（见 CONTEXT.md）：
 *   - **话题领域**：文章栏与句子栏用，五个板块，`articles.ts` 的 `ARTICLE_DOMAINS`；
 *   - **术语范围**：只有术语栏用，`TERM_SCOPES`，界面上的按钮写「范围」。
 * 两者**不互相隶属**，也**不共用**任何一条数据。写代码时别把它们当同一件事。
 *
 * ## 第 14 条：这张表从两张变成五张，而且每一张还要再分「组」
 *
 * 用户的原话：「把现有『范围』控件改成**下拉栏**，里面是**五大板块**：国内机关名称、
 * 国际机关名称、当代术语、必背核心术语、必背用典。点某个板块后**弹出窗口**，
 * 让用户在这个板块里**选分组**（例如「第一组（1-50）」）」。
 *
 * ⚠️ **五个板块现在都有材料了**（第 15 条之后：机关名称两份 docx ＋ 手册的三部分，
 * 全库 1001 条）。表里那五行都有内容，因此下拉里每一行都写着"多少条 · 几组"。
 * 「没有材料的板块」那条降级路径**照旧保留**（将来再加一个板块、材料还没到时用）：
 * 那一行在下拉里**照样列出来**、明说「暂无分组」并且**点不动**——既不藏起来，也不假装有内容。
 * 藏起来会让用户以为界面出了错，这一条在术语栏的「换一换」上已经吃过一次亏
 * （见 SourcePane.tsx 里那段说明：一颗永远点不动、又解释不出所以然的按钮比不画更糟，
 * 但"本来该有、只是还没有材料"的入口**必须看得见**，否则用户不知道该等什么）；
 * 判据是 `hasTermData`（`terms.ts`），而它的纯函数形态 `groupsOfCount(scope, 0)` 可被验收直接断言。
 * 加一个板块要动的地方写在文件末尾。
 *
 * ## 「组」与「页」是两件事，而且**每几个一组是按板块各定的**
 *
 * 用户第 14 条的口径是分开说的：**国内／国际机关名称每 20 个一组**；
 * 手册那三块各有自己的数——**当代术语每 50 个一组**、**必背核心术语每 20 个一组**、
 * **必背用典每 20 个一组**（用户按材料体量定的：当代术语 718 条 → 15 组，
 * 必背核心术语 60 条 → 3 组，必背用典 80 条 → 4 组）。
 * 因此下面那张表里**每一行带自己的 `perGroup`**，全局的 `TERMS_PER_GROUP` 只是"大多数板块的值"
 * （四个板块都是 20），**不要再拿它去算某一板块的分组**——那正是"当代术语被切成 36 组"
 * 这类错误的来源。要算分组一律走 `perGroupOfScope(scope)`（`terms.ts` 的 `groupsOfScope` 就是这么做的）。
 *
 * 「一页几条」则是**全站一个数**（10 条，见 `terms.ts` 的 `TERMS_PER_PAGE`）：
 * 页是逐页批改、落记录、翻页的单位，同一个界面上不该有两种页长。
 * 于是一组 20 条正好两页、一组 50 条正好五页——但**别把"一组几页"写死**：
 * 718 = 14×50 + 18，最后一组只有 18 条（两页），页数一律按算术算出来。
 *
 * ⚠️ 为什么**不**把组号编进题号（早先的 `term-v2-<领域>-<第几组>` 就是那样）：
 * 那是一次**换代**，而记录与收藏**不存题干**、只存题号——换代意味着用户手里那些
 * `term-v3-…` 记录全部回查不到内容。用户当初为 v2 换代拍板"清掉旧记录"，
 * 同时要的是"以后永不再删"（见 term-exercise.ts 的 `isLegacyTermExerciseId`）。
 * 组号不进题号，这条承诺就仍然成立。
 */

/**
 * **默认**的一组条数：四个板块都是它（国内／国际机关名称 20、必背核心术语 20、必背用典 20）。
 *
 * ⚠️ 当代术语是 50，写在它自己那一行的 `perGroup` 里。任何"按组切"的地方都不该直接用这个常量，
 * 而要用 `perGroupOfScope`。
 */
export const TERMS_PER_GROUP = 20

/**
 * 一张封闭的表：范围 id + 界面上的名字 + **材料在哪** + **由哪个脚本生成** + **每几个一组**。
 * 顺序即下拉栏里那五行的顺序。
 *
 * ## 为什么材料分成两个字段（`source` / `build`）
 *
 * 五个板块的材料**不是一种东西**（这是第 15 条之后的实情，字段名必须说出来，否则就是骗人）：
 *   - 前两个板块的材料是仓库根目录的两份 **docx**（用户给的机关名称材料），
 *     正文由 `scripts/build-terms.mjs` 现算；
 *   - 后三个板块的材料是 **`handbook-src/` 下整理好的 JSON**（《理解当代中国 核心术语学习手册》
 *     扫描件的整理结果，上游是 OCR），正文由 `scripts/build-handbook-terms.mjs` 现算。
 *
 * 原先这个字段叫 `docx`，在五个板块都还没配齐材料时它只是"文件名"；现在材料有了两种来源，
 * 那个名字就变成了错的（后三个板块根本没有 docx）。因此拆成：
 *   - `source`：**材料在哪儿**（仓库相对路径；`*` 表示"这一批同前缀的文件"）；
 *   - `build`：**由哪个脚本生成** `terms-data/*.ts`（改名/搬家时两个字段一起改）。
 * 界面上一行都不读它们——它们只在"给这个板块加材料"的时候用（步骤见文件末尾）。
 */
export const TERM_SCOPES = [
  {
    id: 'cn-org',
    label: '国内机关名称',
    source: '国内机构.docx',
    build: 'scripts/build-terms.mjs',
    perGroup: 20,
  },
  {
    id: 'intl-org',
    label: '国际机关名称',
    source: '国际机构.docx',
    build: 'scripts/build-terms.mjs',
    perGroup: 20,
  },
  // 以下三个板块的材料是手册（718 / 60 / 80 条）；当代术语每 50 一组（15 组），
  // 这一个数与其他板块不同，理由见文件头
  {
    id: 'modern-term',
    label: '当代术语',
    source: 'handbook-src/contemporary-*.json',
    build: 'scripts/build-handbook-terms.mjs',
    perGroup: 50,
  },
  {
    id: 'core-term',
    label: '必背核心术语',
    source: 'handbook-src/core-*.json',
    build: 'scripts/build-handbook-terms.mjs',
    perGroup: 20,
  },
  {
    id: 'classics',
    label: '必背用典',
    source: 'handbook-src/classics-*.json',
    build: 'scripts/build-handbook-terms.mjs',
    perGroup: 20,
  },
] as const

export type TermScope = (typeof TERM_SCOPES)[number]['id']

/** 范围的中文名（界面上一律用它，不要另拼字符串）。 */
export function labelOfScope(scope: TermScope): string {
  return TERM_SCOPES.find((item) => item.id === scope)?.label ?? scope
}

/**
 * 这个板块**每几个一组**（算分组只能用它，不能用全局那个默认值）。
 *
 * 认不出来的范围回落到 `TERMS_PER_GROUP`：它只在数据比代码新的时候发生
 * （例如界面上还留着旧记录里的范围 id），那时给一个"大多数板块的值"比抛错好。
 */
export function perGroupOfScope(scope: TermScope): number {
  return TERM_SCOPES.find((item) => item.id === scope)?.perGroup ?? TERMS_PER_GROUP
}

/** 这个字符串是不是一个范围 id（题号解析与存储校验都要用它）。 */
export function isTermScope(value: string): value is TermScope {
  return TERM_SCOPES.some((item) => item.id === value)
}

/**
 * 一个分组在屏幕上的名字，形如 `国内机关名称|第1组（1-20）`。
 *
 * 为什么把板块名也带上（用户给的命名风格就是这个形状，也是他例子里那条竖线的作用）：
 * 分组号本身只在**板块内**唯一，"第1组"三个字在五个板块里各有一个——
 * 界面上、验收脚本的失败信息里、以及以后可能的记录导出里，带上板块名都不必再解释一遍
 * "这是哪个板块的第 1 组"。**编号从 1 起**，序号区间用 1 基（与材料里的序号一致）。
 */
export function groupLabel(scope: TermScope, index: number, from: number, to: number): string {
  return `${labelOfScope(scope)}|第${index + 1}组（${from}-${to}）`
}

/**
 * ## 给一个板块补材料 / 加一个板块要做的事
 *
 * 这些材料是**随代码进仓库的固定数据**（与文章库同一个做法），因此顺序是：
 *   1. 把材料放进仓库（docx 放根目录；手册那种放 `handbook-src/`），
 *      把"材料在哪"与"谁生成"填进上面那一行的 `source` / `build`；
 *   2. 往对应生成器的 `SCOPES` 里加一条（生成器那份表是**它自己**的：
 *      它要的是文件名与导出常量名，跑在 Node 里，不 import 这个模块）；
 *   3. 跑 `node scripts/build-terms.mjs --write`（或 `--write` 那一个手册生成器）生成数据，
 *      在 `terms.ts` 的 `TERMS_BY_SCOPE` 里接上那个常量，并跑 `node scripts/check-terms.mjs` 体检；
 *   4. `scripts/check-terms.mjs` 里那份"应该有几十条"的预期表也要跟着加一行（条数是材料事实，必须手写）。
 *
 * ⚠️ **加一个还没有材料的板块**时不必等材料：往上面加一行、`perGroup` 给个数、
 * 在 `TERMS_BY_SCOPE` 里给一个**空数组**即可——界面上那一行照样列出来、
 * 明说「暂无分组」并且点不动（见 `hasTermData` 与 `terms.ts` 的 `groupsOfCount`）。
 * **不要手写数据文件**——那几份文件顶上写着自动生成。
 */
