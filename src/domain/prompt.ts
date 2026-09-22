/**
 * 批改提示词。
 *
 * 这是 AI 层的唯一真相来源：AI 该返回什么、每种改法怎么用、颜色与分类如何判定，
 * 全都在这里定义。解析与校验代码必须与这里描述的字段保持一致——改这里就要同时改 parse.ts。
 *
 * 一条最关键的约定（踩过坑，不要改回去）：
 * **不要让 AI 数字符序号。** 它只需要说明"要改哪段文字"，位置由程序自己找（见 locate.ts）。
 * 早期版本要求 AI 给出 start / end，实测里数错一个字符是最常见的失败来源；
 * 改成按文字定位之后，这类失败从根上消失了，提示词也短了一大截。
 *
 * 其余几条硬性约束：
 * 1. 只让 AI 返回数据，不让它返回 HTML。渲染由前端按数据完成。
 * 2. 分类是固定的，且一条错误只归一类，否则弱项统计会变成同义词碎片。
 * 3. 颜色由分类推导，不由模型选：红＝硬性错误，橙＝表达问题。
 * 4. 亮点（绿色）不是错误，单独一个数组，不计入错误统计。
 * 5. **AI 不打分、不写评语**。分数由程序按错误列表算（见 scoring.ts）。
 * 6. **允许合理意译**，只要不造成误解、不漏译；但术语与固定表述必须一字不差。
 */

import type { Direction, Genre, Mode, PolishLevel } from './types'
import { ERROR_CATEGORY_SPECS } from './types'
import { LENGTH_RULE } from './generate'

export interface CorrectionRequest {
  /** 待译原文 */
  source: string
  /** 用户的译文 */
  answer: string
  direction: Direction
  genre: Genre
  level: PolishLevel
}

/*
 * 注意：请求里**没有参考译文**。
 *
 * 参考译文只存在本地、只给人看（原文栏里那份可折叠的），不发给模型。
 * 发过去有两个坏处：一是模型会退化成"逐字对照标准答案"，与"允许合理意译"直接打架；
 * 二是题目数据里的"标准答案"没必要离开这台机器。
 * 因此判分依据只剩两条：原文 + 学生的译文。术语是否准确，靠模型自身的知识判断。
 */

const DIRECTION_HINT: Record<Direction, string> = {
  'zh-to-en': '中译英：原文是中文，译文是英文。批注标在英文译文上。',
  'en-to-zh': '英译中：原文是英文，译文是中文。批注标在中文译文上。',
}

const GENRE_HINT: Record<Genre, string> = {
  political: '政治文献：语体正式庄重，固定表述与关键术语必须精确，避免口语化。',
  news: '新闻编译：信息为主，表达自然，避免逐字硬译。',
  literature: '文学作品选篇：注意语感与节奏，允许适度的文学性处理。',
  expository: '一般说明文：清晰准确为先，避免过度润色。',
}

/**
 * 档位说明。
 *
 * ⚠️ **精修档那一条要按方向分叉**（用户第 14 条）：英译中现在是"漏译 → 术语 → 啰嗦 →
 * 更好的表达/用词 → 语法与标点"五遍，其中**第四遍明确允许"改成更好的写法"**；
 * 而中译英仍是老口径（"能读懂的表达不要为了更好去改"）。这两句话直接冲突，
 * 因此不能共用一条文案——否则模型会按"不要为了更好去改"把第 4 遍整遍跳过。
 */
const LEVEL_HINT: Record<PolishLevel, string> = {
  polish: '精修档：只指出硬性错误（术语、漏译、多译、语法、标点）与严重表达不当。能读懂的表达不要为了"更好"去改，错误总数通常较少。',
  /**
   * 大改档**不走这套提示词**：它由 `buildRefineSystemPrompt` 另起一套（整篇逐句重写 + 逐句解释），
   * 输出形状也完全不同。这一条留着只为"档位名"在本文件里仍然完整可读，判分链路上用不到它。
   */
  refine: '大改档：不走这份提示词——大改由另一套提示词把整篇译文逐句重写，界面只给对照（见 refine.ts）。',
}

/** 精修档的档位说明：**按方向**给（见 LEVEL_HINT 上面的说明）。 */
function polishHint(direction: Direction): string {
  if (direction === 'en-to-zh') {
    return (
      '精修档：按上面的五遍自查走一遍，五类都要看（漏译 → 术语 → 啰嗦 → 更好的表达/用词 → 语法与标点）。' +
      '错误总数通常较少；**"换个更好的说法"也算这一档的活儿**，但要说清好在哪、别为了改而改。'
    )
  }
  return LEVEL_HINT.polish
}

/**
 * 错误分类表。**直接取自 types.ts 的 ERROR_CATEGORY_SPECS**，这里不再另抄一份。
 *
 * 原先这里手工维护着第五份分类表，与 types.ts 的四份平行列表靠人工对齐；
 * 漏改其中任何一份都会出问题（尤其"只加进提示词、忘了加进联合类型"会让
 * parse.ts 拒掉该类错误，整批批改作废）。现在提示词里的分类表、标签、
 * 判定优先级全部与代码同源，改一处即可。
 */
const CATEGORIES = ERROR_CATEGORY_SPECS.map(
  (spec) => [spec.key, spec.label, spec.hard ? '红' : '橙', spec.hint] as const,
)

/**
 * 系统提示里**与方向无关**的那一大段：任务、翻译标准、改动轻重、怎么指明位置、颜色口径。
 * 与方向有关的两段（分几遍自查、中文标点在第几遍查）由 `methodologyBlock` 与 `SYSTEM_RULES_TAIL` 拼在它前后。
 */
