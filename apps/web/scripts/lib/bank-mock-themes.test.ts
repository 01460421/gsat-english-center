// @vitest-environment node
/**
 * scripts/lib/bank-mock-themes.mjs：自組模擬考的主題鍵（docs/design/bank-mock.md §4.3）。
 * 主題字串直接寫在測試裡（取自設計文件實測到的撞題），不讀 data/bank/v1；真實題庫的比對在 bank-mock-pool.data.test.ts。
 */
import { describe, expect, it } from 'vitest';
import {
  CONCEPT_ALIASES,
  SINGLE_CHAR_WHITELIST,
  STOP_WORDS,
  chineseTopicCore,
  compileAliases,
  conceptIds,
  englishContentWords,
  themeKeys,
  topicPlanIndex,
} from './bank-mock-themes.mjs';

const keys = (section: string, topic: string | null, extra: { keywords?: string[]; angle?: string } = {}) =>
  themeKeys({ section, topic, ...extra });
const shared = (a: string[], b: string[]) => a.filter((k) => b.includes(k));

describe('themeKeys', () => {
  it('「動物怎麼睡覺」和 "teenage body clock and sleep" 有共同的 c:sleep（設計文件第 1 版漏抓的撞題）', () => {
    const a = keys('mixed', '動物怎麼睡覺');
    const b = keys('cloze', 'why teenagers stay up late: the teenage body clock and sleep');
    const c = keys('structure', 'why sleep matters for teenage learners');
    expect(a).toContain('c:sleep');
    expect(shared(a, b)).toEqual(['c:sleep']);
    expect(shared(b, c)).toContain('c:sleep');
  });

  it('§4.3 實測到的撞題都有共同的鍵（中英文混寫靠概念別名表）', () => {
    const pairs: [string, string, string, string][] = [
      ['word_bank', 'the evolution of the bicycle', 'reading', '自行車的演進'],
      ['structure', 'the evolution of the bicycle', 'reading', '自行車的演進'],
      ['cloze', 'the history of the pencil (why pencil “lead” contains no lead)', 'word_bank', 'the history of the pencil and why it is called lead'],
      ['word_bank', 'the Silk Road: trade routes linking China and Europe', 'structure', 'the Silk Road: trade and the spread of ideas'],
      ['word_bank', 'reducing food waste at home', 'structure', 'food waste and how to reduce it'],
      ['structure', 'light pollution and its effects on wildlife and human sleep', 'cloze', 'why short naps help and long naps leave you groggy (sleep inertia)'],
      ['cloze', 'light pollution and its effects on people and wildlife', 'word_bank', 'light pollution and its effects on wildlife, sleep, and the night sky'],
      ['mixed', '學校午休該不該保留', 'cloze', 'why short naps help and long naps leave you groggy (sleep inertia)'],
    ];
    for (const [s1, t1, s2, t2] of pairs) expect(shared(keys(s1, t1), keys(s2, t2)), `${t1} ／ ${t2}`).not.toEqual([]);
  });

  it('不相干的主題沒有共同的鍵（顏色、地名、泛用詞不算實詞）', () => {
    const pairs: [string, string][] = [
      ['how blue jeans went from work pants to fashion', 'why the sky is blue and sunsets are red'],
      ['the myth that the Great Wall of China can be seen from space', 'how paper money began in China'],
      ['the history of the pencil and why it is called lead', 'the ancient Olympic Games in Greece'],
    ];
    for (const [a, b] of pairs) expect(shared(keys('cloze', a), keys('structure', b)), `${a} ／ ${b}`).toEqual([]);
    expect(shared(keys('reading', '修理咖啡館'), keys('reading', '公平貿易咖啡'))).toEqual([]);
  });

  it('詞彙題（情境組）與沒有主題的題組不產生主題鍵', () => {
    expect(keys('vocabulary', '情境組：捷運通勤、公寓修繕、遺失錢包、才藝表演、看牙醫')).toEqual([]);
    expect(keys('reading', null)).toEqual([]);
    expect(keys('reading', '  ')).toEqual([]);
  });

  it('中文主題：z:<去掉套語的主題>；英文主題：w:<實詞>；結果排序、不重複', () => {
    expect(keys('reading', '迴轉壽司的發明')).toEqual(['z:迴轉壽司']);
    expect(keys('structure', 'the evolution of the bicycle')).toEqual(['c:bicycle', 'w:bicycle']);
    expect(keys('cloze', 'the history of the pencil (why pencil “lead” contains no lead)')).toEqual(['c:pencil', 'w:contain', 'w:lead', 'w:pencil']);
  });

  it('對得上 topic-plan 的題組：keywords 與 angle_en 也拿來比對概念別名（只產生 c: 鍵）', () => {
    expect(keys('mixed', '某個主題')).toEqual(['z:某個主題']);
    expect(keys('mixed', '某個主題', { keywords: ['bike lane'] })).toEqual(['c:bicycle', 'z:某個主題']);
    expect(keys('mixed', '某個主題', { angle: 'why short naps help students' })).toEqual(['c:sleep', 'z:某個主題']);
  });
});

