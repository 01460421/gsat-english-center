// @ts-check
/**
 * 本站自組模擬考的主題鍵（docs/design/bank-mock.md §4.3）：組卷時「不同大題的主題不撞」靠這裡算出的鍵，
 * 兩個題組的鍵有交集就算撞題。結果寫進 bank/mock-pool.json 每個條目的 theme，前端只比對字串，不再分析主題。
 *
 * 題庫的主題是題組的 group.tags.topic：前幾批寫成英文（"the evolution of the bicycle"），之後寫成中文（「自行車的演進」），
 * 只有部分題組對得上 data/bank/topic-plan.json（topic_zh 相同的那一筆有英文的 keywords 與 angle_en）。主題鍵有三種：
 *   c:<id>  概念別名表 CONCEPT_ALIASES：主題（加上對得上 topic-plan 的 keywords、angle_en）含有其中任一寫法就加上。
 *           英文寫法依字詞邊界比對（可以多一個字尾 s／es）；中文寫法是子字串。單一個中文字容易誤判，只有 SINGLE_CHAR_WHITELIST
 *           裡的字才生效（資料測試列出它在目前題庫實際比對到的主題，確認都是同一個概念）。中英文混寫的撞題只有這種鍵抓得到。
 *   w:<字>  英文主題的實詞：轉小寫、只留字母，去掉 STOP_WORDS（停用詞與 history、why、people 這類泛用詞），
 *           只留長度 ≥ 4 的字並去掉字尾 s／es。
 *   z:<字串> 中文主題去掉「的由來」「的演進」、開頭的「為什麼」之類的套語後整串當成一個鍵，只抓一模一樣的主題
 *           （句子中間的「為什麼」「怎麼」不切：「動物怎麼睡覺」和「動物怎麼溝通」不是同一個主題）。
 * 詞彙題的主題是「情境組：…」（一次列五到十個情境），不產生主題鍵。
 *
 * 這是盡力而為的做法：誤判（把不相干的兩組當成撞題）只會讓組卷少一個候選，不會讓組卷失敗（§4.2 第 6 步）。
 * 建置 log 列出「沒有任何 c: 鍵的主題」，給維護別名表的人逐條看；題庫新增主題時再補這張表。
 */
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊（別名表改了，組卷池就會變）。 */
export const BANK_MOCK_THEMES_SCRIPT = fileURLToPath(import.meta.url);