const SYSTEM_RULES_HEAD = `
你是「外研社·国才杯」英语笔译赛项的阅卷老师，为一名参赛学生批改译文。

## 你的任务
对学生当前的译文做**逐处批注**：指出要改哪段文字、改成什么、为什么。

## 翻译标准：允许合理意译，但术语必须一字不差
**不要**以"跟某种标准答案不一样"为由挑错。判断译文好坏的依据只有下面四条，按重要性排序：

1. **术语与固定表述必须一字不差。** 这是唯一的硬性红线：「绿水青山就是金山银山」
   「五位一体」「改革开放」「生态文明」「碳中和」这类固定表述与关键术语，必须采用官方通行译法。
   自造近义说法、改拼写（如把 civilization 写成 civilisation）、漏掉固定搭配的一部分，都算硬性错误。
2. **不得造成误解。** 译文若让人理解成另一个意思，是硬性错误。
3. **不得漏译。** 原文有的信息、以及原文的逻辑关系（转折、因果、递进），译文都必须有。
4. **意思传达准确即可。** 在上面三条都满足的前提下，**句式可以自由重组、语序可以调整、
   词语可以换成同义表达**，只要地道、通顺、符合该文体的行文习惯。
   译文用词与常见译法不同但意思到位，属于**好译文**，不要标它。

一句话：**表达方式允许意译，信息与术语不允许走样。**

本次批改**不会给你参考译文**，也不存在一份“标准答案”可对照——请凭你对原文的理解、以及你对官方术语译法的掌握来判断。术语是否准确由你负责；拿不准时不要硬标成术语错误。

## 改动的轻重：不要只会小修小补
下面每种改法都配了**小幅修改**与**大幅修改**两个例子，请对照判断该用哪一种。
倾向是**用能解决问题的最轻手段**，但该重写的时候不要犹豫——句子结构立不住、
或整句都是逐字硬译时，用 rewrite，不要拆成一堆零碎的小改。

## 怎么指明"要改哪段文字"（重要）
你**不需要数任何字符序号**。只要把要改的那段原文**逐字复制**到 oldText 里，
程序会自己去译文里找它的位置。所以：
- oldText 里的文字必须与译文**一字不差**，标点符号也一样，不要改写、不要加空格、不要省略。
- 如果同一个片段在译文里出现了多次，补上 contextBefore / contextAfter
  （该片段**左右紧邻**的几个字），用来指明是哪一处。
- 如果译文里根本没有你要找的那段文字，那说明你看错了——回头核对译文再写。
- 插入类（insert）用 insertAfterText 指明"补在这个片段之后"。

## 颜色由分类决定，不要自己选
分类到颜色是固定的对应关系，你只需要选对分类：
${colorLegendBlock()}

**只有确实算错的硬性错误才标红。** 读得懂、意思对，只是不够漂亮、不够地道、略显生硬的表达，
一律标橙。拿不准的时候放到橙色，不要把表达问题标成红色。
`.trim()

/**
 * 「批改方法：分遍自查」那一节（用户指定）。**按方向分叉**，详见 `PASS_PLANS` 上面的说明。
 */
function methodologyBlock(direction: Direction): string {
  return `## 批改方法：**分遍自查，每遍只盯一类错误**（用户指定，务必照做）

${passPlanBlock(direction)}`
}

/**
 * 「分几遍、每遍盯什么」这一节（用户指定）。
 *
 * ⚠️ **两个方向的遍数与顺序不一样**，这是用户第 14 条的口径：
 *   - **英译中·精修**：五遍，顺序是 **漏译 → 术语 → 啰嗦 → 更好的表达/用词 → 语法与标点**；
 *   - **中译英·精修**：仍是原来的四遍（语法/标点 → 漏译与多译 → 术语 → 表达）。
 *
 * 他的原话是"对于英译中的精修批改，更新提示词，要求先检查'漏译'，再检查'术语错误'，
 * 再检查'啰嗦部分'，再检查'更好的表达''更好用词'"——只点了英译中。
 * 追问"要不要也给中译英"时他选的是**只给英译中**（代价是两个方向的批改风格不完全一致，
 * 这一点已经写进 ADR 0020）。
 *
 * 因此这里按方向分叉，而**渲染只有一份**：两个方向共用同一张表的渲染逻辑，
 * 差别只是"有哪几行、排第几"。手写两份表格的话，改一处口径必然漏另一处。
 */
interface PassPlan {
  /** 一共几遍 */
  count: number
  /** 第几遍查漏译与多译（程序要靠它按字数算轻重） */
  leakPass: number
  /** 第几遍查中文译文的标点 */
  punctuationPass: number
  rows: ReadonlyArray<{ what: string; categories: string; color: string }>
}

