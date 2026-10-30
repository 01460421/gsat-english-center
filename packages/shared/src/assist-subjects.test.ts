/**
 * 學習助手的科目設定檔（docs/design/assistant-subjects.md §2.2、§9、§11.1）：設定檔完整、點數的每一種組合（英文和現行完全相同）、
 * 「拍 1 張＋單題解析 ≤ 10 點」、題數（英文和現行 routes.ts 相同）、科目偵測與科目不符的說明。
 */
import { describe, expect, it } from 'vitest';
import {
  ASSIST_DETECTED_SUBJECTS,
  ASSIST_SUBJECT_LABELS,
  ASSIST_SUBJECT_PROFILES,
  ASSIST_SUBJECTS,
  assistFormatSpec,
  assistItemCount,
  assistPoints,
  assistSubjectFromRef,
  assistSubjectMismatchText,
  detectAssistSubject,
  isAssistSubject,
} from './assist-subjects';
import { assistAnalyzePoints, type AssistQuestionTarget, type AssistQuestionView } from './assist';
import { ZH_CASE_KINDS } from './assist-zh';
import { ASSIST_SWITCHED_SUBJECTS } from './features';
import { AI_TASK_POINTS } from './writing';

function view(labels: string[], blocks: AssistQuestionView['blocks'] = []): Pick<AssistQuestionView, 'targets' | 'blocks'> {
  return { targets: labels.map((label) => ({ label }) as AssistQuestionTarget), blocks };
}

describe('科目設定檔', () => {
  it('英文是第一筆、國文是第二筆；英文以外的科目和 features.ts 的清單一致', () => {
    expect(ASSIST_SUBJECTS).toEqual(['english', 'chinese']);
    expect(ASSIST_SUBJECTS.slice(1)).toEqual([...ASSIST_SWITCHED_SUBJECTS]);
    expect(isAssistSubject('chinese')).toBe(true);
    expect(isAssistSubject('math')).toBe(false);
    expect(ASSIST_SUBJECT_LABELS).toEqual({ english: '英文', chinese: '國文' });
  });

  it('每一科的設定都完整：開關、lang、格式、點數、報告', () => {
    for (const s of ASSIST_SUBJECTS) {
      const p = ASSIST_SUBJECT_PROFILES[s];
      expect(p.id).toBe(s);
      expect(p.label).toBe(ASSIST_SUBJECT_LABELS[s]);
      expect(Object.keys(p.formats).length).toBeGreaterThan(0);
      for (const f of Object.values(p.formats)) expect(f.maxItems).toBeGreaterThanOrEqual(1);
    }
    expect(ASSIST_SUBJECT_PROFILES.english).toMatchObject({ lang: 'en', switchName: 'AI_ASSISTANT', photoSwitchName: 'AI_ASSISTANT_PHOTO', inReport: true });
    expect(ASSIST_SUBJECT_PROFILES.chinese).toMatchObject({ lang: 'zh-Hant', switchName: 'AI_ASSISTANT_SUBJECTS', photoSwitchName: 'AI_ASSISTANT_SUBJECTS_PHOTO', inReport: false });
    expect(Object.values(ASSIST_SUBJECT_PROFILES.chinese.formats).map((f) => f.kind)).toEqual([...ZH_CASE_KINDS]);
    expect(assistFormatSpec('chinese', 'zh_short')?.itemUnit).toBe('part');
    expect(assistFormatSpec('english', 'zh_short')).toBeNull();
  });
});