/**
 * 概念別名表：概念 id → 中英文寫法。第一版收設計文件 §4.3 實測到的撞題（自行車、鉛筆、絲路、剩食、睡眠、光害）、
 * topic-plan.json 的 used_concepts，以及題庫裡同一難度跨大題常見的主題。新增寫法時避開太泛的字（time、water、festival），
 * 一個寫法同時對到很多不相干的主題，閱讀（組卷的瓶頸）就少了很多可以搭配的組合。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CONCEPT_ALIASES = Object.freeze({
  bicycle: ['bicycle', 'bike', 'cycling', '自行車', '腳踏車', '單車'],
  sleep: ['sleep', 'nap', 'body clock', 'siesta', '睡眠', '午睡', '午休', '熬夜', '睡覺', '入睡', '睡'],
  yawn: ['yawn', 'yawning', '打哈欠', '哈欠'],
  'food-waste': ['food waste', 'ugly fruit', 'ugly vegetable', '剩食', '食物浪費', '惜食', '醜蔬果', '格外品'],
  'light-pollution': ['light pollution', '光害', '光污染', '光汙染'],
  pencil: ['pencil', 'quill', 'ballpoint', 'fountain pen', '鉛筆', '原子筆', '鋼筆', '羽毛筆'],
  'silk-road': ['silk road', '絲路', '絲綢之路'],
  plastic: ['plastic', 'microplastic', 'drinking straw', 'plastic straw', 'shopping bag', '塑膠', '塑料', '吸管', '購物袋'],
  coral: ['coral', '珊瑚'],
  carbon: ['carbon', '碳足跡', '碳稅', '碳捕捉', '碳排', '減碳', '二氧化碳'],
  energy: ['solar power', 'solar energy', 'solar panel', 'solar cell', 'wind power', 'wind farm', 'offshore wind', 'power grid', '太陽能', '電力', '發電', '風電', '用電', '再生能源'],
  'repair-cafe': ['repair cafe', 'repair café', 'swap shop', '修理咖啡館', '交換商店'],
  terracotta: ['terracotta', '兵馬俑'],
  placebo: ['placebo', 'nocebo', '安慰劑'],
  eyesight: ['eyeglasses', 'spectacles', 'myopia', 'nearsighted', 'eyesight', '眼鏡', '近視', '視力'],
  money: ['paper money', 'barter', 'banknote', 'currency', '紙鈔', '紙幣', '貨幣', '以物易物'],
  timekeeping: ['sundial', 'atomic clock', 'standard time', 'time zone', '日晷', '原子鐘', '時區', '標準時間'],
  tea: ['tea', 'bubble tea', '茶葉', '奶茶', '飲茶'],
  chocolate: ['chocolate', 'cocoa', '巧克力', '可可'],
  potato: ['potato', '馬鈴薯', '洋芋'],
  olympic: ['olympic', 'olympics', '奧運', '奧林匹克'],
  marathon: ['marathon', '馬拉松'],
  ai: ['artificial intelligence', 'ai', 'chatbot', 'robot', '人工智慧', '聊天機器人', '機器人', '機器翻譯'],
  emoji: ['emoji', 'emoticon', '表情符號', '顏文字'],
  lantern: ['lantern festival', 'sky lantern', '元宵', '天燈', '燈籠'],
  smell: ['sense of smell', '嗅覺', '氣味'],
  'sky-color': ['blue sky', 'sunset', '天空為什麼是藍', '夕陽', '晚霞'],
  vaccine: ['vaccine', 'vaccination', 'measles', 'smallpox', '疫苗', '麻疹', '天花'],
  mosquito: ['mosquito', 'malaria', 'dengue', '蚊子', '瘧疾', '登革熱'],
  railway: ['railway', 'railroad', 'subway', 'metro', 'night train', 'high-speed rail', '地鐵', '捷運', '高鐵', '火車', '列車', '夜車', '鐵路'],
  'school-lunch': ['school lunch', 'lunch box', 'bento', '營養午餐', '午餐', '便當'],
  umbrella: ['umbrella', '雨傘', '共享雨傘'],
  phone: ['phubbing', 'smartphone', 'screen time', 'digital detox', '低頭族', '智慧型手機', '手機', '螢幕時間', '數位排毒'],
  'social-media': ['social media', 'influencer', 'short video', 'livestream', '社群媒體', '網美', '網紅', '短影音', '直播'],
  'online-shopping': ['online shopping', 'e-commerce', '網購', '網路購物', '團購'],
  'fast-fashion': ['fast fashion', 'secondhand clothes', '快時尚', '二手衣'],
  jeans: ['jeans', 'denim', '牛仔褲'],
  overtourism: ['overtourism', 'tourist tax', 'entry fee', '入城費', '過度觀光', '觀光客'],
  'e-waste': ['e-waste', 'electronic waste', '電子廢棄物', '電子垃圾'],
  trash: ['garbage', 'trash', 'recycling', '垃圾', '資源回收', '押金'],
  'hand-washing': ['semmelweis', 'handwashing', 'hand washing', 'wash hands', '洗手'],
  'great-wall': ['great wall', '長城'],
  hieroglyph: ['rosetta stone', 'hieroglyph', 'hieroglyphs', '羅塞塔', '象形文字'],
  ketchup: ['ketchup', '番茄醬'],
  goosebumps: ['goosebump', 'goose bump', '雞皮疙瘩'],
  kintsugi: ['kintsugi', '金繼'],
  onion: ['onion', '洋蔥'],
  'korean-alphabet': ['hangul', 'korean alphabet', '韓文', '世宗'],
  pisa: ['leaning tower', 'pisa', '比薩斜塔'],
  chess: ['chess', '西洋棋'],
  'ice-float': ['ice float', 'ice floats', '冰為什麼浮'],
  'ball-games': ['basketball', 'volleyball', 'naismith', '籃球', '排球'],
  'car-free': ['car-free', 'car free day', '無車日'],
  aqueduct: ['aqueduct', 'qanat', '古羅馬水道', '輸水道', '坎兒井'],
  furoshiki: ['furoshiki', 'wrapping cloth', '包袱巾'],
  heirloom: ['heirloom', 'old object', 'family object', '老物件'],
});

/** 可以當成概念寫法的單一個中文字（§4.3）。新增前先跑資料測試，看它在目前題庫實際比對到哪些主題。 */
export const SINGLE_CHAR_WHITELIST = Object.freeze(new Set(['睡']));

/**
 * 英文主題的停用詞與泛用詞：出現在很多不相干主題裡的字，當成實詞只會造成誤判。
 * 長度 < 4 的字本來就不留，這裡只列長度 ≥ 4 的（比對前已轉小寫；s／es 去掉之前與之後的寫法都要列，例如 matter、matters）。
 */