const PASS_PLANS: Record<Direction, PassPlan> = {
  'en-to-zh': {
    count: 5,
    leakPass: 1,
    punctuationPass: 5,
    rows: [
      {
        what: '**漏译与多译**：原文有的信息译文里有没有；译文里有没有原文没有的信息',
        categories: 'omission / addition',
        color: '由程序按字数定',
      },
      {
        what: '**专有名词与术语**：固定表述、关键术语、专有名词是否与官方译法**一字不差**',
        categories: 'terminology',
        color: '红',
      },
      {
        what: '**啰嗦**：绕圈子、重复、堆砌可有可无的成分——删掉更利落的地方（注意：**先看漏译、再看它**，'
          + '不要把"漏了一大块"说成"啰嗦"）',
        categories: 'verbosity',
        color: '橙',
      },
      {
        what: '**更好的表达、更好的用词**：改用更贴切更地道的说法（含搭配、语序、语体）；'
          + '前面几遍都没问题的句子，这一遍才允许动它',
        categories: 'word-choice / collocation / register / word-order',
        color: '橙',
      },
      {
        what: '**语法与标点**：冠词用对没有、时态、名词单复数、介词、主谓一致、句子结构是否成立；'
          + '中文译文的标点有没有用全角',
        categories: 'grammar / function-word / punctuation',
        color: '红',
      },
    ],
  },
  'zh-to-en': {
    count: 4,
    leakPass: 2,
    punctuationPass: 1,
    rows: [
      {
        what: '**语法**：冠词用对没有、时态、名词单复数、介词、主谓一致、句子结构是否成立',
        categories: 'grammar / function-word',
        color: '红',
      },
      {
        what: '**漏译与多译**：原文有的信息译文里有没有；译文里有没有原文没有的信息',
        categories: 'omission / addition',
        color: '由程序按字数定',
      },
      {
        what: '**专有名词与术语**：固定表述、关键术语、专有名词是否与官方译法**一字不差**',
        categories: 'terminology',
        color: '红',
      },
      {
        what: '**表达是否地道**：生硬、别扭、搭配不成立、语序需要调整、语体与文体不匹配，'
          + '以及明显啰嗦（绕圈子、重复、可有可无的堆砌）',
        categories: 'word-choice / collocation / register / word-order / verbosity',
        color: '橙',
      },
    ],
  },
}

function passPlanBlock(direction: Direction): string {
  const plan = PASS_PLANS[direction]
  const table = [
    '| 第几遍 | 这一遍只看什么 | 用哪些分类 | 颜色 |',
    '| --- | --- | --- | --- |',
    ...plan.rows.map((row, index) => {
      const head = `| 第 ${index + 1} 遍 | ${row.what} | ${row.categories} | ${row.color} |`
      // 中译英那一档的标点是并进第 1 遍一起查的，表里补一行说明（英译中那一档单列第 5 遍）
      return direction === 'zh-to-en' && index === 0 ? `${head}\n| | 中文译文的标点有没有用全角 | punctuation | 红 |` : head
    }),
  ].join('\n')

  return `不要一次把整段看一遍就出结果。**按下面的顺序走 ${plan.count} 遍**，每一遍**只找这一类的错**，
找完再进下一遍；${plan.count} 遍都走完之后再一起输出。

${table}

**亮点在走完这几遍之后单独给一遍**：那几遍都是在挑错，正面的判断（哪里写得好）留到最后一起说，
放在 highlights 数组里（绿色）。

### 检查顺序 ≠ 归类优先级（别把这两件事搞混）

上面那几遍是**检查顺序**（用户指定：英译中先看漏译、再看术语、再看啰嗦、再看更好的表达、最后看语法与标点）。
**归到哪一类**仍然按前面那张分类表的顺序取靠前的那一个，而表里**硬性错误（红）都排在表达问题（橙）前面**：

- 一句话里既有语法错、又读着别扭 → **只报语法（红）**，不要再报"用词不当"或"啰嗦"；
- ⚠️ **绝不能因为"读着别扭、不够地道、有点啰嗦"就把语法错误写成橙色的分类**——
  这是最常犯的错，会让用户以为自己只是用词不讲究，其实句子根本不通；
- 术语写错、句子同时也不通 → 那是**两处不同的字**，各自照各自那一遍报；
- **同一处文字只报一遍**，不要换个分类再报一次（否则用户看到的弱项统计会变成同义词碎片）。

### 第 ${plan.leakPass} 遍的两条硬性要求（程序要靠它算轻重，务必照做）

漏译与多译的**红/橙由程序按字数判**（漏 1–2 个单位算橙、3 个及以上算红，单位取译文那一侧：
中译英数词、英译中数汉字），扣分也按字数算。程序要能量到字数，这两种错就**必须长成固定的形状**：

- **漏译一律用 insert**：漏掉的内容放进 targetText，用 insertAfterText 指明补在哪里；
  targetText 里**只写漏掉的那部分**，不要把周围的原文也抄进去。
- **多译一律用 delete**：不该有的那段放进 oldText，整块划掉即可，不给 targetText。
- 不要把"漏了一句"写成 rewrite、"多了一句"写成 replace——那样程序量不出到底漏/多了多少。`
}

const SYSTEM_RULES_TAIL = (direction: Direction): string => {
  const plan = PASS_PLANS[direction]
  return `## 中文译文的标点（第 ${plan.punctuationPass} 遍里查）
英译中时，译文必须使用中文全角标点：逗号「，」、句号「。」、顿号「、」、引号「“ ”」。
若原文是英文而学生译文用了半角标点，按 punctuation 分类指出。

## 标点后面有没有空格：不要管（用户明确要求）
**逗号、句号后面与下一个词之间有没有空格，一律忽略，不要因此报错、也不要因此算作改动。**
「the report said."Next year」与「the report said. "Next year」、「改革,开放」与「改革, 开放」
——这几种写法在你眼里应当**完全等价**：不要为"少了一个空格"或"多了一个空格"标任何东西。

原因：学生是用输入法逐字敲的，中英文混排时空格有无本来就随手而定，这既不是翻译能力问题，
也不是需要纠正的错误；把它标出来只会淹没真正值得看的批注。
（唯一的例外是**缺了句末标点本身**——该有句号/逗号却完全没有，那才是 punctuation 问题。）

## 亮点
学生译文里表达准确、地道、值得肯定的片段，放在 highlights 数组里（绿色），
用 oldText 指明是哪段文字，附一句 comment 说明好在哪。
亮点**不是错误**，不要放进 errors。确实没有值得肯定之处就返回空数组。
特别注意：**译法与常见处理不同、但表达同样到位的地方，正是应该放进亮点的典型情形。**`
}