describe('assistPoints：每一種組合', () => {
  it('英文的點數和現行完全相同（轉錄、解析 1–5 題與寫作、單字、追問）', () => {
    expect(assistPoints('english', 'assist_ocr')).toBe(AI_TASK_POINTS.assist_ocr);
    expect(assistPoints('english', 'assist_ocr', { photos: 2 })).toBe(AI_TASK_POINTS.assist_ocr);
    expect(assistPoints('english', 'assist_followup')).toBe(AI_TASK_POINTS.assist_followup);
    for (const n of [1, 2, 3, 4, 5, 6, 0, Number.NaN]) {
      expect(assistPoints('english', 'assist_analyze', { kind: 'item', items: n })).toBe(assistAnalyzePoints('item', n));
    }
    expect(assistPoints('english', 'assist_analyze')).toBe(6);
    expect(assistPoints('english', 'assist_analyze', { kind: 'writing' })).toBe(assistAnalyzePoints('writing', 1));
    expect(assistPoints('english', 'assist_analyze', { kind: 'vocab', items: 8 })).toBe(assistAnalyzePoints('vocab', 8));
  });

  it('國文：轉錄 3／4；選擇 6 起每多一題 +2（最多 12）；簡答 6 起每多一個小題 +1（上限 10）；國寫 7；追問 3', () => {
    expect(assistPoints('chinese', 'assist_ocr')).toBe(3);
    expect(assistPoints('chinese', 'assist_ocr', { photos: 2 })).toBe(4);
    expect(assistPoints('chinese', 'assist_followup')).toBe(3);
    expect([1, 2, 3, 4, 5].map((n) => assistPoints('chinese', 'assist_analyze', { kind: 'zh_choice', items: n }))).toEqual([6, 8, 10, 12, 12]);
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => assistPoints('chinese', 'assist_analyze', { kind: 'zh_short', items: n }))).toEqual([6, 7, 8, 9, 10, 10, 10]);
    expect(assistPoints('chinese', 'assist_analyze', { kind: 'zh_writing', items: 3 })).toBe(7);
    expect(assistPoints('chinese', 'assist_analyze')).toBe(6);
    expect(assistPoints('chinese', 'assist_analyze', { kind: 'zh_choice', items: Number.NaN })).toBe(6);
  });

  it('不變式：每個科目、每種格式，「拍 1 張＋單題解析 ≤ 10 點」（簡答到 2 個小題）', () => {
    for (const s of ASSIST_SUBJECTS) {
      for (const f of Object.values(ASSIST_SUBJECT_PROFILES[s].formats)) {
        const items = f.itemUnit === 'part' ? 2 : 1;
        expect(assistPoints(s, 'assist_ocr', { photos: 1 }) + assistPoints(s, 'assist_analyze', { kind: f.kind, items }), `${s} ${f.kind}`).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('assistItemCount：計點單位數', () => {
  it('英文：item 是題數（至少 1），寫作、單字是 1（同現行 routes.ts）', () => {
    expect(assistItemCount('english', 'item', view(['21', '22', '23']))).toBe(3);
    expect(assistItemCount('english', 'item', view([]))).toBe(1);
    expect(assistItemCount('english', 'writing', view(['a', 'b']))).toBe(1);
    expect(assistItemCount('english', 'vocab', view(['a', 'b']))).toBe(1);
  });

  it('國文：選擇是題數、簡答是小題數（只寫題號時展開）、國寫是 1', () => {
    expect(assistItemCount('chinese', 'zh_choice', view(['1', '2', '3']))).toBe(3);
    const blocks: AssistQuestionView['blocks'] = [
      { kind: 'question', label: '33', text: '（1）乙文提到的「理所當然」，指的是什麼？（作答字數：15字以內。）\n（2）受訪者有何反應？（作答字數：合計40字以內。）' },
      { kind: 'question', label: '34', text: '請說明作者的看法。（作答字數：20字以內。）' },
    ];
    expect(assistItemCount('chinese', 'zh_short', view(['33', '34'], blocks))).toBe(3);
    expect(assistItemCount('chinese', 'zh_short', view(['33(1)', '33(2)'], blocks))).toBe(2);
    expect(assistItemCount('chinese', 'zh_writing', view(['一', '二']))).toBe(1);
  });
});

describe('detectAssistSubject：只建議、不擋', () => {
  it('英文、國文（白話與文言）、中英混合的國文題', () => {
    const english = 'The city council voted to expand the bike lanes because many residents asked for safer streets near the schools. Which of the following is true?';
    expect(detectAssistSubject(english)).toEqual({ subject: 'english', confidence: 'high' });
    expect(detectAssistSubject('下列各組「」內的詞，意義前後相同的是：(A)「為」天下笑／「為」人所制 (B)「之」子于歸／吾欲「之」南海')).toEqual({ subject: 'chinese', confidence: 'high' });
    expect(detectAssistSubject('古之學者必有師。師者，所以傳道、受業、解惑也。人非生而知之者，孰能無惑？惑而不從師，其為惑也，終不解矣。')).toEqual({ subject: 'chinese', confidence: 'high' });
    expect(detectAssistSubject('迷因（meme）是文化傳遞的微型單位，經由模仿、複製而在人群中流傳。依據上文，關於迷因的敘述，最適當的是哪一個選項呢？')).toEqual({ subject: 'chinese', confidence: 'high' });
  });

  it('數學（符號與數字密度、根號、積分）', () => {
    expect(detectAssistSubject('解方程式 x^2+3x-4=0，求 x 的值。').subject).toBe('math');
    expect(detectAssistSubject('化簡 √12 的結果為何？').subject).toBe('math');
  });

  it('社會、自然：特徵詞 ≥ 3 個而且國文特徵詞 < 2 時才建議（信心低）', () => {
    expect(detectAssistSubject('下列關於我國憲法與立法院職權的敘述，何者正確？選舉制度的改變又如何影響政黨的發展？')).toEqual({ subject: 'social', confidence: 'low' });
    expect(detectAssistSubject('植物細胞進行光合作用時，葉綠體中的酵素會改變反應速率，下列敘述何者正確？')).toEqual({ subject: 'science', confidence: 'low' });
    // 國文題目提到社會科的詞（「朝代」「條約」），但有國文的特徵詞：仍是國文。
    expect(detectAssistSubject('下列文句的「為」意義相同的是：讀音與字形都要注意，這個朝代的條約與戰爭留下許多成語。').subject).toBe('chinese');
  });

  it('其他與空白', () => {
    expect(detectAssistSubject('   ')).toEqual({ subject: 'other', confidence: 'low' });
    expect(detectAssistSubject('!!! ??? ...')).toEqual({ subject: 'other', confidence: 'low' });
    expect([...ASSIST_DETECTED_SUBJECTS]).toEqual(['english', 'chinese', 'math', 'social', 'science', 'other']);
  });
});

describe('科目不符的說明與 ref_json 的科目', () => {
  it('貼上時的建議、解析時的退還、轉錄時請學生換科目', () => {
    expect(assistSubjectMismatchText('social', 'input')).toBe('這看起來是社會科題目；學習助手目前只開放英文、國文。');
    expect(assistSubjectMismatchText('social', 'analyze')).toBe('這題看起來是社會科；學習助手目前只開放英文、國文。這次的點數已經退還。');
    expect(assistSubjectMismatchText('english', 'ocr')).toBe('這張看起來是英文題目，請把科目改成「英文」再拍一次。');
    expect(assistSubjectMismatchText('math', 'ocr')).toBe('這張看起來是數學題目；學習助手目前只開放英文、國文。');
    expect(assistSubjectMismatchText('english', 'analyze')).toBe('這題看起來是英文，請把科目改成「英文」。這次的點數已經退還。');
    expect(assistSubjectMismatchText('other', 'input')).toBe('這看起來不是學科題目；學習助手目前只開放英文、國文。');
    expect(assistSubjectMismatchText('chinese', 'input', ['english'])).toBe('這看起來是國文題目；學習助手目前只開放英文。');
    for (const s of ASSIST_DETECTED_SUBJECTS) for (const stage of ['input', 'analyze', 'ocr'] as const) expect(assistSubjectMismatchText(s, stage)).not.toMatch(/大考中心|CEEC/);
  });

  it('沒有 subject 鍵、壞掉的 JSON、不認得的科目都是英文', () => {
    expect(assistSubjectFromRef('{"source":"typed","subject":"chinese"}')).toBe('chinese');
    expect(assistSubjectFromRef({ source: 'photo', subject: 'chinese' })).toBe('chinese');
    expect(assistSubjectFromRef('{"source":"typed"}')).toBe('english');
    expect(assistSubjectFromRef('{"subject":"math"}')).toBe('english');
    expect(assistSubjectFromRef('not json')).toBe('english');
    expect(assistSubjectFromRef(null)).toBe('english');
  });
});