export const STOP_WORDS = Object.freeze(
  new Set([
    // 疑問詞、連接詞、介系詞、代名詞
    'about', 'above', 'across', 'after', 'again', 'against', 'along', 'also', 'among', 'around', 'because', 'before', 'behind',
    'below', 'between', 'both', 'during', 'each', 'even', 'every', 'from', 'here', 'into', 'just', 'like', 'many', 'more', 'most',
    'much', 'only', 'other', 'over', 'same', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they',
    'this', 'those', 'through', 'under', 'until', 'upon', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'within',
    'without', 'your', 'ours', 'onto', 'whose', 'since', 'ever', 'never', 'always', 'often', 'once',
    // 泛用詞（§4.3：history、why、how、life、people、world、school、student…）
    'history', 'histories', 'life', 'lives', 'people', 'world', 'worlds', 'school', 'schools', 'student', 'students', 'learner',
    'learners', 'teen', 'teens', 'teenage', 'teenager', 'teenagers', 'child', 'children', 'kids', 'human', 'humans', 'person',
    'family', 'families', 'everyday', 'daily', 'modern', 'ancient', 'today', 'first', 'great', 'small', 'little', 'long', 'short',
    'best', 'better', 'good', 'young', 'time', 'times', 'year', 'years', 'place', 'places', 'thing', 'things', 'part', 'parts',
    'kind', 'kinds', 'role', 'name', 'names', 'word', 'words', 'story', 'stories', 'idea', 'ideas', 'fact', 'facts', 'myth',
    'myths', 'science', 'scientific', 'effect', 'effects', 'matter', 'matters', 'reason', 'reasons', 'rest', 'popular', 'common',
    'important', 'hidden', 'real', 'really', 'whole', 'country', 'countries', 'city', 'cities', 'local', 'global', 'public',
    // 泛用動詞
    'make', 'makes', 'made', 'making', 'help', 'helps', 'helped', 'change', 'changes', 'changed', 'became', 'become', 'becomes',
    'began', 'begin', 'begins', 'came', 'come', 'comes', 'went', 'goes', 'grew', 'grow', 'grows', 'keep', 'kept', 'stay', 'stays',
    'leave', 'leaves', 'shape', 'shapes', 'link', 'linked', 'spread', 'spreads', 'evolve', 'evolved', 'evolution', 'develop',
    'developed', 'development', 'origin', 'origins', 'called', 'using', 'used', 'uses', 'reduce', 'reducing', 'should', 'would',
    'could', 'still', 'does', 'have', 'been', 'were', 'will', 'turn', 'turned', 'work', 'works', 'feel', 'feels', 'seen', 'tell',
    // 顏色與地名：「blue jeans」和「blue sky」、「Great Wall of China」和「paper money began in China」不是同一個主題
    'blue', 'green', 'black', 'white', 'yellow', 'purple', 'pink', 'golden', 'china', 'chinese', 'japan', 'japanese', 'korea',
    'korean', 'india', 'indian', 'europe', 'european', 'africa', 'african', 'america', 'american', 'taiwan', 'taiwanese', 'greece',
    'greek', 'egypt', 'egyptian', 'rome', 'roman', 'italy', 'italian', 'britain', 'british', 'england', 'english', 'france',
    'french', 'germany', 'german', 'asia', 'asian',
  ]),
);

/** 中文主題的套語（§4.3）：結尾的這些字樣去掉後再比對。 */
const ZH_SUFFIXES = ['的由來', '的演進', '的演變', '的發展', '的發明', '的誕生', '的起源', '的歷史', '的故事', '的命名', '簡史', '之謎'];
/**
 * 中文主題的套語：主題以這些字樣開頭時拿掉（「為什麼有人是左撇子」→「有人是左撇子」）。出現在句子中間時不切、整串保留：
 * 「動物怎麼睡覺」切成「動物」，就會和「動物怎麼溝通」這種不相干的主題撞在一起；z: 鍵只抓一模一樣的主題（§4.3）。
 */
const ZH_LEADING_MARKERS = ['為什麼', '為何', '是怎麼', '怎麼', '如何', '該不該'];

/** @param {string} s */
const hasCjk = (s) => /[㐀-鿿豈-﫿]/.test(s);
/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 預先編好的別名比對（英文用字詞邊界、可以多一個字尾 s／es；中文是子字串；單一個中文字只收白名單）。
 * @param {Readonly<Record<string, readonly string[]>>} aliases
 * @param {ReadonlySet<string>} whitelist
 * @returns {{ id: string, test: (text: string) => boolean, spelling: string }[]}
 */