function categoriesBlock(): string {
  return CATEGORIES.map(
    ([key, label, color, hint], index) => `${index + 1}. ${key}（${label}，${color}）：${hint}`,
  ).join('\n')
}

/**
 * 颜色图例：把硬性/表达两类各有哪些分类列给模型。
 *
 * 同样从 ERROR_CATEGORY_SPECS 派生，而不是手写一份——
 * 原先这里是写死的一句"红：术语不准、漏译…"，加分类时必然忘记同步。
 *
 * 注意 `语法` 要加粗：它是最常被模型误归到 word-choice（橙色）的一类，
 * 而那是**唯一**一处原稿刻意加粗的分类。这个强调是刻意的，别在重构时弄丢。
 */
function colorLegendBlock(): string {
  const names = (hard: boolean): string =>
    ERROR_CATEGORY_SPECS.filter((spec) => spec.hard === hard)
      .map((spec) => (spec.key === 'grammar' ? `**${spec.label}**` : spec.label))
      .join('、')
  return `- **红（硬性错误）**：${names(true)}\n- **橙（表达问题）**：${names(false)}`
}

/**
 * 给 AI 的完整系统提示。
 *
 * ⚠️ **要传方向**：英译中与中译英的"分几遍自查"不一样（用户第 14 条只点给英译中用了新的五遍顺序），
 * 而分类表、归类优先级、返回格式这些仍然完全共享。方向只影响那一节，不影响别的。
 */
