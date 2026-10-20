// @vitest-environment node
/**
 * scripts/lib/bank-mock-letters.mjs：自組模擬考閱讀的可交換題目（sw）與答案指紋（k）（docs/design/bank-mock.md §5.3、§4.7）。
 * 用測試裡造的小題組；另外拿範例題庫的閱讀題組（tests/fixtures/bank/v1）確認原始檔與公開檔算出同樣的結果。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/data/exams';
import { letterSwapFor } from '../../src/features/mock/bank/letters';
import { answerFingerprints, isNumericOption, mentionedLetters, referencesOtherOptions, swappablePairs } from './bank-mock-letters.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Json = Record<string, any>;

/** 一篇 4 題的閱讀（答案依 answers），每題 4 個普通選項、中文解析不提字母。 */
function reading(answers: string, edit?: (g: Json) => void): Json {
  const questions = [...answers].map((answer, i) => ({
    no: i + 1,
    label: String(i + 1),
    mode: 'single_choice',
    stem: `Question ${i + 1}?`,
    options: { A: 'Red apples.', B: 'Green trees.', C: 'Blue skies.', D: 'Yellow sand.' },
    answer,
    accepted_answers: null,
    points: 2,
  }));
  const items = Object.fromEntries(
    questions.map((q) => [q.label, { explanation_zh: '第二段說明了原因。', evidence: ['It is true.'], option_notes_zh: { X: '文中沒有提到。' } }]),
  );
  const g: Json = { group: { questions, options_bank: null }, annotations: { explanations: { items } } };
  edit?.(g);
  return g;
}

const item = (g: Json, label: string): Json => g['annotations'].explanations.items[label];
const question = (g: Json, no: number): Json => g['group'].questions[no - 1];

describe('mentionedLetters：從寬判斷中文欄位提到哪些選項字母', () => {
  it('前後沒有緊鄰英文字母的 A–D（含全形）都算提到', () => {
    expect([...mentionedLetters('(A) 錯在時間，故選 C。')]).toEqual(['A', 'C']);
    expect([...mentionedLetters('Ｂ與Ｄ都不對')]).toEqual(['B', 'D']);
    expect([...mentionedLetters('A、B 都只說了一半')]).toEqual(['A', 'B']);
    expect([...mentionedLetters('Plan B 是備案')]).toEqual(['B']);
  });

  it('英文單字裡的字母與「A＋空格＋小寫字」的冠詞不算', () => {
    expect(mentionedLetters('DNA 與 ABC 都是縮寫').size).toBe(0);
    expect(mentionedLetters('原句是 A great many children died young.').size).toBe(0);
    expect(mentionedLetters('South Asia 的比率最低').size).toBe(0);
  });
});

describe('選項本身能不能換位置', () => {
  it('數字或年份的選項', () => {
    for (const t of ['2018.', '6 percent.', 'About 4,000 hours.', '1 hour 15 minutes.', 'In the 1930s.', 'Twice as many.']) {
      expect(isNumericOption(t), t).toBe(true);
    }
    expect(isNumericOption('Most adults died at around the age of 32.')).toBe(false);
    expect(isNumericOption('The second reason is more likely.')).toBe(false);
  });

  it('指向其他選項的寫法；多文本的 Text A、Writer B 指的是文章，不算', () => {
    expect(referencesOtherOptions('Both A and B.')).toBe(true);
    expect(referencesOtherOptions('(A) and (C) only.')).toBe(true);
    expect(referencesOtherOptions('All of the above.')).toBe(true);
    expect(referencesOtherOptions('Option D is wrong.')).toBe(true);
    expect(referencesOtherOptions('Text A doubts its results, while Text B praises them highly.')).toBe(false);
    expect(referencesOtherOptions('Writer B hopes the new spire will remind people of the fire.')).toBe(false);
    expect(referencesOtherOptions('Only A is true.')).toBe(true);
    expect(referencesOtherOptions('A UN study of the laws in 192 countries.')).toBe(false);
    expect(referencesOtherOptions('A Swede could call for help with the same number anywhere in the EU.')).toBe(false);
  });
});

