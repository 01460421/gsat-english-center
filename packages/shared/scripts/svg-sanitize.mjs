// @ts-check
/**
 * 作文看圖題的 SVG 清理（docs/design/bank-writing.md §4.6）。零依賴的 Node ESM：網站建置（apps/web/scripts/lib/writing-bank.mjs）
 * 與資料測試都用它。
 *
 * 題庫的 SVG 是出題代理寫的資料。tools/validate_bank.py 的 svg_problems 是黑名單，已確認擋不住
 * `<g/onclick=…>`、`<animate attributeName="href" to="&#106;avascript:…">`、`<set attributeName="onmouseover">`、
 * 沒加引號的外部 href 等寫法，所以這裡改用白名單：
 *   1. 自己寫的小 tokenizer 把字串解析成「開始標籤、結束標籤、文字」；
 *   2. 每個元素、屬性與值都要通過白名單（數值一律照同一套數字文法）；
 *   3. 全部通過後**用解析結果重新組字串**：屬性值與文字重新跳脫，原字串不會原樣流出去。
 * 任何一項不符，整張 SVG 就不發布（回傳 svg: null 與原因），那張圖只保留文字描述。
 * 清理是冪等的：sanitizeSvg(輸出).svg === 輸出。
 *
 * 前端一律用 <img src="data:image/svg+xml;charset=utf-8,…"> 顯示（以 <img> 載入的 SVG 不執行腳本、不載入外部資源），
 * 這裡是第二道防線，不是唯一的防線。
 */

/** README §3.6：SVG 最長 30,000 字元。 */
export const SVG_MAX_CHARS = 30_000;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 數字文法（所有數值屬性共用）：允許負號、小數與指數，例如 10、-3、100.9、.5、1e-3。 */
export const NUMBER_SOURCE = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const NUMBER = new RegExp(`^${NUMBER_SOURCE}$`);
const LIST_ITEM = new RegExp(`^\\s*(${NUMBER_SOURCE})((?:\\s*,\\s*|\\s+)${NUMBER_SOURCE})*\\s*$`);
const FONT_SIZE = new RegExp(`^${NUMBER_SOURCE}(?:px)?$`);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** 一小份 CSS 色名（現有的圖都用 # 色碼；留幾個常見的，避免代理寫 white 就整張被拒）。 */
const NAMED_COLORS = new Set([
  'none', 'black', 'white', 'gray', 'grey', 'silver', 'red', 'maroon', 'orange', 'yellow', 'gold', 'green', 'lime', 'olive',
  'teal', 'navy', 'blue', 'aqua', 'cyan', 'purple', 'fuchsia', 'magenta', 'pink', 'brown', 'beige', 'transparent',
]);

/** @param {string} v */
function isNumber(v) {
  return NUMBER.test(v);
}

/** @param {string} v */
function isList(v) {
  return LIST_ITEM.test(v);
}

/** @param {string} v */
function listLength(v) {
  return v.trim().split(/\s*,\s*|\s+/).filter((x) => x !== '').length;
}

/** @param {string} v */
function isColor(v) {
  return HEX_COLOR.test(v) || NAMED_COLORS.has(v);
}

/** @param {string} v */
function isOpacity(v) {
  return isNumber(v) && Number(v) >= 0 && Number(v) <= 1;
}

/** 路徑資料：只能由路徑指令字母、NUMBER、逗號與空白組成。 @param {string} v */
function isPathData(v) {
  const token = new RegExp(`\\s+|,|[MmLlHhVvCcSsQqTtAaZz]|${NUMBER_SOURCE}`, 'y');
  let i = 0;
  while (i < v.length) {
    token.lastIndex = i;
    const m = token.exec(v);
    if (!m || m[0] === '') return false;
    i = token.lastIndex;
  }
  return /[Mm]/.test(v);
}

/** 純文字（aria-label）：不能有控制字元。 @param {string} v */
function isPlainText(v) {
  return v.length <= 300 && !/[\u0000-\u001F\u007F]/.test(v);
}