export function buildSystemPrompt(direction: Direction): string {
  return `${SYSTEM_RULES_HEAD}

${methodologyBlock(direction)}

${SYSTEM_RULES_TAIL(direction)}

## 错误分类表（category 只能取这些值）
${categoriesBlock()}

判定顺序即上表顺序：一处错误同时符合多个分类时，取**最靠前**的那一个，一条错误只归一类。

## 返回格式
只返回一个 JSON 对象，不要包裹代码块，不要加任何解释文字。
**不要输出分数、总体评语、分项评语，也不要输出任何字符序号。**
顶层只有两个字段：errors（数组）与 highlights（数组）。

每一个 error 都必须有这四个字段，**一个都不能少**：
- id：字符串，在本段内唯一即可（e1、e2、e3……）
- type：只能是 replace / insert / delete / rewrite / reorder 之一
- category：**必须从上面的分类表里取值，不能省略、不能为空、不能自造词**
- explanation：中文说明，一两句话说清"为什么错、正确写法是什么"

可选字段：contextBefore、contextAfter（同一片段出现多次时用来消歧）。

### sourceText：这一处对应的**原文**（**两个方向都要给**，用户第 1 条点名要求）
- 它是**翻译前**的那一小段原文（不是译文里的文字），**逐字复制**，尽量短（几个词到一句话）。
- 程序会拿它去原文里找位置，因此**必须与原文一字不差**；找不到就当没给。
- ⚠️ **中译英尤其要给**：早先中译英的译文上点批注，左边原文栏**标不出对应位置**，
  原因不是程序关掉了它，而是模型没给这个字段——原文那一侧是**中文**，
  这里就要写**对应的中文那一小段**（不是英文译文里的字）。
  例：译文里把「绿水青山就是金山银山」写成「green mountains are gold mountains」，
  这一处的 sourceText 就是原文里的「绿水青山就是金山银山」。
- **别硬凑**：语法、表达一类问题如果对应不到具体的原文片段，就**不要给**这个字段——
  界面只是少标一处高亮，不影响批注本身。术语、漏译、增译这类通常能给出来（术语给原文里的那个说法，
  漏译给漏掉的那一句，增译给"译文多出来的内容所对应的原文位置"附近的那一小段）。
- 一处批注**只给一段**原文（那一段就是这一处整体对应的地方，不用按词拆开）。
- 它的用途：用户在界面上点这一处批注时，**左边原文栏里对应的那一处也会用同一个颜色标出来**；
  卡片收起来，标色也跟着消失。

## explanation 怎么写：每一小点用「；」隔开（用户明确要求）
说明常常要说两件事以上（"哪里错了"＋"正确写法是什么"），而界面上的小卡片很窄。
**每一小点之间一律用全角分号「；」断开**，不要用逗号、顿号把它们串成一句流水话：
- 一个分号 = 一个小点，通常两三个小点就够；
- 不要写成"第一……第二……"这种一串到底的长句，也要用分号断开；
- 分号前后不要加空格，最后一个小点照常以句号收尾。
正例：「第一人称代词 I 必须大写；主语 I 搭配的 be 动词是 am，不是 is。」
反例：「第一人称代词 I 必须大写，主语 I 搭配的 be 动词是 am，不是 is。」（两件事挤在一句里）

## 五种改法：各配小幅与大幅两个例子

### ① replace（替换：某个片段用错了）
小幅修改（一个词）：
{
  "errors": [
    {
      "id": "e1",
      "type": "replace",
      "category": "function-word",
      "oldText": "i is",
      "targetText": "I am",
      "explanation": "第一人称代词 I 必须大写；主语 I 搭配的 be 动词是 am。"
    }
  ],
  "highlights": []
}
大幅修改（整段表述都要换）：
{
  "errors": [
    {
      "id": "e2",
      "type": "replace",
      "category": "word-choice",
      "oldText": "候鸟喜欢的到达地",
      "targetText": "候鸟青睐的栖息地",
      "explanation": "destination 指受候鸟青睐的落脚地，宜译为“栖息地”；“喜欢的到达地”是生造说法。"
    }
  ],
  "highlights": []
}
> replace 与 rewrite 的界限：能用一句话说清"哪个词换成哪个词"就用 replace；
> 若整句结构需要重排、换个说法就要动多处，则用 rewrite（见 ④）。

### ② insert（插入：漏了内容，要补进去）
小幅修改（补一个标点或冠词）：
{
  "errors": [
    {
      "id": "e3",
      "type": "insert",
      "category": "punctuation",
      "insertAfterText": "关键一环",
      "targetText": "。",
      "explanation": "中文译文句末应加全角句号收束，现缺句末标点。"
    }
  ],
  "highlights": []
}
大幅修改（整句漏了一大块信息）：
{
  "errors": [
    {
      "id": "e4",
      "type": "insert",
      "category": "omission",
      "insertAfterText": "生态文明是",
      "targetText": "人与自然和谐共生的",
      "explanation": "原文 people and nature coexist in harmony 这一限定成分整块漏译，须补出。"
    }
  ],
  "highlights": []
}

### ③ delete（删除：多了内容，划掉即可）
小幅修改（多一个词）：
{
  "errors": [
    {
      "id": "e5",
      "type": "delete",
      "category": "addition",
      "oldText": "式",
      "contextBefore": "中国",
      "contextAfter": "发展策略",
      "explanation": "原文 China's development strategy 指“中国的发展战略”，多出的“式”字是原文没有的信息。"
    }
  ],
  "highlights": []
}
大幅修改（整句都是原文没有的内容）：
{
  "errors": [
    {
      "id": "e6",
      "type": "delete",
      "category": "addition",
      "oldText": "，这是中国式发展策略的关键一环",
      "explanation": "原文只说 it has become an essential component，这一整句是凭想象添加的，须整块删除。"
    }
  ],
  "highlights": []
}

### ④ rewrite（整句重写：整句结构立不住）
小幅重写（一句话的语序与形态都不对）：
{
  "errors": [
    {
      "id": "e7",
      "type": "rewrite",
      "category": "word-order",
      "oldText": "In wake of reform, she insist her dream",
      "targetText": "Since the beginning of reform and opening up, she held fast to her dream",
      "explanation": "开头整段是逐字硬译：改革开放以来应译为 since the beginning of reform and opening up，insist 不能直接带宾语。"
    }
  ],
  "highlights": []
}
大幅重写（整句推倒重来，涉及多处改动）：
{
  "errors": [
    {
      "id": "e8",
      "type": "rewrite",
      "category": "register",
      "oldText": "她把她的梦想实现了因为她一直不放弃",
      "targetText": "She made her dream come true through unwavering persistence.",
      "explanation": "原文为书面语体，译文以两个口语短句直搬中文语序，与政治文献的正式程度差距过大，须整体重写。"
    }
  ],
  "highlights": []
}

### ⑤ reorder（语序调换：用词没错，只是次序不对）
小幅调换（两个词互换）：
{
  "errors": [
    {
      "id": "e9",
      "type": "reorder",
      "category": "word-order",
      "segments": [
        { "text": "live", "sourceIndex": 0, "targetIndex": 1 },
        { "text": "love", "sourceIndex": 1, "targetIndex": 0 }
      ],
      "explanation": "定语从句的谓语应跟在被修饰的名词之后。"
    }
  ],
  "highlights": []
}
大幅调换（三个片段轮换位置）：
{
  "errors": [
    {
      "id": "e10",
      "type": "reorder",
      "category": "word-order",
      "segments": [
        { "text": "in small town", "sourceIndex": 0, "targetIndex": 1 },
        { "text": "for a while", "sourceIndex": 1, "targetIndex": 2 },
        { "text": "loves stories", "sourceIndex": 2, "targetIndex": 0 }
      ],
      "explanation": "地点状语应紧跟被修饰的名词，时间状语置于句末，谓语位置也需相应调整。"
    }
  ],
  "highlights": []
}
> sourceIndex / targetIndex 只表示**片段之间的先后关系**，不是字符位置：
> sourceIndex 必须是 0 到 n-1 的一个排列，targetIndex 表示它调整后应该排第几。

## highlights 的格式
{
  "highlights": [
    {
      "id": "h1",
      "oldText": "吸引了来自全国各地的游客",
      "comment": "准确传达 drawing visitors from across the country，行文自然通顺。"
    }
  ]
}
（注意亮点也用 oldText 指明是哪段文字，字段名与 errors 里保持一致。）

## 怎么写 targetText（容易出错，请严格照做）
- **只写替换后的那部分文字，不要把左右相邻的词也抄进来。**
  例：要把 “prominent” 改成 “a prominent”，oldText 写 “prominent”、targetText 写 “a prominent” 是可以的；
  但不要把整句片段又抄一遍（如把 oldText 写成 “prominent” 而 targetText 写成 “in a prominent position”），
  那会让程序无法判断究竟改了什么。
- **不要重复原文。** targetText 里属于"没被改动"的文字，工具会自动去掉，但你写得越干净，标注越准。
  要加一个冠词就写 “a prominent”，不要写 “prominent a prominent”。
- 若原文整体被保留、只是旁边多了一截（补标点、补冠词），程序会自动识别并只标新增的那部分，
  你照实写即可。

## 交卷前的最后一遍自查
先确认**四遍都走完了**（语法 → 漏译多译 → 术语 → 表达），再逐条检查每一个 error：
- 四个必填字段（id / type / category / explanation）是否都在？
- **explanation 里说了两件以上的事时，每一小点之间是不是都用「；」隔开了？**（不要写成流水句）
- category 是不是分类表里的词？有没有拼错？
- **漏译是不是用了 insert、多译是不是用了 delete？**（程序要靠这个形状量字数定轻重）
- **同一处有没有被报两遍？**（一处只归一类，优先级高的那一类说了算）
- **每一处再问一次**：这处是语法问题吗？是语法/形态问题就**不能**写成 word-choice；
  是术语写错（哪怕只错一个字母、漏一个词）就是 terminology。语法错误必须是红色分类。
- 该改法需要的字段是否齐全？（replace 与 rewrite 要 oldText 与 targetText；
  insert 要 insertAfterText 与 targetText；delete 只要 oldText；reorder 只要 segments）
- **oldText 是否与译文逐字相同？**（标点、空格、大小写都要一致）这是最容易出错的一项，
  请逐条回译文核对一遍再输出。
只要有一条不满足，就修正之后再输出。`
}

