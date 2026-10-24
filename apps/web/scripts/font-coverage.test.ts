// @vitest-environment node
/**
 * scripts/font-coverage.mjs 的 bankPrintableCoverage()：題庫會印進自組模擬考 PDF 的字串，題本、解析、資料來源的缺字分開找
 * （docs/design/bank-mock.md §7.6），以及自組卷的粗體字串（SITE_PAPER_BOLD）、替代字表。字型用 src/features/pdf/fonts 的子集；缺字用擴充 B 區的字（子集不會收），
 * 有字形的用常用字，子集重新產生也不影響測試。
 * 單字講義（docs/design/vocab-handout.md §7.2）：vocabPrintableStrings() 的分類、條目缺字是錯誤、例句缺字只警告、VOCAB_PDF_BOLD 的讀法。
 */
import { describe, expect, it } from 'vitest';
import {
  bankPrintableCoverage,
  checkFontCoverage,
  glyphSubstituteCodePoints,
  practicePrintableStrings,
  sitePaperBoldText,
  vocabPdfBoldText,
  vocabPrintableCoverage,
  vocabPrintableStrings,
  writingPrintableStrings,
} from './font-coverage.mjs';

/** 子集一定沒有的字（CJK 擴充 B 區）。 */
const RARE = ['𠀀', '𠀁', '𠀂', '𠀃'] as const;

function practiceGroup(): Record<string, any> {
  return {
    uid: 'ai.rd.000001',
    version: 1,
    group: {
      passage: '文章的內容。',
      passage_parts: null,
      options_bank: null,
      figures: [
        {
          kind: 'chart',
          label: 'Chart 1',
          caption: '圖說',
          description: `圖表的文字描述不印${RARE[3]}`,
          rows: null,
          chart: {
            type: 'line',
            title: '標題',
            x: { label: '年', unit: null },
            y: { label: '人數', unit: '人' },
            categories: ['2020'],
            series: [{ name: '全國', values: [1] }],
            note: `附註${RARE[0]}`,
            source: { publisher: '出版者', title: `資料集${RARE[2]}`, url: 'https://example.org', license: 'CC-BY-4.0', accessed: '2026-10-01' },
          },
        },
      ],
      questions: [
        { no: 1, label: '1', mode: 'single_choice', stem: '題幹？', options: { A: '甲', B: '乙', C: '丙', D: '丁' }, answer: 'A' },
        { no: 2, label: '2', mode: 'fill_in_blank', stem: '填空', answer: 'turns', accepted_answers: ['turns', 'makes'] },
      ],
    },
    annotations: {
      explanations: { items: { '1': { explanation_zh: `解析${RARE[1]}`, option_notes_zh: { B: `選項說明不印${RARE[3]}` } }, '2': { explanation_zh: '解析', partial_credit_forms: ['turned'] } } },
      translation_zh: { text: `全文中譯不印${RARE[3]}` },
    },
    provenance: { attribution_text: null, references: [{ publisher: '出版者', title: '標題', url: 'https://example.org' }] },
  };
}

describe('會印進 PDF 的字串分類', () => {
  it('題庫練習：題本有文章、題幹、選項、圖表的資料表與附註；不印圖表描述、選項說明與全文中譯', () => {
    const s = practicePrintableStrings(practiceGroup());
    expect(s.booklet).toEqual(expect.arrayContaining(['文章的內容。', 'Chart 1', '圖說', '標題', '年', '人數', '人', '2020', '全國', `附註${RARE[0]}`, '題幹？', '甲', '填空']));
    // 混合題填充、簡答的答案、可接受答案與部分給分的寫法在答案頁，所以和解析算同一類。
    expect(s.explanations).toEqual(['turns', 'turns', 'makes', `解析${RARE[1]}`, '解析', 'turned']);
    expect(s.sources).toEqual(['出版者', '標題', '出版者', `資料集${RARE[2]}`, 'CC-BY-4.0']);
    const all = [...s.booklet, ...s.explanations, ...s.sources].join('');
    expect(all).not.toContain(RARE[3]);
  });

  it('寫作題庫：中譯英題目、作文題目與圖的描述在題本；參考譯文、評分重點、範文在解析', () => {
    const tr = writingPrintableStrings(
      { section_type: 'translation', items: [{ stem: '中文題目一' }, { stem: '中文題目二' }] },
      { items: [{ references: ['Ref one.', 'Ref two.'], explanation_zh: '說明' }] },
    );
    expect(tr).toEqual({ booklet: ['中文題目一', '中文題目二'], explanations: ['Ref one.', 'Ref two.', '說明'], sources: [] });
    const cp = writingPrintableStrings(
      { section_type: 'composition', stem: '提示：', figures: [{ label: '圖一', caption: null, description: '圖的描述', rows: null, svg: '<svg/>' }], moves: [{ zh: '第一段' }] },
      { criteria: { content: { focus_zh: '內容', bands: [{ descriptor_zh: '切題' }] } }, deductions_zh: ['扣分'], model_texts: [{ text: 'Model.' }], explanation: { explanation_zh: '解析' } },
    );
    expect(cp.booklet).toEqual(['提示：', '圖一', '圖的描述']);
    expect(cp.explanations).toEqual(['第一段', '內容', '切題', '扣分', 'Model.', '解析']);
  });
});