describe('概念別名表', () => {
  it('英文寫法依字詞邊界比對，可以多一個字尾 s／es', () => {
    expect(conceptIds(['bikes in the city'])).toEqual(['bicycle']);
    expect(conceptIds(['a bikeway map'])).toEqual([]);
    expect(conceptIds(['a snap decision on a napkin'])).toEqual([]);
    expect(conceptIds(['why we take NAPS'])).toEqual(['sleep']);
  });

  it('單一個中文字只在白名單內生效', () => {
    // 目前白名單只有「睡」：其他單字寫法就算放進表裡也不比對。
    expect([...SINGLE_CHAR_WHITELIST]).toEqual(['睡']);
    const table = { light: ['光'], sleep: ['睡'] };
    expect(conceptIds(['光害與早睡'], compileAliases(table))).toEqual(['sleep']);
    expect(conceptIds(['光害與早睡'], compileAliases(table, new Set(['睡', '光'])))).toEqual(['light', 'sleep']);
    expect(conceptIds(['不夜城與早睡小鎮'])).toEqual(['sleep']);
  });

  it('表裡所有單一中文字的寫法都在白名單裡；寫法沒有重複；英文寫法都是小寫', () => {
    const seen = new Set<string>();
    for (const [id, spellings] of Object.entries(CONCEPT_ALIASES)) {
      for (const s of spellings) {
        if (/^[㐀-鿿]$/.test(s)) expect(SINGLE_CHAR_WHITELIST.has(s), `${id}：${s}`).toBe(true);
        if (!/[㐀-鿿]/.test(s)) expect(s, `${id}：${s}`).toBe(s.toLowerCase());
        expect(seen.has(s), `${id}：${s} 重複`).toBe(false);
        seen.add(s);
      }
    }
  });
});

describe('英文實詞與中文主題的套語', () => {
  it('去掉停用詞與泛用詞、長度 < 4 的字，字尾 s／es 去掉', () => {
    expect(englishContentWords('why the sky is blue and sunsets are red')).toEqual(['sunset']);
    // 去掉字尾之後不到 4 個字母的也不留（boxes → box）。
    expect(englishContentWords('the evolution of eyeglasses, from Italian spectacles to modern frames and boxes')).toEqual(['eyeglass', 'spectacle', 'frame']);
    expect(englishContentWords('stories of butterflies and glasses')).toEqual(['butterfly', 'glass']);
    expect(englishContentWords('how chess changed from its Indian origins to the age of computers')).toEqual(['chess', 'computer']);
    expect(englishContentWords('the hidden costs of fast fashion')).toEqual(['cost', 'fast', 'fashion']);
    for (const w of ['history', 'people', 'world', 'school', 'student', 'life']) expect(STOP_WORDS.has(w)).toBe(true);
  });

  it('中文主題去掉「的由來」「的演進」、開頭的「為什麼」之類的套語', () => {
    expect(chineseTopicCore('自行車的演進')).toBe('自行車');
    expect(chineseTopicCore('QR 碼的由來')).toBe('QR碼');
    expect(chineseTopicCore('為什麼有人是左撇子')).toBe('有人是左撇子');
    expect(chineseTopicCore('如何保存食物的歷史')).toBe('保存食物');
    expect(chineseTopicCore('「OK」的由來')).toBe('OK');
    expect(chineseTopicCore('的由來')).toBe('的由來');
  });

  it('句子中間的「為什麼」「怎麼」「該不該」不切：z: 鍵只抓一模一樣的主題', () => {
    expect(chineseTopicCore('貓頭鷹的頭為什麼能轉這麼多')).toBe('貓頭鷹的頭為什麼能轉這麼多');
    expect(chineseTopicCore('學校午休該不該保留')).toBe('學校午休該不該保留');
    // 「動物怎麼睡覺」和「動物怎麼溝通」不是同一個主題，不能都變成 z:動物。
    expect(keys('mixed', '動物怎麼睡覺')).toEqual(['c:sleep', 'z:動物怎麼睡覺']);
    expect(keys('reading', '動物怎麼溝通')).toEqual(['z:動物怎麼溝通']);
  });
});

describe('topicPlanIndex', () => {
  it('topic_zh → keywords 與 angle_en；格式不對的項目略過，先出現的優先', () => {
    const idx = topicPlanIndex([
      { topics: [{ topic_zh: '甲', keywords: ['a', 1], angle_en: 'alpha' }, { topic_zh: '甲', keywords: ['dup'] }, { keywords: ['x'] }, 'bad'] },
      { reserve_topics: [{ topic_zh: '乙' }] },
      null,
    ]);
    expect(idx.get('甲')).toEqual({ keywords: ['a'], angle: 'alpha' });
    expect(idx.get('乙')).toEqual({ keywords: [], angle: null });
    expect(idx.size).toBe(2);
  });
});