/** @type {Record<string, (v: string) => boolean>} */
const ATTRIBUTE_RULES = {
  xmlns: (v) => v === SVG_NS,
  viewBox: (v) => isList(v) && listLength(v) === 4,
  role: (v) => v === 'img',
  'aria-label': isPlainText,
  x: isNumber,
  y: isNumber,
  width: isNumber,
  height: isNumber,
  cx: isNumber,
  cy: isNumber,
  r: isNumber,
  rx: isNumber,
  ry: isNumber,
  x1: isNumber,
  y1: isNumber,
  x2: isNumber,
  y2: isNumber,
  'stroke-width': isNumber,
  'font-size': (v) => FONT_SIZE.test(v),
  opacity: isOpacity,
  'fill-opacity': isOpacity,
  'stroke-opacity': isOpacity,
  fill: isColor,
  stroke: isColor,
  'stroke-linecap': (v) => v === 'butt' || v === 'round' || v === 'square',
  'stroke-linejoin': (v) => v === 'miter' || v === 'round' || v === 'bevel',
  'text-anchor': (v) => v === 'start' || v === 'middle' || v === 'end',
  'font-weight': (v) => v === 'normal' || v === 'bold' || /^[1-9]00$/.test(v),
  'stroke-dasharray': isList,
  points: isList,
  d: isPathData,
};

/** 允許的元素。svg 只能是根、只能一個。 */
const ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan']);
/** 可以放文字的元素（其他元素裡只能有空白）。 */
const TEXT_ELEMENTS = new Set(['text', 'tspan']);
const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" });

class SvgProblem extends Error {}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function need(condition, message) {
  if (!condition) throw new SvgProblem(message);
}

/** 解碼允許的五種實體；其他 &…（含數字實體）一律拒絕。 @param {string} raw @param {string} where */
function decodeEntities(raw, where) {
  return raw.replace(/&([^;\s&]*);?/g, (all, name) => {
    need(all.endsWith(';') && Object.hasOwn(ENTITIES, name), `${where}：不允許的實體 ${all.slice(0, 12)}`);
    return /** @type {string} */ (ENTITIES[name]);
  });
}

/** @param {string} s */
function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * @typedef {{ kind: 'open', name: string, attrs: [string, string][], selfClosing: boolean }
 *   | { kind: 'close', name: string }
 *   | { kind: 'text', text: string }} SvgToken
 */

/** @param {string} src @returns {SvgToken[]} */
function tokenize(src) {
  /** @type {SvgToken[]} */
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      tokens.push({ kind: 'text', text: decodeEntities(src.slice(i), '文字') });
      break;
    }
    if (lt > i) tokens.push({ kind: 'text', text: decodeEntities(src.slice(i, lt), '文字') });
    const rest = src.slice(lt);
    need(!rest.startsWith('<!') && !rest.startsWith('<?'), '不允許註解、CDATA、DOCTYPE 或處理指令');
    const close = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(rest);
    if (close) {
      tokens.push({ kind: 'close', name: /** @type {string} */ (close[1]) });
      i = lt + close[0].length;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(rest);
    need(open, `第 ${lt} 個字元的 < 不是合法的標籤`);
    const name = /** @type {string} */ (open[1]);
    let j = lt + open[0].length;
    /** @type {[string, string][]} */
    const attrs = [];
    let selfClosing = false;
    for (;;) {
      const ws = /^\s*/.exec(src.slice(j));
      const hadSpace = ws !== null && ws[0].length > 0;
      j += ws ? ws[0].length : 0;
      if (src.startsWith('/>', j)) {
        selfClosing = true;
        j += 2;
        break;
      }
      if (src.startsWith('>', j)) {
        j += 1;
        break;
      }
      // 屬性前面一定要有空白（擋下 <g/onclick=…> 這類以斜線分隔的寫法）。
      need(hadSpace, `<${name}> 的屬性前面要有空白`);
      const attr = /^([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(j));
      need(attr, `<${name}> 的屬性格式不對（屬性值一定要加引號）`);
      const attrName = /** @type {string} */ (attr[1]);
      const rawValue = attr[3] ?? attr[4] ?? '';
      need(!rawValue.includes('<'), `<${name}> 的 ${attrName} 含有 <`);
      need(!attrs.some(([n]) => n === attrName), `<${name}> 的屬性 ${attrName} 重複`);
      attrs.push([attrName, decodeEntities(rawValue, `<${name}> 的 ${attrName}`)]);
      j += attr[0].length;
    }
    tokens.push({ kind: 'open', name, attrs, selfClosing });
    i = j;
  }
  return tokens;
}