describe('bankPrintableCoverage', () => {
  it('逐組列出缺的字，題本、解析、資料來源分開；沒有缺字的題組不列', () => {
    const ok = practiceGroup();
    ok['uid'] = 'ai.rd.000002';
    ok['group'].figures[0].chart.note = '附註';
    ok['annotations'].explanations.items['1'].explanation_zh = '解析';
    ok['group'].figures[0].chart.source.title = '資料集';
    const result = bankPrintableCoverage({
      practice: [practiceGroup() as never, ok as never],
      writing: [
        {
          prompt: { uid: 'ai.tr.000001', version: 2, section_type: 'translation', items: [{ stem: `題目${RARE[0]}${RARE[0]}` }] } as never,
          answers: { items: [{ references: ['Fine.'] }] },
        },
      ],
    });
    expect([...result.missing.keys()]).toEqual(['ai.rd.000001@1', 'ai.tr.000001@2']);
    expect(result.missing.get('ai.rd.000001@1')).toEqual({ booklet: [RARE[0]], explanations: [RARE[1]], sources: [RARE[2]] });
    expect(result.missing.get('ai.tr.000001@2')).toEqual({ booklet: [RARE[0]], explanations: [], sources: [] });
    expect(result.stats).toEqual({ groups: 3, booklet: 1, explanations: 1, sources: 1 });
  });
});

describe('出版社題組的出處（docs/design/weak-paper.md §8.7）', () => {
  it('出處（出版社、書名、出處句、原卷位置）算進題本：缺字的題組在題本那一欄（組卷池排除 ex: glyph），不是只警告的資料來源', () => {
    const g = practiceGroup();
    g['uid'] = 'pb.rd.000004';
    g['source'] = { id: 'pub-x', label_zh: `測試${RARE[3] ?? RARE[0]}出版`, product_zh: '模擬試題', attribution_zh: '本題出自測試出版《模擬試題》，經授權使用', ref_text: '原卷第 41–44 題' };
    const strings = practicePrintableStrings(g);
    expect(strings.booklet).toContain(`測試${RARE[3] ?? RARE[0]}出版`);
    expect(strings.sources).not.toContain(`測試${RARE[3] ?? RARE[0]}出版`);
    const result = bankPrintableCoverage({ practice: [g as never] });
    expect(result.missing.get('pb.rd.000004@1')?.booklet).toContain(RARE[3] ?? RARE[0]);
  });
});

describe('自組卷 PDF 的字型檢查（bank-mock §7.6）', () => {
  it('GLYPH_SUBSTITUTES 的字：解析與資料來源不算缺字（PDF 會先替換），題本照樣算', () => {
    const g = practiceGroup();
    g['uid'] = 'ai.rd.000003';
    g['group'].passage = `文章${RARE[0]}`;
    g['group'].figures[0].chart.note = '附註';
    g['annotations'].explanations.items['1'].explanation_zh = `解析${RARE[1]}`;
    g['group'].figures[0].chart.source.title = `資料集${RARE[2]}`;
    const substitutes = new Set([RARE[0], RARE[1], RARE[2]].map((ch) => ch.codePointAt(0) ?? 0));
    const result = bankPrintableCoverage({ practice: [g as never] }, { substitutes });
    expect(result.missing.get('ai.rd.000003@1')).toEqual({ booklet: [RARE[0]], explanations: [], sources: [] });
  });

  it('glyphSubstituteCodePoints：讀 strings.ts 的 GLYPH_SUBSTITUTES（鍵寫成 \\u 跳脫）', () => {
    const source = `export const GLYPH_SUBSTITUTES: Readonly<Record<string, string>> = {\n  '\\u2260': '不等於',\n  /* 日文 */ '\\u7523': '產',\n};`;
    expect([...glyphSubstituteCodePoints(source)]).toEqual([0x2260, 0x7523]);
    // 實際的 strings.ts：日文字形「産」換成「產」。
    expect(glyphSubstituteCodePoints().has(0x7523)).toBe(true);
  });

  it('sitePaperBoldText：只讀 SITE_PAPER_BOLD 的字串常值與藍圖的大題標題、部分名稱', () => {
    const strings = `export const OTHER = { a: '不算' } as const;\nexport const SITE_PAPER_BOLD = {\n  // 註解不算\n  title: '教師卷',\n} as const;`;
    const blueprint = `{ id: 's1', title: '一、詞彙題（占10分）', part: '選擇題', instructions: '說明不算' }`;
    const text = sitePaperBoldText(strings, blueprint);
    expect(text).toContain('教師卷');
    expect(text).toContain('一、詞彙題（占10分）');
    expect(text).toContain('選擇題');
    expect(text).not.toContain('不算');
    expect(text).not.toContain('註解');
    // 實際的檔案
    expect(sitePaperBoldText()).toContain('教師卷：答案與解析');
    expect(sitePaperBoldText()).toContain('五、閱讀測驗（占24分）');
  });

  it('粗體子集沒有 SITE_PAPER_BOLD 的字是錯誤（不只是警告）；實際的字型與字串沒有缺字', () => {
    const result = checkFontCoverage([], { pdfSource: '', pdfDynamicSource: '', sitePaperBold: `粗體${RARE[0]}` });
    expect(result.errors).toEqual([expect.stringContaining('SITE_PAPER_BOLD')]);
    expect(result.errors[0]).toContain(RARE[0]);
    expect(checkFontCoverage([]).errors).toEqual([]);
  });
});

function vocabEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'adult|n./adj.|4',
    word: 'adult',
    variants: ['grown-up'],
    ipa: 'ˈædʌlt',
    zh: [
      { pos: 'n.', text: '成年人' },
      { pos: 'n.', text: `專業領域不印${RARE[3]}`, domain: '法' },
    ],
    en_def: [`英文定義不印${RARE[3]}`],
    variant_info: [{ form: 'adulthood', ipa: 'ˈædʌlthʊd', zh: '成年期' }],
    forms: { plural: 'adults' },
    family: [{ word: 'adolescent' }],
    synonyms: [
      { word: 'grown-up', in_list: true },
      { word: `notinlist${RARE[3]}`, in_list: false },
    ],
    antonyms: [{ word: 'child', in_list: true }],
    examples: [{ tatoeba_id: 49532, en: 'He is an adult.', zh: '他是成年人。', author: 'CK', zh_author: 'Martha' }],
    ...overrides,
  };
}

describe('單字講義的字型檢查（vocab-handout §7.2）', () => {
  it('vocabPrintableStrings：條目有字頭、寫法、音標、會印的釋義、衍生字、變化形、同詞族、表內同義反義；例句依 Tatoeba 編號分開', () => {
    const p = vocabPrintableStrings(vocabEntry());
    expect(p.entry).toEqual(['adult', 'grown-up', 'ˈædʌlt', '成年人', 'adulthood', 'ˈædʌlthʊd', '成年期', 'adults', 'adolescent', 'grown-up', 'child']);
    expect(p.entry.join('')).not.toContain(RARE[3]);
    expect(p.examples).toEqual([{ id: 49532, strings: ['He is an adult.', '他是成年人。', 'CK', 'Martha'] }]);
    expect(vocabPrintableStrings(null)).toEqual({ entry: [], examples: [] });
  });

  it('條目缺字是錯誤；例句缺字只警告並列出 Tatoeba 編號；零寬空白與細空白不算缺字；實際的字型與固定文字沒有缺字', () => {
    const ok = vocabPrintableCoverage([{ entries: [vocabEntry({ examples: [{ tatoeba_id: 1, en: 'A\u200bB\u2009C', zh: '好。' }] })] }]);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
    expect(ok.stats).toEqual({ entries: 1, examples: 1, badExamples: [] });

    const bad = vocabPrintableCoverage([
      {
        entries: [
          vocabEntry({ id: 'x|n.|1', zh: [{ pos: 'n.', text: `缺${RARE[0]}` }] }),
          vocabEntry({ id: 'y|n.|1', examples: [{ tatoeba_id: 7, en: 'Fine.', zh: `例句${RARE[1]}` }, { tatoeba_id: 3, en: 'OK.', zh: '好。', zh_author: `作者${RARE[2]}` }] }),
        ],
      },
    ]);
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('x|n.|1');
    expect(bad.errors[0]).toContain(RARE[0]);
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toContain('Tatoeba #3、#7');
    expect(bad.stats.badExamples).toEqual([3, 7]);
  });

  it('vocabPdfBoldText：只讀 VOCAB_PDF_BOLD 的字串常值；實際的檔案含句意填空與答案的標題', () => {
    const source = `export const VOCAB_PDF_TEXT = { a: '不算' } as const;\nexport const VOCAB_PDF_BOLD = {\n  // 註解不算\n  clozeTitle: '句意填空',\n} as const;`;
    expect(vocabPdfBoldText(source)).toContain('句意填空');
    expect(vocabPdfBoldText(source)).not.toContain('不算');
    expect(vocabPdfBoldText(source)).not.toContain('註解');
    expect(vocabPdfBoldText()).toContain('句意填空');
    expect(vocabPdfBoldText()).toContain('資料來源與授權');
  });
});
