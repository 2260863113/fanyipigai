# 术语判分从"严格一字不差"放宽到"官方别名算对"

## 决定

术语题的判分**仍然由程序本地对照，仍然不做同义替换**，但"同一个答案的不同写法"扩大了四处：

1. **官方缩写算对**：`National People's Congress (NPC)` 的 `NPC` 与全称**一样算对**，
   连括号一起照抄也算对（三档写法：全串、去括号的主译法、缩写本身）。
2. **英美拼写算对**：`Organisation`/`Organization`、`Co-operation`/`Cooperation`、
   `Labour`/`Labor`、`Programme`/`Program`、`Centre`/`Center`。
   ⚠️ 这一条**照词给出**（`build-terms.mjs` 的 `SPELLING_PAIRS`），**不写通则**。
3. **重音符号不计较**：`Fédération Internationale de Football Association` 写不加重音的也算对。
   归一化里做的是 NFD 分解 + 去掉组合符，不是特例。
4. **开头的 The 写不写都算对**，括号两边的空格也不计较（`United Nations (UN)` = `United Nations(UN)`）。

另外**一英多中**：同一条官方英文对应两条中文时（`直辖市人民政府` 与 `设区的市人民政府` 都是
`Municipal People's Government`）**写哪个都算对**，屏幕上把两个中文用「／」一起列出来。

## 为什么

这批材料（两份机关名称 docx）的性质与早先那 43 条政论术语不一样：

- 材料里 **143 条中有 65 条**尾巴上挂着官方缩写（`(UN)`、`(UNESCO)`、`(NPC)`）。
  照旧口径就得连缩写一起背，"我写了 UN 它却说我错"是纯冤枉。
- 材料里**同时出现英式与美式拼写**（`Organisation for Economic Co-operation and Development`
  与 `World Health Organization` 就在同一份文件里）。要求用户跟着每一条记住它是英式还是美式，
  考的是拼写习惯，不是术语。
- `Fédération`（FIFA）与 `Médecins Sans Frontières` 的重音，键盘上打不出来。
- `The Supreme People's Court of the People's Republic of China` 开头的 The 不是术语的一部分。

用户对口径这一题选的是最宽的那一档（"主译法与括号别名都算对，且不计较英美拼写、重音符号、开头的 The"）。

⚠️ **那条老规矩仍然成立**：`whole-process people's democracy` 与 `whole-process democracy`
**只认前者**——那是同义替换（少一个词就是少一个词），不在放宽之列。
放宽的是"同一条官方译名的不同写法"，不是"意思差不多的另一种说法"。

## 为什么放宽必须**照词表**而不是写通则

一个真实的陷阱：把英美拼写写成通则 `-our → -or`、`-ise → -ize`，那么

- `four` 会被"接受"成 `for`；
- `precise` 会被"接受"成 `precize`。

**假放宽比不放宽更坏**：用户会看到"我写错了它却说对"，而判分本来是"可复现、可解释"的卖点。
因此这批差异**逐词列在生成脚本里**，生成成数据里的 `enAlt`；
`scripts/check-terms.mjs` 再加一条反向断言盯着它：**任何一条术语的答案，都不能被"别的术语的答案"接受**
（唯一例外是登记在 `zhAlt` 里的一英多中那两条）。这条断言就是为这类"字符串替换过宽"的 bug 准备的。

## 代价

- 判分比"严格一字不差"松。想练"一字不差"的人得到的是"官方译名的一种写法"这一档要求。
- 变体是**生成的**，因此数据文件里每条英文旁边会多几个字符串（实测最多 7 个），
  改 `SPELLING_PAIRS` 要重跑 `node scripts/build-terms.mjs --write`。
- 一英多中让"标准答案"变成一串（`直辖市人民政府／设区的市人民政府`），
  同一条在结果栏里比别的行更长——这是为了不让答对的人以为自己错了。