describe('swappablePairs（sw）', () => {
  it('ABCD 排列的篇章：每一題都可以和答案字母不同的另一題交換', () => {
    expect(swappablePairs(reading('BCAD'))).toEqual([
      [1, 2], [1, 3], [1, 4], [2, 1], [2, 3], [2, 4], [3, 1], [3, 2], [3, 4], [4, 1], [4, 2], [4, 3],
    ]);
  });

  it('q 的中文欄位提到交換的兩個字母之一就不換；只提到另外兩個字母的照樣可以換', () => {
    // 第 1 題答案 B：解析提到 D → 不能和答案是 D 的第 4 題交換；提到 B（自己的答案）→ 第 1 題完全不能換。
    const g1 = reading('BCAD', (g) => {
      item(g, '1')['strategy_zh'] = '先刪掉 (D)。';
    });
    expect(swappablePairs(g1).filter(([q]) => q === 1)).toEqual([[1, 2], [1, 3]]);
    const g2 = reading('BCAD', (g) => {
      item(g, '1')['hints'] = ['答案是 B。'];
    });
    expect(swappablePairs(g2).filter(([q]) => q === 1)).toEqual([]);
    // option_notes_zh 的內容也看；鍵（選項代號）不算。
    const g3 = reading('BCAD', (g) => {
      item(g, '1')['option_notes_zh'] = { A: '和 C 一樣只說了一半。', C: '文中沒有提到。' };
    });
    expect(swappablePairs(g3).filter(([q]) => q === 1)).toEqual([[1, 3], [1, 4]]);
    // 英文的 evidence 是文章原句，不檢查。
    const g4 = reading('BCAD', (g) => {
      item(g, '1')['evidence'] = ['Plan B and C failed.'];
    });
    expect(swappablePairs(g4).filter(([q]) => q === 1)).toEqual([[1, 2], [1, 3], [1, 4]]);
  });

  it('選項是數字排列、選項指向其他選項、不是 4 選項的題目不能當 q（但仍可以當 r）', () => {
    const g = reading('BCAD', (g) => {
      question(g, 1)['options'] = { A: '1990.', B: '2000.', C: '2010.', D: '2020.' };
      question(g, 2)['options'] = { A: 'Only the first.', B: 'Only the second.', C: 'Both A and B.', D: 'Neither.' };
      question(g, 3)['options'] = { A: 'One.', B: 'Two.', C: 'Three.' };
    });
    const pairs = swappablePairs(g);
    expect(pairs.filter(([q]) => q !== 4)).toEqual([]);
    expect(pairs).toEqual([[4, 1], [4, 2], [4, 3]]);
  });

  it('交換後同一個字母最多兩次：已經有重複字母的篇章不能再做出第三個', () => {
    // A 已經出現兩次：任何換成 A 的組合都不行。
    expect(swappablePairs(reading('AABC')).some(([q, r]) => r <= 2 && q > 2)).toBe(false);
    expect(swappablePairs(reading('AABC'))).toEqual([[1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [4, 3]]);
  });
});

describe('answerFingerprints（k）', () => {
  const k = (g: Json) => answerFingerprints('reading', g);

  it('每題 4 位十六進位；只改文字（文章、題幹、選項、解析）時不變', () => {
    const base = k(reading('BCAD'));
    expect(base).toHaveLength(4);
    for (const fp of base) expect(fp).toMatch(/^[0-9a-f]{4}$/);
    const edited = reading('BCAD', (g) => {
      question(g, 1)['stem'] = 'What is the passage mainly about?';
      question(g, 2)['options'] = { A: 'A changed idea.', B: 'Another idea.', C: 'Blue skies.', D: 'Yellow sand.' };
      item(g, '3')['explanation_zh'] = '第三段改寫過的說明。';
    });
    expect(k(edited)).toEqual(base);
  });

  it('配分或可接受答案改了，只有那一題的指紋不同', () => {
    const base = k(reading('BCAD'));
    const points = k(
      reading('BCAD', (g) => {
        question(g, 2)['points'] = 3;
      }),
    );
    expect(points[1]).not.toBe(base[1]);
    expect([points[0], points[2], points[3]]).toEqual([base[0], base[2], base[3]]);
    const accepted = k(
      reading('BCAD', (g) => {
        question(g, 4)['accepted_answers'] = ['D', 'A'];
      }),
    );
    expect(accepted[3]).not.toBe(base[3]);
    expect(accepted.slice(0, 3)).toEqual(base.slice(0, 3));
  });

  it('閱讀：任何一題的答案或 sw 改了，整篇四題的指紋都不同（前端對整篇挑一組交換，別題的實際答案字母可能跟著變）', () => {
    const base = k(reading('BCAD'));
    // 第 1 題的答案改成 D。
    const answer = k(reading('DCAB'));
    base.forEach((fp, i) => expect(answer[i], `第 ${i + 1} 題`).not.toBe(fp));
    // 只在第 3 題的中文解析提到字母（答案都沒變）→ 第 3 題的 sw 變少 → 整篇的 sw 變了。
    const sw = k(
      reading('BCAD', (g) => {
        item(g, '3')['explanation_zh'] = '故選 A。';
      }),
    );
    base.forEach((fp, i) => expect(sw[i], `第 ${i + 1} 題`).not.toBe(fp));
  });

  it('閱讀的實際答案字母（letters.ts 的調整結果）有變的題目，指紋一定不同；指紋全部相同時調整結果也相同', () => {
    // 新版本只在第 4 題的解析多提到一個字母（審查時在真實題庫重現的情況：第 4 題的 sw 少了，整篇挑到的交換組合跟著變）。
    const v1 = reading('BCAD');
    const variants = ['A', 'B', 'C'].map((x) =>
      reading('BCAD', (g) => {
        item(g, '4')['explanation_zh'] = `第二段說明了原因（注意不要誤選 ${x}）。`;
      }),
    );
    const effective = (g: Json, uid: string, slot: number): string[] => {
      const questions = g['group'].questions as Question[];
      const pair = letterSwapFor(uid, slot, questions, swappablePairs(g));
      return questions.map((q) => {
        if (!pair || q.no !== pair[0]) return (q as Json)['answer'] as string;
        return (questions.find((r) => r.no === pair[1]) as Json)['answer'] as string;
      });
    };
    let otherQuestionMoved = false;
    for (const v2 of variants) {
      const [k1, k2] = [k(v1), k(v2)];
      for (let n = 0; n < 40; n += 1) {
        const uid = `ai.rd.${n.toString(16).padStart(6, '0')}`;
        for (const slot of [5, 6, 7]) {
          const [a1, a2] = [effective(v1, uid, slot), effective(v2, uid, slot)];
          a1.forEach((letter, i) => {
            if (letter === a2[i]) return;
            if (i !== 3) otherQuestionMoved = true;
            expect(k2[i], `${uid} 第 ${slot} 個位置的第 ${i + 1} 題`).not.toBe(k1[i]);
          });
        }
      }
    }
    // 確認這個測試真的涵蓋到「別題的字母跟著變」的情況。
    expect(otherQuestionMoved).toBe(true);
    // 指紋全部相同（只改文字）：調整結果一定相同。
    const textOnly = reading('BCAD', (g) => {
      question(g, 1)['stem'] = 'What is the passage mainly about?';
    });
    expect(k(textOnly)).toEqual(k(v1));
    for (const slot of [5, 6, 7]) expect(effective(textOnly, 'ai.rd.000001', slot)).toEqual(effective(v1, 'ai.rd.000001', slot));
  });

  it('混合題：可接受答案、部分給分寫法、可對調的格；清單只調換順序不算改變', () => {
    const mixed = (edit?: (g: Json) => void): Json => {
      const g: Json = {
        group: {
          questions: [
            { no: 1, label: '1', mode: 'fill_in_blank', answer: 'turns', accepted_answers: ['turns', 'makes'], points: 2 },
            { no: 2, label: '2', mode: 'fill_in_blank', answer: 'filling', accepted_answers: ['filling'], points: 2 },
            { no: 3, label: '3', mode: 'multi_select', options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f' }, answer: ['A', 'D'], points: 4 },
          ],
        },
        annotations: { explanations: { items: { '1': { partial_credit_forms: ['turn'] }, '2': {}, '3': {} } } },
      };
      edit?.(g);
      return g;
    };
    const base = answerFingerprints('mixed', mixed());
    expect(
      answerFingerprints('mixed', mixed((g) => {
        question(g, 1)['accepted_answers'] = ['makes', 'turns'];
        question(g, 3)['answer'] = ['D', 'A'];
      })),
    ).toEqual(base);
    expect(answerFingerprints('mixed', mixed((g) => question(g, 1)['accepted_answers'].push('changes')))[0]).not.toBe(base[0]);
    expect(answerFingerprints('mixed', mixed((g) => (item(g, '1')['partial_credit_forms'] = ['turned'])))[0]).not.toBe(base[0]);
    expect(answerFingerprints('mixed', mixed((g) => (item(g, '2')['interchangeable_with'] = 1)))[1]).not.toBe(base[1]);
    expect(answerFingerprints('mixed', mixed((g) => (question(g, 3)['answer'] = ['A', 'E'])))[2]).not.toBe(base[2]);
  });

  it('中譯英、作文：指紋涵蓋題目文字', () => {
    const tr = (stem: string): Json => ({ group: { questions: [{ no: 1, label: '1', mode: 'translation', stem, points: 4 }] } });
    expect(answerFingerprints('translation', tr('我們一起去看展覽。'))).toEqual(answerFingerprints('translation', tr('我們一起去看展覽。')));
    expect(answerFingerprints('translation', tr('我們一起去看展覽。'))).not.toEqual(answerFingerprints('translation', tr('我們一起去看電影。')));
  });

  it('範例題庫的閱讀題組：原始檔與公開檔算出同樣的 sw 與 k（目前版本用公開檔、舊版本用原始檔，才能互相比對）', () => {
    const raw = JSON.parse(readFileSync(path.join(WEB_DIR, 'tests', 'fixtures', 'bank', 'v1', 'reading', 'basic', 'ai.rd.0c1d2e@1.json'), 'utf8'));
    const pub = JSON.parse(readFileSync(path.join(WEB_DIR, 'tests', 'fixtures', 'bank-public', 'bank', 'groups', 'ai.rd.0c1d2e@1.json'), 'utf8'));
    expect(swappablePairs(pub)).toEqual(swappablePairs(raw));
    expect(swappablePairs(pub).length).toBeGreaterThan(0);
    expect(answerFingerprints('reading', pub)).toEqual(answerFingerprints('reading', raw));
  });
});