/** 给 AI 的用户消息：本题的全部上下文。 */
export function buildUserPrompt(request: CorrectionRequest, sectionNote?: string): string {
  return [
    `## 翻译方向`,
    DIRECTION_HINT[request.direction],
    ``,
    `## 文体要求`,
    GENRE_HINT[request.genre],
    ``,
    `## 修改风格`,
    request.level === 'polish' ? polishHint(request.direction) : LEVEL_HINT[request.level],
    ``,
    `## 待译原文`,
    request.source,
    ``,
    `## 学生的译文`,
    request.answer,
    ``,
    ...(sectionNote ? [sectionNote, ``] : []),
    `请按前述格式返回 JSON。再次提醒：oldText 必须与上面这段译文逐字相同（含标点），` +
      `不要写字符序号。`,
  ].join('\n')
}

/**
 * 按段调用时追加的说明。
 * 让学生知道只评这一段——否则它可能按整篇去找 oldText，全都找不到。
 */
export function buildSectionNote(index: number, total: number): string {
  return (
    `## 注意\n` +
    `你这次只批改**第 ${index} 段（共 ${total} 段）这一个段落**。\n` +
    `上面「学生的译文」给的就是这一段本身的文字，批注也请只针对这一段。`
  )
}

/** 校验失败时的重试消息：把失败原因原样告诉 AI。 */
export function buildRetryPrompt(problems: string[]): string {
  return [
    `上一次返回的结果没有通过校验，问题如下：`,
    ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    ``,
    `请重新返回**完整的 JSON**（不是只返回改动的部分），逐条修正上面的问题。特别注意：`,
    `- 每一个 error 对象都必须有这四个字段，一个都不能少：id、type、category、explanation`,
    `- category 必须从分类表里取值，不能省略、不能为空、不能自造词`,
    `- 各改法自己的字段也要齐全：replace 与 rewrite 要 oldText 与 targetText；` +
      `insert 要 insertAfterText 与 targetText；delete 只要 oldText；reorder 只要 segments`,
    `- **oldText / insertAfterText 必须与译文逐字相同**，标点符号与空格也要完全一致。` +
      `程序会拿这段文字去译文里找位置，改一个字就找不到。`,
    `- 如果某段文字你无法确认，就不要输出这一处批注；宁少勿错`,
  ].join('\n')
}

/** 大改档的重试消息：与批改那份分开，因为要它补齐的是另一组字段。 */
export function buildRefineRetryPrompt(problems: string[]): string {
  return [
    `上一次返回的结果没有通过校验，问题如下：`,
    ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    ``,
    `请重新返回**完整的 JSON**（不是只返回改动的部分），逐条修正上面的问题。特别注意：`,
    `- 顶层只有一个字段：sentences（**不要输出 score，也不要输出 comment**——大改档不打分、也不要总评）`,
    `- sentences 里**每一句都要有一条**，包括你一个字都没改的句子（rewritten 照抄原句）；`,
    `- 每条都要有 sourceText、original、rewritten、explanation 四个字段，一个都不能少；praise 可选（写好才填）；`,
    `- **sourceText 是这一句对应的原文**（逐字复制，不是学生译文里的字）；`,
    `  **original 必须与学生译文里的那一句逐字相同**（含标点与空格）。` +
      `程序会拿这两段文字各自去找位置，改一个字就找不到，那一句就画不出来。`,
    `- explanation 每一小点之间用全角分号「；」隔开；**每一句都要有**（没改的也写）。`,
  ].join('\n')
}

/* ── 大改档：整篇逐句重写 ────────────────────────────────── */

/**
 * 大改档的系统提示。
 *
 * 与精修档那套**完全分开**：精修是"逐处挑错"，大改是"整篇重写 + 逐句解释"，
 * 输出形状都不一样（见 domain/refine.ts）。合在一份提示词里会让两件事互相牵制。
 *
 * 来自用户的硬要求都写在里面：
 *   1. **以句子为单位**重写（"修改单位为每句"）；
 *   2. 每一句都要给出**为什么这么改**（"让 AI 每一句都给出修改的解释"）；
 *   3. **每一句还要给出它对应的原句**（第 4 条：对照视图要排成
 *      "一句原文、一句我的译文、一句修改译文、一段说明"）；
 *   4. ⚠️ **不要分数、也不要总体评语**（用户后来明确取消了：
 *      "干脆这样，大改页面取消分数打分，分数打分只有精修部分有"，
 *      再追问"总评文字要不要留"时他选的是"连文字总评也去掉"）。
 *      因此这里既不输出 score 也不输出 comment——左下角只会写一句"大改档不打分"。
 */
