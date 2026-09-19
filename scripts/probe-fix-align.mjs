/**
 * 量「填补文字」与「被修改文字」的对齐。
 *
 * 为什么需要它：结构断言（有没有某个 class、有没有某段文字）证明不了"上下对不对齐"——
 * 这类问题只有把两边的坐标量出来才说得清，而且**拖一次分隔条再量一遍**才知道会不会错位
 * （四栏是 flex 布局，拖分隔条改的是栏宽，窗口尺寸一点没变）。
 *
 * 做法与 visual.ts 同一套：起一个 vite 服务 → CDP 驱动无头 Edge/Chrome →
 * 在页面加载前注入接口桩 → 真切题、填示例作答、点提交 → 量坐标。
 *
 * 用法：node scripts/probe-fix-align.mjs [题号] [题型] [第几题] [截图前缀] [拖动像素]
 *   例：node scripts/probe-fix-align.mjs sentence-001 句子 0 s1 220
 * 开关：
 *   --synthetic  不用内置示例，改用构造题（被改内容跨两行 / 插入点漏词），见 buildSynthetic
 *   --insert     构造题改成"漏了一个词"（量插入空位那一块）
 *   --pad-effect 额外量一次"把空档摘掉"的坐标，用来看撑宽有没有把原文挤得重新折行
 *   --tight      把设置里的行距滑杆拉到最紧再量一遍（跨行拆段时第二段挤不挤，全看这里）
 * 产物：控制台一张对照表（每段与对应那行带子的左右偏差、宽度差、上下余量），
 *       以及 .screenshots/ 下拖动前后的两张局部截图（供人眼确认）。
 *
 * 对着看的两个数字：
 *   - 左/右偏差：每段的方框与它正下方那行带子应当**左右都对齐**（偏差恒为 0）；
 *     不为 0 只有两种可能——"被栏边顶回来"（贴栏边且方框更宽），
 *     或者同一层的两个方框被挤开后各让了一半（不许互相盖是硬规则）。
 *   - 上一行内容盒下的余量：多段时第二段起就落在"上一行与这一行之间"，
 *     这个数必须 ≥ 0，否则补写的字压在上一行的字上。 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { inflateSync } from 'node:zlib'
import { pageSource } from './lib/row-merge.mjs'

/**
 * 「按顶边把矩形归并成行」的源码，注入页面用。
 * 取自 scripts/lib/row-merge.mjs 里那个函数的**真实源码**，不是另抄一份——
 * 原先这个算法在本文件里抄了三份（外加组件里一份），漂移了没人发现。
 */
const ROW_MERGE_SOURCE = pageSource()