/**
 * 依白名單清理 SVG，回傳重新序列化的字串；不合格時 svg 是 null，problem 寫原因。
 * @param {unknown} input
 * @returns {{ svg: string, problem?: undefined } | { svg: null, problem: string }}
 */
export function sanitizeSvg(input) {
  try {
    need(typeof input === 'string', 'svg 不是字串');
    need(input.length <= SVG_MAX_CHARS, `svg 超過 ${SVG_MAX_CHARS} 字元`);
    const src = input.trim();
    need(src.startsWith('<svg'), 'svg 必須以 <svg 開頭');
    const tokens = tokenize(src);
    /** @type {string[]} */
    const stack = [];
    /** @type {string[]} */
    const out = [];
    let roots = 0;
    for (const t of tokens) {
      if (t.kind === 'text') {
        if (t.text.trim() !== '') {
          const parent = stack.at(-1);
          need(parent !== undefined && TEXT_ELEMENTS.has(parent), '文字只能放在 <text> 或 <tspan> 裡');
        } else {
          need(stack.length > 0, '<svg> 外面不能有內容');
        }
        out.push(escapeText(t.text));
        continue;
      }
      need(ELEMENTS.has(t.name), `不允許的元素 <${t.name}>`);
      if (t.kind === 'close') {
        need(stack.pop() === t.name, `</${t.name}> 沒有對應的開始標籤`);
        out.push(`</${t.name}>`);
        continue;
      }
      if (t.name === 'svg') {
        need(stack.length === 0 && roots === 0, '<svg> 只能是根元素，而且只能有一個');
        roots += 1;
        const names = t.attrs.map(([n]) => n);
        need(names.includes('xmlns') && names.includes('viewBox'), '<svg> 要有 xmlns 與 viewBox');
      } else {
        need(stack.length > 0, `<${t.name}> 必須在 <svg> 裡`);
        need(!t.attrs.some(([n]) => n === 'xmlns' || n === 'viewBox'), `<${t.name}> 不能有 xmlns 或 viewBox`);
      }
      const attrs = t.attrs.map(([n, v]) => {
        const rule = Object.hasOwn(ATTRIBUTE_RULES, n) ? ATTRIBUTE_RULES[n] : undefined;
        need(rule !== undefined, `<${t.name}> 不允許屬性 ${n}`);
        need(rule(v), `<${t.name}> 的 ${n}="${v.slice(0, 30)}" 不合格`);
        return ` ${n}="${escapeAttr(v)}"`;
      });
      out.push(`<${t.name}${attrs.join('')}${t.selfClosing ? '/>' : '>'}`);
      if (!t.selfClosing) stack.push(t.name);
      else need(stack.length > 0, '根元素 <svg> 不能是空的自閉合標籤');
    }
    need(stack.length === 0, `<${stack.at(-1)}> 沒有結束標籤`);
    need(roots === 1, '找不到 <svg> 根元素');
    return { svg: out.join('') };
  } catch (err) {
    if (err instanceof SvgProblem) return { svg: null, problem: err.message };
    throw err;
  }
}

/** 字串是不是已經清理過的格式（再清理一次結果完全相同）。 @param {unknown} svg */
export function isSanitizedSvg(svg) {
  return typeof svg === 'string' && sanitizeSvg(svg).svg === svg;
}