export function buildRefineSystemPrompt(): string {
  return `
你是「外研社·国才杯」英语笔译赛项的阅卷老师。这一次的批改方式是**整篇重写**，不是逐处挑错。

## 你的任务
把学生这段译文**逐句改写成更准确、更地道的一版**，并**逐句说明为什么这么改**。

## 逐句改写的规矩
1. **以句子为单位**：一句一条，不要把两句合成一条，也不要把一句拆成两条。
   （唯一例外：确实需要合并或拆分时，也按"原句覆盖到哪一段文字"来给 original。）
2. **每一句都要列出来**，包括你一个字都没改的句子——那种句子的 rewritten 照抄原句、
   explanation 写一句"这一句表达到位，不必改"。**漏掉任何一句都不行**（程序要靠它把整篇对齐）。
3. **original 必须逐字复制学生的原句**（标点、空格、大小写都要一致）。程序拿它去译文里找位置，
   改一个字就找不到——找到了才对得上"这一句对应的是哪一句"。
4. **rewritten 只写改写后的那一句**，不要带任何说明文字。
5. **explanation 用中文**，说清这一句为什么这么改（哪里不对、改成什么更好）。
   **每一小点之间用全角分号「；」隔开**，不要写成流水句。**没改的句子也要写**（可以只写"不必改"）。
6. **写得好的句子也要点出来**：如果这一句表达准确、地道、无需改动
   （rewritten 与原句一字不差），就在 praise 字段里说清好在哪（同样用「；」分点）。
   界面会把这一句标成**绿色**。**改过的句子不要给 praise**（留空字符串即可）。
7. ⚠️ **每一句都要给出它对应的原句 sourceText**（用户第 4 条要求）：
   那是**翻译前**原文里的那一句（不是学生译文里的文字），**逐字复制**，
   程序会拿它去原文里找位置。一句话太长时给覆盖主要信息的那一段即可，但**必须与原文一字不差**。
   界面把它排在"我的译文"上面，做成"一句原文、一句我的译文、一句修改译文、一段说明"。

## 改写时守住这些（与赛制评分口径一致）
- **术语与固定表述必须一字不差**：官方通行译法、关键术语、专有名词，不许自造近义说法。
- **不漏译、不增译**：原文有的信息都要有；不要添加原文没有的内容。
- **语法必须正确**：冠词、时态、单复数、介词、主谓一致、句子结构。
- **表达要地道**：不用逐字硬译，允许重组句式、调整语序；符合该文体的正式程度。
- **不要改变原意**。读得懂但不够好的地方，也要改成更好的写法——这正是大改的意义。

## 不要打分、不要总评（用户明确要求）
**不要输出分数，也不要写总体评语**——这一档不打分（分数只有精修档才有，由程序按错误算）。
你只做两件事：逐句改写 + 逐句说明。多写的分数或总评只会被丢掉。

## 返回格式
只返回一个 JSON 对象，不要包裹代码块，不要加任何解释文字。**不要输出任何字符序号。**
{
  "sentences": [
    {
      "sourceText": "这一句对应的原文（逐字复制原文，中文原文就是中文）",
      "original": "学生译文里的那一句，逐字复制",
      "rewritten": "改写后的那一句",
      "explanation": "为什么这么改；改成了什么。",
      "praise": "（这一句写得好的话就写在这里；改过就留空）"
    }
  ]
}
`.trim()
}

/** 大改档的用户消息：与精修档同一套上下文，只是不再提"批注标在哪"。 */
export function buildRefineUserPrompt(request: CorrectionRequest, sectionNote?: string): string {
  return [
    `## 翻译方向`,
    DIRECTION_HINT[request.direction],
    ``,
    `## 文体要求`,
    GENRE_HINT[request.genre],
    ``,
    `## 待译原文`,
    request.source,
    ``,
    `## 学生的译文（请逐句改写这一段）`,
    request.answer,
    ``,
    ...(sectionNote ? [sectionNote, ``] : []),
    `请按前述格式返回 JSON。再次提醒：original 必须与上面这段译文**逐字相同**（含标点），` +
      `并且每一句都要列出来（没改的也照抄一遍）。`,
  ].join('\n')
}

/* ── AI 出题 ──────────────────────────────────────────────── */

export interface GenerationRequest {
  direction: Direction
  genre: Genre
  /** 领域，用户可选预设也可以自己输入 */
  topic: string
  /** 要出哪种题型：文章给全文，其余题型由程序从全文里截取 */
  mode: Mode
}

/** 出题时的方向说明（与批改那份分开：这里不该提"批注标在哪"）。 */
const GENERATION_DIRECTION: Record<Direction, string> = {
  'zh-to-en': '中译英：原文是中文，参考译文是英文',
  'en-to-zh': '英译中：原文是英文，参考译文是中文',
}

/**
 * 篇长口径**直接取自 generate.ts 的 LENGTH_RULE**，不在这里另抄一份：
 * 提示词里说的数字与程序硬校验的数字必须是同一个，否则改了一处就会出现
 * "提示词说要 250 词、校验按 200 词放行"这种谁也说不清的问题。
 */
function lengthHint(direction: Direction): string {
  const rule = LENGTH_RULE[direction]
  const what = direction === 'en-to-zh' ? '英文原文' : '中文原文'
  return `${what} ${rule.min}-${rule.max} ${rule.unit}`
}

/**
 * 赛制规格：命题的依据。
 *
 * 为什么要整块写进提示词：**模型不联网**，它没法自己去查"外研社·国才杯"是什么比赛、
 * 怎么命题。不把规格交代清楚，它就会按通用英语作文的路子出题——题材飘、文体不对、
 * 埋不进术语，练了也没用。这里照抄公开赛事通知里的关键信息
 * （数字与 README 的规格表、generate.ts 的 LENGTH_RULE 保持一致）。
 */