const root = process.cwd()
const port = 5401
const debugPort = 9229
const exerciseId = process.argv[2] ?? 'sentence-001'
/** 顶层导航里要切到的题型标签；空字符串表示不切（停在默认的文章题） */
const tabLabel = process.argv[3] ?? '句子'
/** 该题型下第几道题（从 0 起） */
const caseIndex = Number(process.argv[4] ?? '0')
/** 截图文件名前缀，输出到 .screenshots/ */
const shotLabel = process.argv[5] ?? 'probe'
/** 分隔条往右拖多少像素 */
const dragByArg = Number(process.argv[6])
const dragBy = Number.isFinite(dragByArg) ? dragByArg : 220
/** --synthetic：不用内置示例，改用一份"被改内容跨两行"的构造题（见 buildSynthetic） */
const useSynthetic = process.argv.includes('--synthetic')
const probeUrl = `http://127.0.0.1:${port}/index.html`
const pageUrl = `http://127.0.0.1:${port}/`

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (typeof message.id !== 'number') return
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${entry.method} 失败：${message.error.message}`))
      else entry.resolve(message.result ?? {})
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(`页面脚本出错：${result.exceptionDetails.text}`)
    return result.result?.value
  }
  close() {
    this.ws.close()
  }
}

const MEASURE = `(() => {
  ${ROW_MERGE_SOURCE}
  const pane = document.querySelector('.pane-answer');
  const container = pane && pane.querySelector('.annotated');
  if (!container) return { error: '译文栏里没有 .annotated' };
  const base = container.getBoundingClientRect();
  const anchors = [...container.querySelectorAll('[data-fix-key]')];
  const widest = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = typeof range.getClientRects === 'function'
      ? [...range.getClientRects()].filter((r) => r.width > 0)
      : [];
    if (!rects.length) {
      const box = el.getBoundingClientRect();
      return { rect: box, lines: 1, total: box.width, all: [] };
    }
    // 按顶边并成"行"（嵌套元素会把同一行报两遍）。规则来自 row-merge.mjs，
    // 与组件里 shapeOf 用的是同一份实现源码，不再是手抄的副本。
    const rows = mergeRowsOnTopEdge(range.getClientRects());
    return {
      rect: rows.reduce((b, r) => (r.width > b.width ? r : b)),
      lines: rows.length,
      total: rows.reduce((sum, r) => sum + r.width, 0),
      all: rows.map((r) => [ +(r.left - base.left).toFixed(2), +(r.top - base.top).toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2) ]),
    };
  };
  const lines = container.querySelector('.annotated-lines');
  /*
   * 「上下间隔」按**墨迹**算，不按矩形算：矩形里含有行高带来的空白，
   * 照矩形算出来的数字与人眼看到的不一回事。用 canvas 的字形度量换算出
   * 这一串文字真正画出来的最高/最低点。
   */
  const inkOf = (el, rect) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const m = ctx.measureText(el.textContent || '');
    const ascent = m.fontBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent;
    const contentTop = rect.top - base.top + Math.max(0, (rect.height - (ascent + descent)) / 2);
    const baseline = contentTop + ascent;
    return {
      inkTop: +(baseline - m.actualBoundingBoxAscent).toFixed(2),
      inkBottom: +(baseline + m.actualBoundingBoxDescent).toFixed(2),
    };
  };
  const cs = lines ? getComputedStyle(lines) : null;
  /*
   * 记号语言的体检：译文上不该再有任何删除线/波浪线，被改动的内容应当带荧光笔底色。
   */
  const marked = [...container.querySelectorAll('.mk, .mk-deleted, .mk-rewrite-old')];
  const decorationOf = (el) => getComputedStyle(el).textDecorationLine || 'none';
  const bgOf = (el) => getComputedStyle(el).backgroundColor;
  const decorated = marked.filter((el) => decorationOf(el) !== 'none');
  const tints = [...new Set(marked.map(bgOf).filter((value) => value !== 'rgba(0, 0, 0, 0)'))];
  /*
   * 撑出去那段里，**点击**会命中谁。
   *
   * 注意它说明的是命中，不是绘制先后：被改内容的盒子即使底色已经让位（改由带子层画），
   * 那一击照样落在它身上——这很正常，也正合需要（点勾画要能出气泡）。
   * "底色有没有盖住文字"是另一件事，靠下面的 measureInk 数像素，那才是绘制顺序。
   */
  const topAt = (x, y) => {
    const el = document.elementFromPoint(base.left + x, base.top + y);
    if (!el) return '（视口外）';
    return typeof el.className === 'string' && el.className ? el.className : el.tagName.toLowerCase();
  };
  const isSelf = (name, el) => typeof el.className === 'string' && name === el.className;
  return {
    containerWidth: container.clientWidth,
    lineHeight: cs ? cs.lineHeight : null,
    fontSize: cs ? cs.fontSize : null,
    containerPaddingTop: getComputedStyle(container).paddingTop,
    marks: {
      total: marked.length,
      decorated: decorated.length,
      decoratedSample: decorated.slice(0, 4).map((el) => el.className + ' → ' + decorationOf(el)),
      tints: tints.map((value) => value),
    },
    pairs: anchors.map((a, i) => {
      const picked = widest(a);
      const ar = picked.rect;
      /*
       * 荧光笔带子：按元素自身的**分行**矩形量（跨行时各行相加才是它横着占的总宽）。
       * 每段的位置也要看：左边那段空档应当落在第一段的左边、右边那段落在最后一段的右边。
       */
      const fragments = (typeof a.getClientRects === 'function'
        ? [...a.getClientRects()]
        : [a.getBoundingClientRect()]
      ).filter((r) => r.width > 0).map((r) => ({
        left: +(r.left - base.left).toFixed(2),
        top: +(r.top - base.top).toFixed(2),
        width: +r.width.toFixed(2),
        height: +r.height.toFixed(2),
      }));
      const band = a.getBoundingClientRect();
      /*
       * 这一处的方框：跨行且补写更宽时会有好几个（data-fix-for 指回是"哪一处"，
       * data-fix-part 指回是"第几段"）——第 k 段应当正对第 k 行的带子。
       */
      const key = a.dataset.fixKey;
      const boxNodes = [...container.querySelectorAll('.fix-text')].filter((el) => el.dataset.fixFor === key);
      const parts = boxNodes.map((b, k) => {
        const br = b.getBoundingClientRect();
        const fragment = fragments[k] || null;
        const above = k > 0 ? fragments[k - 1] : null;
        const style = getComputedStyle(b);
        const left = +(br.left - base.left).toFixed(2);
        const top = +(br.top - base.top).toFixed(2);
        return {
          part: k,
          text: (b.textContent || '').slice(0, 60),
          left,
          top,
          width: +br.width.toFixed(2),
          height: +br.height.toFixed(2),
          center: +(left + br.width / 2).toFixed(2),
          bandLeft: fragment ? fragment.left : null,
          bandTop: fragment ? fragment.top : null,
          bandWidth: fragment ? fragment.width : null,
          leftDelta: fragment ? +(left - fragment.left).toFixed(2) : null,
          rightDelta: fragment ? +((left + br.width) - (fragment.left + fragment.width)).toFixed(2) : null,
          widthDelta: fragment ? +(br.width - fragment.width).toFixed(2) : null,
          /**
           * 方框边缘离带子边缘有多远。
           * 现在方框**本来就该比带子窄**（补写内容要往带子里缩），所以这两个数是正数才对；
           * 负数＝方框越出带子（那才是问题）。两者之差＝有没有居中。
           */
          insetLeft: fragment ? +(left - fragment.left).toFixed(2) : null,
          insetRight: fragment ? +((fragment.left + fragment.width) - (left + br.width)).toFixed(2) : null,
          // 这一段的上边到**上一行内容盒底边**还有多少：负数说明压在上一行的字上
          clearAbove: above ? +(top - (above.top + above.height)).toFixed(2) : null,
          font: style.fontSize + '/' + style.lineHeight,
          ink: inkOf(b, br),
        };
      });
      const spanStyle = getComputedStyle(a);
      const slot = a.querySelector('.mk-slot');
      const slotRect = slot ? slot.getBoundingClientRect() : null;
      const first = parts[0] || null;
      /*
       * 带子往两边撑出去时，撑出去的那段底下压着**别的文字**。
       * 在这两段里各取一点问一句"谁在最上面"：拿到被改内容自己就是盖住了文字。
       */
      const firstRow = picked.all[0] || null;
      const lastRow = picked.all[picked.all.length - 1] || null;
      const overText = (from, to, band) => {
        if (!band || to - from < 4) return null;
        const x = (from + to) / 2;
        const y = band.top + band.height / 2;
        const name = topAt(x, y);
        // bandOnTop 为真＝被改内容自己画在这段文字上面，也就是把文字盖住了
        return { x: +x.toFixed(1), name, bandOnTop: isSelf(name, a) };
      };
      return {
        anchorText: (a.textContent || '').slice(0, 44),
        fixText: parts.map((p) => p.text).join(' ／ '),
        anchorCenter: +(ar.left - base.left + ar.width / 2).toFixed(2),
        anchorWidth: +ar.width.toFixed(2),
        anchorTotal: +picked.total.toFixed(2),
        anchorTop: +(ar.top - base.top).toFixed(2),
        anchorHeight: +ar.height.toFixed(2),
        bandWidth: +band.width.toFixed(2),
        bandTotal: +fragments.reduce((sum, item) => sum + item.width, 0).toFixed(2),
        bandFragments: fragments,
        bandCenter: +(band.left - base.left + band.width / 2).toFixed(2),
        bandLeft: +(band.left - base.left).toFixed(2),
        anchorLines: picked.lines,
        anchorRects: picked.all,
        anchorInk: inkOf(a, ar),
        spanFontSize: spanStyle.fontSize,
        spanLineHeight: spanStyle.lineHeight,
        parts,
        // 旧报表格（只有一段时有意义）
        boxLeft: first ? first.left : null,
        boxTop: first ? first.top : null,
        boxWidth: first ? first.width : null,
        boxHeight: first ? first.height : null,
        boxCenter: first ? first.center : null,
        boxFontSize: first ? first.font : null,
        boxInk: first ? first.ink : null,
        slotWidth: slotRect ? +slotRect.width.toFixed(2) : null,
        slotBackground: slot ? getComputedStyle(slot).backgroundColor : null,
        slotHeight: slotRect ? +slotRect.height.toFixed(2) : null,
        /** 左/右撑出去的那一段里，最上面的是谁（自己＝底色盖住了底下的文字） */
        paintOrder: {
          left: firstRow && fragments[0] ? overText(fragments[0].left, firstRow[0], fragments[0]) : null,
          right:
            lastRow && fragments[fragments.length - 1]
              ? overText(
                  lastRow[0] + lastRow[2],
                  fragments[fragments.length - 1].left + fragments[fragments.length - 1].width,
                  fragments[fragments.length - 1],
                )
              : null,
        },
        padLeft: a.style.paddingLeft || '',
        padRight: a.style.paddingRight || '',
        background: spanStyle.backgroundColor,
        textDecoration: spanStyle.textDecorationLine,
      };
    }),
  };
})()`

/**
 * 解一张 PNG（只用得上 8 位 RGB/RGBA，正是 CDP 截屏给的格式）。
 *
 * 为什么要解像素：这一整套问题里唯一说不清的就是"谁盖住了谁"——
 * elementFromPoint 只能说明**命中**给谁，说明不了**画**的先后
 * （被改内容的盒子照样能接到那一击，哪怕它的底色已经让位）。
 * 只有把字到底画出来没有数出来，才算真的量过。
 */
function decodePng(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const chunks = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels || bitDepth !== 8) throw new Error(`只支持 8 位 RGB/RGBA 的 PNG（拿到 ${bitDepth}/${colorType}）`)
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`未知的 PNG 行滤波 ${filter}`)
      cur[x] = value & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** 一块矩形里"深色像素"（字）有多少个。底色都是浅色（亮度 200 以上），只有字才是深的。 */
function inkCount(image, x, y, width, height) {
  let count = 0
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(image.width, Math.round(x + width))
  const y1 = Math.min(image.height, Math.round(y + height))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const index = (py * image.width + px) * image.channels
      const r = image.data[index]
      const g = image.data[index + 1]
      const b = image.data[index + 2]
      if ((r * 299 + g * 587 + b * 114) / 1000 < 140) count += 1
    }
  }
  return count
}

/**
 * 量"荧光区域里是不是只有被改内容"：空档那两段里，一个字的像素都不该有。
 *
 * 撑宽的这两段空档是**真空档**（padding），相邻的文字被它推到带子的左右两侧去了。
 * 所以：空档里应当是干净的底色（深色像素 0 个），被改内容自己那两行照旧有字。
 * 只要空档里数出了字，就说明那边的文字又压回带子里来了。
 */
async function measureInk(cdp, label) {
  const box = await cdp.evaluate(
    `(() => { const el = document.querySelector('.pane-answer .annotated'); if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height }; })()`,
  )
  if (!box || box.width <= 0) return null
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    captureBeyondViewport: true,
  })
  const image = decodePng(Buffer.from(shot.data, 'base64'))
  const regions = await cdp.evaluate(
    `(() => {
       ${ROW_MERGE_SOURCE}
       const container = document.querySelector('.pane-answer .annotated');
       const base = container.getBoundingClientRect();
       const rowsOf = (el) => {
         const range = document.createRange();
         range.selectNodeContents(el);
         return mergeRowsOnTopEdge(range.getClientRects());
       };
       const out = [];
       for (const a of container.querySelectorAll('[data-fix-key]')) {
         const padLeft = parseFloat(a.style.paddingLeft) || 0;
         const padRight = parseFloat(a.style.paddingRight) || 0;
         if (padLeft <= 0 && padRight <= 0) continue;
         const frags = [...a.getClientRects()].filter((r) => r.width > 0);
         const rows = rowsOf(a);
         if (!frags.length || !rows.length) continue;
         const frag0 = frags[0];
         const row0 = rows[0];
         const fragN = frags[frags.length - 1];
         const rowN = rows[rows.length - 1];
         out.push({
           key: a.dataset.fixKey,
           pad: [ +padLeft.toFixed(1), +padRight.toFixed(1) ],
           left: { x: frag0.left - base.left, y: row0.top - base.top, width: row0.left - frag0.left, height: row0.height },
           right: { x: (rowN.left + rowN.width) - base.left, y: rowN.top - base.top,
                    width: fragN.left + fragN.width - (rowN.left + rowN.width), height: rowN.height },
           own: { x: row0.left - base.left, y: row0.top - base.top, width: row0.width, height: row0.height },
         });
       }
       return out;
     })()`,
  )
  console.log(`\n=== 荧光带子里是不是只有被改内容（按像素数，${label}） ===`)
  if (regions.length === 0) {
    console.log('  没有"撑空档"的地方，这一轮不用看')
    return
  }
  for (const region of regions) {
    const leftInk = inkCount(image, region.left.x, region.left.y, region.left.width, region.left.height)
    const rightInk = inkCount(image, region.right.x, region.right.y, region.right.width, region.right.height)
    const ownInk = inkCount(image, region.own.x, region.own.y, region.own.width, region.own.height)
    const ok = leftInk === 0 && rightInk === 0
    console.log(
      `  ${region.key}（左空档 ${region.pad[0]}px / 右空档 ${region.pad[1]}px）：` +
        `空档里的字 ${leftInk} ／ ${rightInk} 个 ｜ 被改内容自己的字 ${ownInk} 个 → ` +
        `${ok ? '✓ 带子里只有被改内容' : '✗ 相邻文字压在带子里'}`,
    )
  }
}

/**
 * 上面那把尺子准不准：把**从前的画法**临时放回来——空档配一对负 margin，
 * 于是带子又会压到相邻文字上——再量一次。
 * 这时"空档里的字"应当立刻不再是 0，说明这把尺子真的量得出。
 */
async function negativeControl(cdp) {
  const setup = await cdp.evaluate(
    `(() => {
       const container = document.querySelector('.pane-answer .annotated');
       const padded = [...container.querySelectorAll('[data-fix-key]')].filter(
         (a) => (parseFloat(a.style.paddingLeft) || 0) + (parseFloat(a.style.paddingRight) || 0) > 0,
       );
       if (!padded.length) return 0;
       for (const el of padded) {
         el.style.marginLeft = el.style.paddingLeft ? '-' + el.style.paddingLeft : '';
         el.style.marginRight = el.style.paddingRight ? '-' + el.style.paddingRight : '';
       }
       return padded.length;
     })()`,
  )
  if (!setup) return
  await measureInk(cdp, '对照：用负 margin 把带子压回文字上')
  await cdp.evaluate(
    `(() => {
       for (const el of document.querySelectorAll('.pane-answer .annotated [data-fix-key]')) {
         el.style.marginLeft = '';
         el.style.marginRight = '';
       }
     })()`,
  )
}

/** 只截译文栏那一块（放大 2 倍），用来看"上下间隔"到底长什么样。 */
async function shoot(cdp, name) {
  const box = await cdp.evaluate(
    `(() => { const el = document.querySelector('.pane-answer'); if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(r.height, 620) }; })()`,
  )
  if (!box || box.width <= 0) return
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
    captureBeyondViewport: true,
  })
  mkdirSync(path.join(root, '.screenshots'), { recursive: true })
  const file = path.join(root, '.screenshots', `${name}.png`)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log(`  截图 ${file}`)
}

/**
 * 构造一道"被改内容跨两行"的题。
 *
 * 为什么要它：内置的 11 道示例里，每一处替换/重写都很短，一行装得下——
 * "被改内容有一半在上一行、另一半在本行"这种情形在示例里根本量不到。
 * 这里的作答把要改的那句放在**行末**，于是它必然断成两行：
 * 上半行占一截、下半行占一截（正是用户描述的那种情况）。
 *
 * 走的是与真实批改完全相同的管线（parseCorrection → validateCorrection），
 * 因此 spans 与作答严格对得上。
 */
async function buildSynthetic(root, mode = 'rewrite') {
  /*
   * 两道构造题：
   *   rewrite —— 被改的那句必须跨两行（量"补写内容跟随换行"用的就是这道）；
   *   insert  —— 译文里漏了一个词，量的是插入点那块荧光笔空位（宽度应当正好等于补写内容的宽度）。
   */
  const cases = {
    rewrite: {
      answer:
        'In the quiet mountain village beside the lake, the wise old farmer and herder worked the land together for many years.',
      raw: {
        errors: [
          {
            id: 'syn-1',
            // 用 rewrite 而不是 replace：replace 的旧文字是 nowrap 的一整块，
            // 装不下时整块挪到下一行、永远不会跨行；rewrite 才会断成两行——
            // 而"被改内容有一半在上一行"正是要量的那种情形
            type: 'rewrite',
            category: 'terminology',
            oldText: 'the wise old farmer and herder',
            targetText: 'the elder who cultivates the land and tends the herd',
            explanation: '“农牧民”宜按固定说法译出，并避免 farmer and herder 这种直译。',
          },
        ],
        highlights: [],
      },
    },
    insert: {
      answer: 'She held fast to dream through the long winter and made it come true at last.',
      raw: {
        errors: [
          {
            id: 'syn-ins',
            type: 'insert',
            category: 'function-word',
            insertAfterText: 'to',
            targetText: 'her ',
            explanation: '“坚持梦想”是固定搭配，dream 前面漏了物主代词。',
          },
        ],
        highlights: [],
      },
    },
  }
  const chosen = cases[mode] ?? cases.rewrite
  const answer = chosen.answer
  const raw = chosen.raw

  const { build } = await import('esbuild')
  const cacheDir = path.join(root, 'node_modules', '.cache', 'probe-synthetic')
  mkdirSync(cacheDir, { recursive: true })
  const entry = path.join(cacheDir, 'entry.ts')
  const outfile = path.join(cacheDir, 'out.mjs')
  writeFileSync(
    entry,
    [
      `import { parseCorrection, toAiShape } from ${JSON.stringify(path.join(root, 'src', 'domain', 'parse.ts'))}`,
      `import { validateCorrection } from ${JSON.stringify(path.join(root, 'src', 'domain', 'validate.ts'))}`,
      `import { splitSections } from ${JSON.stringify(path.join(root, 'src', 'domain', 'sections.ts'))}`,
      `const answerText = ${JSON.stringify(answer)}`,
      `const parsed = parseCorrection(${JSON.stringify(JSON.stringify(raw))}, answerText)`,
      `if (!parsed.ok) throw new Error(parsed.problems.join(' / '))`,
      `const checked = validateCorrection(parsed.correction.errors, parsed.correction.highlights, answerText)`,
      `export const answer = answerText`,
      `export const answerSections = splitSections(answerText).map((s) => s.text)`,
      `export const payload = {`,
      `  ok: true, attempts: 1, repaired: [], sectionCount: answerSections.length,`,
      `  correction: { errors: parsed.correction.errors, highlights: parsed.correction.highlights },`,
      `  validated: {`,
      `    errors: checked.errors.map((e) => ({ error: e.error, changes: e.changes, span: e.span, insertPoint: e.insertPoint, reorderSpans: e.reorderSpans, reordered: e.reordered })),`,
      `    highlights: checked.highlights.map((h) => ({ highlight: h.highlight, span: h.span })),`,
      `    rejections: checked.rejections,`,
      `  },`,
      `  raw: JSON.stringify(toAiShape(parsed.correction), null, 2),`,
      `}`,
    ].join('\n'),
    'utf8',
  )
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  })
  const mod = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)
  return { payload: mod.payload, answerSections: mod.answerSections, answer: mod.answer }
}

/**
 * 本次探测发现的**失败项**。
 *
 * 为什么需要它：这个探针是"补写内容与荧光带对齐"这个高风险特性的**唯一证据**，
 * 而它原先**不可能失败**——全文没有一处 process.exitCode，发现问题的分支
 * （console.log 一句 ✗）对退出码毫无影响；更糟的是 report() 里全是
 * `?? 0` / `?? ''` 兜底，字段名一旦改动（或页面结构变了量不到东西），
 * 所有数字会静默变成 0，小结打印出"越出或明显不居中的有 0 处"——
 * 和真正的成功**字面上一模一样**。于是它既不能进 CI，也不能当验收依据。
 *
 * 现在：量不到东西、或超出容差，都会记在这里，最后据此设置退出码。
 */
const failures = []
/** 量到的"超出容差"处数的最大值（跨多次 report 取最坏） */
let worstOffByThresh = 0

/** 容差（与 report 里小结用的判据一致，集中在这里方便调） */
const TOLERANCE = {
  /** 方框允许比带子窄多少（负数=越出带子）。0.5px 是亚像素取整的余量 */
  inset: -0.5,
  /** 左右留白之差的允许上限（居中误差） */
  center: 1.5,
}

function report(label, data) {
  console.log(`\n=== ${label} ===`)
  if (!data || data.error) {
    /*
     * 量不到就是**失败**，不是"没问题"。
     * 原先这里只打印一句"量不到"然后 return，退出码依然是 0——
     * 页面结构一改、选择器一失效，整个探针就静悄悄地什么都验不了却显示成功。
     */
    const why = data?.error ?? '空'
    console.log('  量不到：' + why)
    failures.push(`${label}：量不到数据（${why}）`)
    return
  }
  if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
    // 一处都没量到：可能是这道题本来就没有可撑宽的批注，也可能是选择器失效。
    // 两者必须分清，所以由调用方通过 opts.expectPairs 声明"这一轮应该量到东西"。
    console.log('  没有量到任何"补写内容 ↔ 荧光带"配对')
  }
  console.log(
    `  译文栏宽 ${data.containerWidth} 行高 ${data.lineHeight} 字号 ${data.fontSize} 上留白 ${data.containerPaddingTop}`,
  )
  if (data.marks) {
    console.log(
      `  记号体检：${data.marks.total} 个标记，带删除线/波浪线的 ${data.marks.decorated} 个` +
        (data.marks.decorated ? `（${data.marks.decoratedSample.join('；')}）` : '') +
        ` ｜ 底色：${data.marks.tints.join(' / ') || '（无）'}`,
    )
  }
  let worst = 0
  let worstBand = 0
  let worstEdge = 0
  for (const [index, pair] of data.pairs.entries()) {
    console.log(
      `  [${index}] ${JSON.stringify(pair.anchorText)}\n` +
        `      被改文字 ${pair.anchorWidth} 宽（总宽 ${pair.anchorTotal}，${pair.anchorLines} 行，行盒 ${pair.anchorHeight}，字号 ${pair.spanFontSize}/${pair.spanLineHeight}）\n` +
        `      被改各行：${pair.anchorRects.map((r) => `左${r[0]} 上${r[1]} 宽${r[2]} 高${r[3]}`).join(' ｜ ') || '（量不到）'}\n` +
        `      荧光笔带子 总宽 ${pair.bandTotal}（包围盒 ${pair.bandWidth}）：${pair.bandFragments.map((f) => `左${f.left} 上${f.top} 宽${f.width} 高${f.height}`).join(' ｜ ')}（底色 ${pair.background}，装饰 ${pair.textDecoration}）\n` +
        `      两边空档 left=${pair.padLeft || '—'} right=${pair.padRight || '—'}` +
        (pair.slotWidth === null
          ? ''
          : ` ｜ 插入空位 宽${pair.slotWidth} 高${pair.slotHeight} 底色${pair.slotBackground}`) +
        (pair.paintOrder.left || pair.paintOrder.right
          ? `\n      撑出去那段里，点击命中给谁：` +
            [pair.paintOrder.left, pair.paintOrder.right]
              .filter(Boolean)
              .map((item) => `${item.name}${item.bandOnTop ? '（是勾画自己，点得中）' : '（不是勾画）'} 横坐标 ${item.x}`)
              .join(' ｜ ') +
            `（这是**命中**，不是绘制先后；底色盖没盖住文字看下面的像素数）`
          : ''),
    )
    for (const part of pair.parts) {
      const inkGap =
        part.ink && pair.anchorInk && part.part === 0
          ? +(pair.anchorInk.inkTop - part.ink.inkBottom).toFixed(2)
          : null
      console.log(
        `      · 第 ${part.part + 1} 段 ${JSON.stringify(part.text)}\n` +
          `        方框 左${part.left} 上${part.top} 宽${part.width} 高${part.height}（字号 ${part.font}）\n` +
          `        对应带子 左${part.bandLeft} 上${part.bandTop} 宽${part.bandWidth}\n` +
          `        离带子边缘 左 ${part.insetLeft}px / 右 ${part.insetRight}px（都应为正：方框比带子窄）｜ ` +
          `宽度差 ${part.widthDelta}px ｜ 上一行内容盒下的余量 ${part.clearAbove === null ? '—' : part.clearAbove + 'px'}` +
          (inkGap === null ? '' : ` ｜ 墨迹间隔 ${inkGap}px`),
      )
    }
    const hasText = (pair.anchorText ?? '').trim() !== ''
    if (hasText) {
      for (const part of pair.parts) {
        const left = part.insetLeft ?? 0
        const right = part.insetRight ?? 0
        // 方框越出带子（负数）才算问题；两者之差是居中误差
        worst = Math.max(worst, Math.max(0, -left), Math.max(0, -right))
        worstEdge = Math.max(worstEdge, Math.abs(left - right))
        worstBand = Math.max(worstBand, Math.abs(part.widthDelta ?? 0))
      }
    }
  }
  /*
   * 小结口径：
   *   - "越出带子"应当是 0（补写内容该比带子窄，而不是压出去）；
   *   - "居中误差"是方框左右留白之差，应当很小（差得多说明没居中）。
   */
  let offByThresh = 0
  let clamped = 0
  let splitting = 0
  for (const pair of data.pairs) {
    if ((pair.anchorText ?? '').trim() === '') continue
    if (pair.parts.length > 1) splitting += 1
    for (const part of pair.parts) {
      const left = part.insetLeft ?? 0
      const right = part.insetRight ?? 0
      if (left >= TOLERANCE.inset && right >= TOLERANCE.inset && Math.abs(left - right) <= TOLERANCE.center) continue
      offByThresh += 1
      if ((part.left ?? 0) <= 0.5 || (part.left ?? 0) + (part.width ?? 0) >= data.containerWidth - 0.5) clamped += 1
    }
  }
  console.log(
    `  小结：分段的有 ${splitting} 处 ｜ 最大越出带子 ${worst.toFixed(2)}px ｜ 最大居中误差 ${worstEdge.toFixed(2)}px ｜ ` +
      `与带子的最大宽度差 ${worstBand.toFixed(2)}px ｜ 越出或明显不居中的有 ${offByThresh} 处` +
      `（其中"被栏边顶回来"的有 ${clamped} 处）`,
  )
  worstOffByThresh = Math.max(worstOffByThresh, offByThresh)
  if (offByThresh > 0) {
    failures.push(`${label}：有 ${offByThresh} 处方框越出带子或明显不居中（其中被栏边顶回来 ${clamped} 处）`)
  }
  return { pairs: data.pairs.length, offByThresh, splitting, worst, worstEdge, worstBand }
}

async function main() {
  const browser = findBrowser()
  if (!browser) throw new Error('没有找到 Edge 或 Chrome')

  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(process.execPath, [viteBin, '--port', String(port), '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  })
  let browserProcess
  try {
    for (let i = 0; i < 120; i += 1) {
      try {
        if ((await fetch(probeUrl)).ok) break
      } catch {
        /* 还没起来 */
      }
      await sleep(400)
    }

    const profileDir = path.join(root, 'node_modules', '.cache', 'probe-profile')
    browserProcess = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--window-size=1600,950',
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    let ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        ready = true
      } catch {
        await sleep(300)
      }
    }
    if (!ready) throw new Error('无头浏览器没起来')

    const { buildStubSource } = await import('./fixture-stub.mjs')
    const { buildFixturePayload } = await import('./fixture-payload.mjs')
    const fixture = useSynthetic
      ? await buildSynthetic(root, process.argv.includes('--insert') ? 'insert' : 'rewrite')
      : await buildFixturePayload(root, exerciseId)

    const target = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
    ).json()
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('连不上调试通道')))
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildStubSource([{ answer: fixture.answer, payload: fixture.payload }]),
    })
    await cdp.send('Page.navigate', { url: pageUrl })

    for (let i = 0; i < 60; i += 1) {
      if (await cdp.evaluate("!!document.querySelector('.mode-tabs')")) break
      await sleep(250)
    }
    await sleep(600)

    // 先切到指定题型与题目
    if (tabLabel) {
      const switched = await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const btn = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === ${JSON.stringify(tabLabel)});
           if (!btn) return '找不到题型标签';
           btn.click();
           await sleep(500);
           const item = [...document.querySelectorAll('.case-tab')][${caseIndex}];
           if (!item) return '这道题型下没有第 ${caseIndex + 1} 道题';
           item.click();
           await sleep(500);
           return 'ok';
         })()`,
      )
      if (switched !== 'ok') throw new Error(String(switched))
    }

    // 填写作答并提交
    const outcome = await cdp.evaluate(
      `(async () => {
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const setValue = (el, value) => {
           const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
           setter.call(el, value);
           el.dispatchEvent(new Event('input', { bubbles: true }));
         };
         const sections = ${JSON.stringify(fixture.answerSections)};
         for (let i = 0; i < sections.length; i++) {
           if (i > 0) {
             const next = [...document.querySelectorAll('.section-nav .btn')].find((b) => b.textContent.includes('下一段'));
             if (!next) return '找不到下一段按钮';
             next.click();
             await sleep(250);
           }
           const ta = document.querySelector('.answer-input');
           if (!ta) return '找不到输入框';
           setValue(ta, sections[i]);
           await sleep(250);
         }
         const btn = document.querySelector('.btn-primary');
         if (!btn || btn.disabled) return '提交按钮不可用';
         btn.click();
         for (let i = 0; i < 80; i++) {
           if (!document.querySelector('.answer-input') && document.querySelector('.pane-answer .annotated-lines')) {
             await sleep(800);
             return 'ok';
           }
           const err = document.querySelector('.error-block');
           if (err) return '页面报错：' + err.textContent.slice(0, 200);
           await sleep(200);
         }
         return '没有出现批改结果';
       })()`,
    )
    if (outcome !== 'ok') throw new Error(String(outcome))

    /*
     * 这一轮**必须**量到东西：否则"0 处越出"可能只是选择器失效。
     * report 会把结果返回上来，这里断言真量到了若干配对。
     */
    /*
     * 这一轮**必须**量到东西：否则"0 处越出"可能只是选择器失效。
     * report 会把结果返回上来，这里断言真量到了若干配对。
     */
    const before = report('初始（未拖分隔条）', await cdp.evaluate(MEASURE))
    if (before && before.pairs === 0) {
      failures.push('初始：一处"补写内容 ↔ 荧光带"配对都没量到（选择器失效？这道题没有可撑宽的批注？）')
    }
    await shoot(cdp, `${shotLabel}-before`)
    await measureInk(cdp, '初始')

    // 拖动左右分隔条：把右栏拉窄
    const splitter = await cdp.evaluate(
      `(() => { const el = document.querySelector('.splitter-v'); if (!el) return null;
        const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    )
    if (!splitter) throw new Error('找不到左右分隔条')
    const dragTo = splitter.x + dragBy
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: splitter.x,
      y: splitter.y,
      button: 'left',
      clickCount: 1,
      buttons: 1,
    })
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: splitter.x + ((dragTo - splitter.x) * step) / 10,
        y: splitter.y,
        button: 'left',
        buttons: 1,
      })
      await sleep(50)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dragTo,
      y: splitter.y,
      button: 'left',
      buttons: 0,
    })
    await sleep(900)
    const after = report('拖动分隔条之后', await cdp.evaluate(MEASURE))
    if (after && after.pairs === 0) {
      failures.push('拖动之后：一处配对都没量到（选择器失效？）')
    }
    await shoot(cdp, `${shotLabel}-after`)
    await measureInk(cdp, '拖动之后')
    if (process.argv.includes('--ink-negative')) await negativeControl(cdp)

    /*
     * 底色挪到最底层之后，点得中还点不中？——命中测试也按绘制顺序走，
     * 带子掉到文字下面之后，正好落在带子上的那一击该给谁，必须量一次才知道。
     * （它要是不给勾画，用户就点不出气泡了。）
     */
    const clicks = await cdp.evaluate(
      `(async () => {
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const container = document.querySelector('.pane-answer .annotated');
         const out = [];
         for (const a of container.querySelectorAll('[data-fix-key]')) {
           const range = document.createRange();
           range.selectNodeContents(a);
           const rects = [...range.getClientRects()].filter((r) => r.width > 0);
           const rect = rects[0];
           if (!rect) { out.push({ key: a.dataset.fixKey, top: '（量不到）' }); continue; }
           const x = rect.left + Math.min(6, rect.width / 2);
           const y = rect.top + rect.height / 2;
           const el = document.elementFromPoint(x, y);
           (el || document.body).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
           await sleep(200);
           const bubble = document.querySelector('.ann-bubble');
           out.push({
             key: a.dataset.fixKey,
             top: el ? (typeof el.className === 'string' && el.className ? el.className : el.tagName) : null,
             inside: el ? !!el.closest('[data-fix-key]') : false,
             bubble: bubble ? (bubble.textContent || '').slice(0, 24) : null,
           });
         }
         // 关掉气泡，别影响后面几次测量
         document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
         await sleep(200);

         /*
          * 再点一次**上方补写的字**：判定范围扩大了，它也该把小卡片打开。
          * 以前文档级那句"点外面就收起来"把它当成外面，点上去等于没反应。
          */
         const box = container.querySelector('.fix-text');
         if (box) {
           const r = box.getBoundingClientRect();
           const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || box;
           el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
           await sleep(200);
           const bubble = document.querySelector('.ann-bubble');
           const brs = bubble ? bubble.querySelectorAll('br').length : 0;
           out.push({
             key: '（补写的字）',
             top: typeof el.className === 'string' ? el.className : el.tagName,
             inside: true,
             bubble: bubble ? (bubble.textContent || '').slice(0, 24) : null,
             breaks: brs,
           });
           document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
           await sleep(150);
         }
         return out;
       })()`,
    )
    console.log('\n=== 点得中吗（点勾画上的文字与上方补写的字，看气泡出不出来） ===')
    for (const item of clicks) {
      console.log(
        `  ${item.key}：最上面的是 ${item.top}（落在勾画内：${item.inside ? '是' : '否'}）` +
          ` ｜ 气泡：${item.bubble ? '出来了「' + item.bubble + '…」' : '没出来'}` +
          (item.breaks === undefined ? '' : ` ｜ 说明里的分号断行 ${item.breaks} 处`),
      )
    }

    /*
     * 练习记录页的三条分隔条都要能拖（外层左右、右边屏里上下、以及上排的原文/译文）。
     *
     * 这里必须用真实浏览器量：布局是纯 CSS 的事，jsdom 不排版，量不出"拖完之后译文每行只剩一个字符"
     * 这种毛病（那是嵌套的两层 split 共用了同一套列模板造成的）。
     */
    if (process.argv.includes('--records')) {
      const openRecord = await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '练习记录');
           if (!tab) return '找不到「练习记录」标签';
           tab.click(); await sleep(500);
           const item = document.querySelector('.record-item');
           if (!item) return '还没有练习记录';
           item.click(); await sleep(600);
           return 'ok';
         })()`,
      )
      if (openRecord !== 'ok') {
        console.log(`\n=== 练习记录页的分隔条 ===\n  跳过：${openRecord}`)
      } else {
        const readLayout = () =>
          cdp.evaluate(
            `(() => {
               const pick = (sel) => document.querySelector(sel);
               const width = (sel) => { const el = pick(sel); return el ? +el.getBoundingClientRect().width.toFixed(1) : null };
               const answer = pick('.split-nested .pane-answer');
               const lines = answer ? answer.querySelector('.annotated-lines') : null;
               const lineHeight = lines ? getComputedStyle(lines).fontSize : null;
               return {
                 outerManual: (pick('.split-records')?.className || '').includes('split-manual'),
                 nestedManual: (pick('.split-nested')?.className || '').includes('split-manual'),
                 splitters: document.querySelectorAll('.splitter').length,
                 sourceWidth: width('.split-nested .pane-source'),
                 answerWidth: width('.split-nested .pane-answer'),
                 linesWidth: lines ? +lines.getBoundingClientRect().width.toFixed(1) : null,
                 fontSize: lineHeight,
               };
             })()`,
          )
        const drag = async (selector, dx, dy) => {
          const spot = await cdp.evaluate(
            `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
               const r = el.getBoundingClientRect();
               return { x: r.left + r.width / 2, y: r.top + Math.min(30, r.height / 2) }; })()`,
          )
          if (!spot) return false
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1, buttons: 1 })
          for (let step = 1; step <= 6; step += 1) {
            await cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: spot.x + (dx * step) / 6,
              y: spot.y + (dy * step) / 6,
              button: 'left',
              buttons: 1,
            })
            await sleep(40)
          }
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x + dx, y: spot.y + dy, button: 'left', buttons: 0 })
          await sleep(500)
          return true
        }

        const before = await readLayout()
        const draggedOuter = await drag('.split-records > .splitter-v', 150, 0)
        const afterOuter = await readLayout()
        const draggedNestedV = await drag('.split-nested > .split-row > .splitter-v', -70, 0)
        const afterNestedV = await readLayout()
        const draggedNestedH = await drag('.split-nested > .splitter-h', 0, 50)
        const afterNestedH = await readLayout()

        console.log('\n=== 练习记录页的三条分隔条（真实浏览器） ===')
        for (const [label, state] of [
          ['初始', before],
          ['拖外层左右之后', afterOuter],
          ['再拖上排的原文/译文之后', afterNestedV],
          ['再拖上下之后', afterNestedH],
        ]) {
          console.log(
            `  ${label}：分隔条 ${state.splitters} 条 ｜ 外层手动 ${state.outerManual ? '是' : '否'} ｜ 内层手动 ${state.nestedManual ? '是' : '否'}\n` +
              `      原文栏 ${state.sourceWidth}px ｜ 译文栏 ${state.answerWidth}px ｜ 译文文字宽 ${state.linesWidth}px（字号 ${state.fontSize}）`,
          )
        }
        const bad = afterNestedV.answerWidth !== null && afterNestedV.answerWidth < 60
        console.log(
          `  结论：译文栏 ${afterNestedV.answerWidth}px ${bad ? '✗ 太窄了（正是"每行一个字符"那个 bug）' : '✓ 正常'} ｜ ` +
            `三条都拖到了：${[draggedOuter, draggedNestedV, draggedNestedH].filter(Boolean).length}/3`,
        )
      }
    }

    /*
     * 空档到底把文字挪没挪：把空档摘掉再量一次，两边的坐标一对照就清楚了。
     * 这一条直接决定了"撑宽"这套做法能不能用（撑宽如果顺手把原译文挤到别的行去，
     * 方框锚定的那一行就不是原来那一行了）。
     */
    if (!useSynthetic || process.argv.includes('--pad-effect')) {
      const padEffect = await cdp.evaluate(
        `(() => {
           ${ROW_MERGE_SOURCE}
           const container = document.querySelector('.pane-answer .annotated');
           const base = container.getBoundingClientRect();
           const merge = (rects, mapper) => mergeRowsOnTopEdge(rects).map(mapper);
           const read = () => [...container.querySelectorAll('[data-fix-key]')].map((a) => {
             const range = document.createRange();
             range.selectNodeContents(a);
             return {
               key: a.dataset.fixKey,
               pad: [a.style.paddingLeft || '—', a.style.paddingRight || '—'],
               rows: merge(range.getClientRects(), (r) => [+(r.left - base.left).toFixed(2), +(r.top - base.top).toFixed(2), +r.width.toFixed(2)]),
               frags: merge(a.getClientRects(), (r) => [+(r.left - base.left).toFixed(2), +(r.top - base.top).toFixed(2), +r.width.toFixed(2)]),
             };
           });
           const before = read();
           for (const a of container.querySelectorAll('[data-fix-key]')) {
             a.style.paddingLeft = '';
             a.style.paddingRight = '';
             a.style.marginLeft = '';
             a.style.marginRight = '';
           }
           // 同步再量一次（读到的是"没有空档"的真实排版；React 的重跑这之后才会发生）
           const after = read();
           return { before, after };
         })()`,
      )
      console.log('\n=== 空档的作用（同一处：带着空档 ／ 摘掉空档） ===')
      for (const [index, item] of padEffect.before.entries()) {
        const bare = padEffect.after[index]
        console.log(
          `  [${index}] ${item.key} 空档 ${item.pad.join(' / ')}\n` +
            `      带空档：文字行 ${item.rows.map((r) => `左${r[0]} 上${r[1]} 宽${r[2]}`).join(' ｜ ')}\n` +
            `              带子 ${item.frags.map((r) => `左${r[0]} 上${r[1]} 宽${r[2]}`).join(' ｜ ')}\n` +
            `      无空档：文字行 ${bare.rows.map((r) => `左${r[0]} 上${r[1]} 宽${r[2]}`).join(' ｜ ')}\n` +
            `              带子 ${bare.frags.map((r) => `左${r[0]} 上${r[1]} 宽${r[2]}`).join(' ｜ ')}\n` +
            `              （量完的空档状态 ${bare.pad.join(' / ')}）`,
        )
      }
    }

    /*
     * 行距调到最紧再量一遍：跨行拆段之后，第二段落在"上一行与这一行之间"，
     * 那里够不够高，取决于行距（设置里可以调）。正文会自动加大行距来补，
     * 但只有真量一次才知道补够没有。
     */
    if (process.argv.includes('--tight')) {
      const tight = await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           if (!document.querySelector('.gen-range')) {
             const open = [...document.querySelectorAll('.topbar .btn')].find((b) => b.textContent.trim() === '设置');
             if (open) { open.click(); await sleep(300); }
           }
           const range = document.querySelector('.gen-range');
           if (!range) return { error: '找不到行距滑杆' };
           const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
           setter.call(range, range.min);
           range.dispatchEvent(new Event('input', { bubbles: true }));
           await sleep(800);
           const close = document.querySelector('.raw-modal-close');
           if (close) { close.click(); await sleep(400); }
           return { min: range.min, value: range.value };
         })()`,
      )
      console.log(`\n=== 行距调到最紧（${JSON.stringify(tight)}） ===`)
      report('行距最紧', await cdp.evaluate(MEASURE))
    }

    /*
     * 关掉「显示填补的正确写法」：方框整层卸载，写在被改内容上的空档、以及插入空位
     * 那行写上去的宽度，都必须跟着还原——否则译文会带着一堆莫名其妙的空档与空位留在那里。
     */
    const cleared = await cdp.evaluate(
      `(async () => {
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const open = [...document.querySelectorAll('.topbar .btn')].find((b) => b.textContent.trim() === '设置');
         if (!open) return { error: '找不到设置按钮' };
         open.click();
         await sleep(300);
         const checkbox = document.querySelector('.gen-check input');
         if (!checkbox) return { error: '设置里找不到填补开关' };
         checkbox.click();
         await sleep(500);
         const anchors = [...document.querySelectorAll('.pane-answer [data-fix-key]')];
         return {
           boxesLeft: document.querySelectorAll('.pane-answer .fix-text').length,
           padding: anchors.map((a) => (a.style.paddingLeft || '—') + '|' + (a.style.paddingRight || '—')),
           slots: [...document.querySelectorAll('.pane-answer .mk-slot')].map((s) => s.style.width || '—'),
         };
       })()`,
    )
    console.log('\n=== 关掉「填补文字」之后 ===')
    console.log('  ' + JSON.stringify(cleared))

    cdp.close()
  } finally {
    if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    if (server?.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

/*
 * 收尾：设置退出码。
 *
 * 这是让这个探针**真正能用**的关键一步。没有它时，无论量出什么问题，
 * 退出码都是 0，" ✗ " 只是一行输出——它就不能进 CI，也不能当验收依据。
 * 现在：量不到数据、或方框越出带子/明显不居中，都会让退出码变成 1。
 */
function summarizeAndExit() {
  console.log(`\n${'─'.repeat(64)}`)
  if (failures.length === 0) {
    console.log('✓ 未发现对齐问题')
    process.exitCode = 0
    return
  }
  console.log(`✗ 发现 ${failures.length} 项问题：`)
  for (const failure of failures) console.log(`    - ${failure}`)
  console.log(`  （容差：越出带子 > ${-TOLERANCE.inset}px、居中误差 > ${TOLERANCE.center}px 即算问题）`)
  process.exitCode = 1
}

try {
  await main()
} catch (error) {
  // 原先这里没有 catch：随手抛一个错只会让退出码是 1、却什么都不打印
  console.error(`\n✗ 探针未能跑完：${error instanceof Error ? error.message : String(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exitCode = 1
} finally {
  summarizeAndExit()
}