export function compileAliases(aliases = CONCEPT_ALIASES, whitelist = SINGLE_CHAR_WHITELIST) {
  /** @type {{ id: string, test: (text: string) => boolean, spelling: string }[]} */
  const out = [];
  for (const [id, spellings] of Object.entries(aliases)) {
    for (const spelling of spellings) {
      if (hasCjk(spelling)) {
        if ([...spelling].length === 1 && !whitelist.has(spelling)) continue;
        out.push({ id, spelling, test: (text) => text.includes(spelling) });
      } else {
        const re = new RegExp(`(?<![a-z])${escapeRegExp(spelling.toLowerCase())}(?:s|es)?(?![a-z])`);
        out.push({ id, spelling, test: (text) => re.test(text.toLowerCase()) });
      }
    }
  }
  return out;
}

const COMPILED = compileAliases();

/**
 * 文字裡出現的概念 id（依 CONCEPT_ALIASES 的順序、不重複）。
 * @param {readonly string[]} texts
 * @param {ReturnType<typeof compileAliases>} [compiled]
 * @returns {string[]}
 */
export function conceptIds(texts, compiled = COMPILED) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const a of compiled) if (!ids.has(a.id) && texts.some((t) => a.test(t))) ids.add(a.id);
  return [...ids];
}

/**
 * 英文實詞：小寫、只留字母，去掉停用詞，長度 ≥ 4，再去掉字尾 s／es（-ies → -y；-ches／-shes／-sses／-xes／-zes 去掉 es；
 * 其他 -s 去掉 s，但 -ss、-us、-is 不動）。
 * @param {string} topic
 * @returns {string[]}
 */
export function englishContentWords(topic) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const word of topic.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word.length < 4 || STOP_WORDS.has(word)) continue;
    const stem = singular(word);
    if (stem.length < 4 || STOP_WORDS.has(stem)) continue;
    out.add(stem);
  }
  return [...out];
}

/** @param {string} word */
function singular(word) {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * 中文主題去掉套語（開頭的「為什麼」之類、結尾的「的由來」之類）後的主體（空白一律拿掉）；去掉後是空字串時回傳原本的主題。
 * @param {string} topic
 */
export function chineseTopicCore(topic) {
  let core = topic.replace(/\s+/g, '');
  for (const marker of ZH_LEADING_MARKERS) {
    if (core.startsWith(marker)) core = core.slice(marker.length);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ZH_SUFFIXES) {
      if (core.endsWith(suffix) && core.length > suffix.length) {
        core = core.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  core = core.replace(/[「」『』〈〉《》：:，,。.！!？?（）()]/g, '');
  return core || topic.replace(/\s+/g, '');
}

/**
 * 一個題組的主題鍵（排序、不重複）。
 * @param {{ section: string, topic: string | null, keywords?: readonly string[], angle?: string | null }} input
 *   keywords、angle：題組的主題對得上 topic-plan 時，那一筆的 keywords 與 angle_en（只用來比對概念別名）
 * @returns {string[]}
 */
export function themeKeys({ section, topic, keywords = [], angle = null }) {
  if (section === 'vocabulary' || topic === null || topic.trim() === '') return [];
  /** @type {Set<string>} */
  const keys = new Set();
  const texts = [topic, ...keywords, ...(angle ? [angle] : [])];
  for (const id of conceptIds(texts)) keys.add(`c:${id}`);
  if (hasCjk(topic)) keys.add(`z:${chineseTopicCore(topic)}`);
  else for (const w of englishContentWords(topic)) keys.add(`w:${w}`);
  return [...keys].sort();
}

/**
 * topic-plan（data/bank/topic-plan.json、topic-plan-writing.json）→ topic_zh 對到的 keywords 與 angle_en。
 * 只讀 topics 與 reserve_topics；格式不對的項目略過（主題鍵是盡力而為，不能因為規劃檔讓建置失敗）。
 * @param {readonly unknown[]} plans  已解析的規劃檔
 * @returns {Map<string, { keywords: string[], angle: string | null }>}
 */
export function topicPlanIndex(plans) {
  /** @type {Map<string, { keywords: string[], angle: string | null }>} */
  const out = new Map();
  for (const plan of plans) {
    if (typeof plan !== 'object' || plan === null) continue;
    const p = /** @type {Record<string, unknown>} */ (plan);
    for (const list of [p.topics, p.reserve_topics]) {
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        if (typeof t !== 'object' || t === null) continue;
        const e = /** @type {Record<string, unknown>} */ (t);
        if (typeof e.topic_zh !== 'string' || out.has(e.topic_zh)) continue;
        out.set(e.topic_zh, {
          keywords: Array.isArray(e.keywords) ? e.keywords.filter((k) => typeof k === 'string') : [],
          angle: typeof e.angle_en === 'string' ? e.angle_en : null,
        });
      }
    }
  }
  return out;
}