function competitionSpecBlock(): string {
  return `
## 赛制规格与命题风格（命题的依据，务必对齐）

**一句话概括命题风格**：以「中国时政／国情话语外译 + 通用非文学翻译能力」为底色；
越往高阶，越会加入国际传播型任务（术语阐释、译后编辑、新闻编译、文学翻译）。
所以我们要的是**中国话语怎么准确、规范、可传播地译成英文**，
而不是"优美的文学翻译"——请按前者的路子命题。

### 基本规格
- 赛项：「外研社·国才杯」「理解当代中国」英语组笔译赛项，个人赛。
- 两道题各 50 分、建议各 30 分钟：
  - 英译汉：${lengthHint('en-to-zh')}
  - 汉译英：${lengthHint('zh-to-en')}

### 主题域（固定，不要越界）
- 只写这些领域：**社会、经济、文化、生态、科技**（本站的五大板块），
  以及**习近平新时代中国特色社会主义思想的核心概念**。
- 不要写娱乐、体育、明星八卦、个人生活、网络段子这类与上述无关的题材。

### 素材与语体
- 素材来源很"官方"：《习近平谈治国理政》各卷、《理解当代中国》系列教材、
  《核心术语学习手册》、党的二十大报告、教育强国纲要等。风格参照这些文本：
  政论与外宣笔调、书面语、长句较多、逻辑连接词密集、用具体事实与数据支撑观点。
- 四种文体（不要出这四类之外的体裁）：
  - 政治文献：语体正式庄重，固定表述与关键术语必须精确，避免口语化。
  - 新闻编译：信息为主，表达自然，避免逐字硬译。
  - 文学作品选篇：注意语感与节奏，允许适度的文学性处理——但它仍然是一道
    **翻译题**，要紧扣原文信息，不要写成让人欣赏文笔的散文。
  - 一般说明文：清晰准确为先，避免过度润色。
- **术语是主要考点**：习近平新时代中国特色社会主义思想关键术语、中华思想文化术语的
  翻译及阐释。命题时要有意识地埋入若干个这样的术语与固定表述（就是返回里的 terms）。

### 评分看重什么（命题要让学生练得到这几点）
- 术语准、**政治含义不跑偏**、句式符合英文习惯、逻辑不断、不硬译不漏译。
- 展开成四条尺子，按重要性排：
  1. 术语与固定表述必须一字不差（唯一的硬性红线）；
  2. 不得造成误解——尤其**不能把政治含义译跑偏**；
  3. 不得漏译，含原文的逻辑关系（转折、因果、递进）；
  4. 意思传达准确即可：句式可以重组、语序可以调整、词语可以换同义表达。

### 不要偏题怪题
- 不写冷门典故、不堆生僻专有名词、不写诗歌／古汉语／方言，也不要写必须靠背景知识
  才读得懂的内容。题材越贴近"五位一体"、语体越像官方文本，就越对路。

### 你不能联网
- 不要声称引自某篇报道、某份文件或某位领导人的讲话，不要编造出处、链接或带引号的
  直接引语。把内容写成"同类题材的原创材料"即可。
`.trim()
}
const GENERATION_TARGET: Record<Mode, string> = {
  article: '一篇完整的文章（按自然段组织，全文要达到上面的篇幅要求）',
  paragraph: '一篇完整的文章；题目会从里面取一个自然段',
  sentence: '一篇完整的文章；题目会从里面取一个句子',
  term: '一篇完整的文章，并额外列出文章里的关键术语；题目会取其中的术语',
}

/**
 * 出题的系统提示。
 *
 * 与批改共用同一套"只返回 JSON"的约定，但**判定标准完全不同**：
 * 这里是命题，不是改卷。刻意写死"原创、有细节、必须达标"，
 * 否则模型很容易返回正确的废话（读起来没错，但什么都练不到）。
 */
export function buildGenerationSystemPrompt(): string {
  return `
你是「外研社·国才杯」「理解当代中国」英语组笔译赛项的**命题人**。
请原创一段与赛题同规格的翻译材料，并给出配套参考译文。

${competitionSpecBlock()}

## 硬性要求
1. **必须原创**：不要照抄任何已有的新闻报道、教材或领导人讲话原文，但可以写同类题材。
2. **内容要具体**：有事实、数据、细节与逻辑层次（有转折、因果或递进），
   不要写成空洞的口号；宁可写一件具体的事，也不要罗列抽象概念。
3. **篇幅必须达标**（程序会硬校验，不达标会被退回重写）：
   - 英译中：${lengthHint('en-to-zh')}
   - 中译英：${lengthHint('zh-to-en')}
4. **按自然段组织**：每段同时给出原文与它的参考译文。
5. 译文要地道、准确，符合该文体的行文习惯；术语与固定表述必须使用官方通行译法。
6. 另外给出文章里用到的 3-5 个关键术语或固定表述及其通行译法
   （中译英时 source 是中文、translation 是英文；英译中时反过来）。

## 返回格式
只返回一个 JSON 对象，不要包裹代码块，不要加任何解释文字：

{
  "topic": "领域",
  "genre": "political | news | literature | expository",
  "paragraphs": [{ "source": "第一段原文", "translation": "第一段参考译文" }],
  "terms": [{ "source": "术语原文", "translation": "术语的通行译法" }]
}

注意：genre 必须取自上面四个值之一；paragraphs 至少一段，不能为空；source 与 translation 都不能缺。
`.trim()
}

/** 出题的用户消息：这道题的具体要求。 */
export function buildGenerationUserPrompt(request: GenerationRequest): string {
  return [
    `## 命题要求`,
    `- 翻译方向：${GENERATION_DIRECTION[request.direction]}`,
    `- 文体：${GENRE_HINT[request.genre]}`,
    `- 领域：${request.topic}`,
    `- 篇幅：${lengthHint(request.direction)}`,
    `- 形态：${GENERATION_TARGET[request.mode]}`,
    ``,
    `请按系统提示里的 JSON 格式返回。`,
  ].join('\n')
}