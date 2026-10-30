/**
 * 國文的畫面元件（docs/design/assistant-subjects.md §8.1、§8.3–§8.5）：
 *   OptionVerdictTable  多選的「你」欄（選了、誤選、漏選）、研判題用題目自己的標籤與「你判」；手機卡片、桌機 <table>＋<th scope>。
 *   CardTable           11 種欄名、依 for_label 放到題號下、字音字形的查辭典標示、文言對照卡兩欄。
 *   ZhText              底線標記換成 <u>（不經 innerHTML）、報讀「畫線：」、加亮。
 *   CharCount、ZhErrorStats、PhotoBudgetLine、MultiScoreLine。
 *   先看提示：卡片、診斷、左欄的引文加亮都等展開完整解析（或按下那一句）才出現；研判題的「推出組合」。
 *   ZhWritingView       國寫方法卡（先收合、依題型列知性或情意、來源說明）、你附的段落的程式檢查（有附才有、沒有發現時一行說明）。
 */
import { ZH_CARD_COLUMNS, ZH_CARD_KINDS, ZH_WRITING_METHOD_CARDS, zhMultiScore, type ZhCardView, type ZhOptionView } from '@gsat/shared';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setDesktopViewport, setMobileViewport } from '../../../../test/viewport';
import { zhFormAnalysis, zhJudgeAnalysis, zhWordAnalysis, zhWritingAnalysis } from '../../testing/zh';
import { CardTable, cardsFor, sharedCards, zhCardLayout } from './components/CardTable';
import { CharCount, charCountText } from './components/CharCount';
import { MultiScoreLine } from './components/MultiScoreLine';
import { OptionVerdictTable, studentCell } from './components/OptionVerdictTable';
import { PhotoBudgetLine, photoBudget } from './components/PhotoBudgetLine';
import { ZhErrorStats, zhErrorSummary } from './components/ZhErrorStats';
import { ZhText, zhPlainText, zhSegments } from './components/ZhText';
import { zhBlockMarks, zhQuoteId } from './quotes';
import { ZhChoiceView, judgeComboLine } from './ZhChoiceView';
import { ZhWritingView } from './ZhWritingView';

afterEach(() => setMobileViewport());

function card(kind: ZhCardView['kind'], for_label = '1'): ZhCardView {
  return { for_label, kind, title_zh: '', rows: [{ head: '詞語', a: 'ㄆㄧˊ', b: '', note: '', range: null, flags: [] }] };
}

describe('OptionVerdictTable', () => {
  it('多選：你欄寫選了、沒選、誤選、漏選（手機每列一張卡，role=list）', () => {
    const item = zhWordAnalysis({ studentAnswer: 'AC', key: 'AE' }).items[0]!;
    render(<OptionVerdictTable options={item.options} labels={null} multi answerKey="AE" caption="逐選項判定" />);
    const list = screen.getByRole('list', { name: '逐選項判定' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('(A)');
    expect(rows[0]).toHaveTextContent('該選');
    expect(rows[0]).toHaveTextContent('你選了');
    expect(rows[0]).toHaveTextContent('正確答案');
    expect(rows[1]).toHaveTextContent('不選');
    expect(rows[1]).toHaveTextContent('你沒選');
    expect(rows[2]).toHaveTextContent('你誤選');
    expect(rows[4]).toHaveTextContent('你漏選');
  });

  it('研判：判定用題目的標籤，學生的組合拆成「你判」，和 AI 不同的那一句標出來', () => {
    const item = zhJudgeAnalysis({ studentAnswer: 'D' }).items[0]!;
    expect(studentCell(item.options[0]!, item.judge_labels, false)).toEqual({ text: '你判：不符合', ok: true });
    expect(studentCell(item.options[1]!, item.judge_labels, false)).toEqual({ text: '你判：無法判斷', ok: false });
    render(<OptionVerdictTable options={item.options} labels={item.judge_labels} multi={false} answerKey="" caption="敘述判定" />);
    const rows = within(screen.getByRole('list', { name: '敘述判定' })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('②');
    expect(rows[1]).toHaveTextContent('不符合');
    expect(rows[1]).toHaveTextContent('你判：無法判斷');
    expect(rows[1]!.className).toContain('border-bad');
    expect(screen.queryByText('該選')).toBeNull();
  });

  it('桌機：<table>，表頭與每列的選項是 <th scope>', () => {
    setDesktopViewport();
    const item = zhFormAnalysis({ studentAnswer: 'A' }).items[0]!;
    render(<OptionVerdictTable options={item.options} labels={null} multi={false} answerKey="C" caption="第 1 題的逐選項判定" />);
    const table = screen.getByRole('table', { name: '第 1 題的逐選項判定' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['選項', '判定', '你', '關鍵與理由']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(4);
    expect(within(table).getByText('你選的')).toBeInTheDocument();
  });

  it('AI 沒有判斷的選項（程式補的列）：寫「AI 沒有判斷」與追問的提示', () => {
    const gap: ZhOptionView = { option: 'E', verdict: null, key_zh: '', reason_zh: '', quote: '', range: null, flaw: '', student: null, flags: ['option_gap'] };
    render(<OptionVerdictTable options={[gap]} labels={null} multi answerKey="" caption="判定" />);
    expect(screen.getByText('AI 沒有判斷')).toBeInTheDocument();
    expect(screen.getByText('AI 沒有判斷這個選項，可以用追問問它')).toBeInTheDocument();
  });
});

describe('CardTable', () => {
  it('11 種卡各有自己的欄名（手機的小標）；空的欄位不顯示', () => {
    for (const kind of ZH_CARD_KINDS) {
      const { unmount } = render(<CardTable card={{ ...card(kind), rows: [{ head: '甲', a: '乙', b: '丙', note: '', range: null, flags: [] }] }} capped={false} />);
      const cols = ZH_CARD_COLUMNS[kind];
      expect(screen.getByText(cols.a)).toBeInTheDocument();
      expect(screen.getByText(cols.b)).toBeInTheDocument();
      expect(screen.queryByText(cols.note)).toBeNull();
      unmount();
    }
  });

  it('依 for_label 放到題號下（小題放到題目下）；空字串與不是題號的卡是整組共用', () => {
    const cards = [card('sound', '1'), card('form', '2'), card('compare', ''), card('sense', '34'), card('rule', '99')];
    expect(cardsFor(cards, '1').map((c) => c.kind)).toEqual(['sound']);
    expect(cardsFor(cards, '34(1)').map((c) => c.kind)).toEqual(['sense']);
    expect(sharedCards(cards, ['1', '2', '34(1)']).map((c) => c.kind)).toEqual(['compare', 'rule']);
  });

  it('zhCardLayout：只有一題時每張卡都屬於那一題（學生沒填題號時題號是空字串）；好幾題時依 for_label 分', () => {
    const cards = [card('sound', ''), card('form', '2'), card('compare', '')];
    const one = zhCardLayout(cards, ['']);
    expect(one.shared).toEqual([]);
    expect(one.of('').map((c) => c.kind)).toEqual(['sound', 'form', 'compare']);
    const many = zhCardLayout(cards, ['1', '2']);
    expect(many.of('2').map((c) => c.kind)).toEqual(['form']);
    expect(many.shared.map((c) => c.kind)).toEqual(['sound', 'compare']);
  });

  it('字音、字形卡在確定程度上限生效時標「讀音、字形請查教育部辭典」；字音的注音欄不換行', () => {
    render(<CardTable card={card('sound')} capped />);
    expect(screen.getByText('讀音、字形請查教育部辭典')).toBeInTheDocument();
    expect(screen.getByText('ㄆㄧˊ').className).toContain('whitespace-nowrap');
  });

  it('桌機的文言對照卡：兩欄（原文、白話），關鍵字詞與句式在下方小字；原文列用襯線字', () => {
    setDesktopViewport();
    const translation: ZhCardView = {
      for_label: '3',
      kind: 'translation',
      title_zh: '',
      rows: [{ head: '古之學者必有師', a: '古代求學的人一定有老師', b: '學者＝求學的人', note: '', range: { where: 'blocks', ref: '0', start: 0, end: 7 }, flags: [] }],
    };
    render(<CardTable card={translation} capped={false} onLocate={() => undefined} />);
    const table = screen.getByRole('table', { name: '文言對照卡' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['原文句', '白話']);
    expect(within(table).getByText('關鍵字詞：學者＝求學的人')).toBeInTheDocument();
    expect(table.querySelector('.zh-classical')).not.toBeNull();
    expect(within(table).getByRole('button', { name: '在題目中標出這句' })).toBeInTheDocument();
  });
});

describe('ZhText', () => {
  it('⟦…⟧ 換成底線、⟦~…~⟧ 換成波浪線，報讀「畫線：」；標記不顯示', () => {
    const { container } = render(<ZhText text="他⟦按步就班⟧，⟦~從不~⟧馬虎" />);
    const us = container.querySelectorAll('u');
    expect(us).toHaveLength(2);
    expect(us[0]!.textContent).toBe('畫線：按步就班');
    expect(us[1]!.className).toContain('zh-wavy');
    expect(container.textContent).not.toMatch(/[⟦⟧~]/);
    expect(zhPlainText('他⟦按步就班⟧')).toBe('他按步就班');
  });

  it('題目是純文字：<b> 這類標籤原樣顯示，不會變成元素', () => {
    const { container } = render(<ZhText text="<b>粗體</b>⟦底線⟧" />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>粗體</b>');
  });

  it('加亮：全部淡色、active 那一句 data-active；位置用含標記的原始文字索引', () => {
    const text = '甲⟦乙丙⟧丁';
    const segs = zhSegments(text, [{ start: 2, end: 4, active: true }]);
    expect(segs.filter((s) => s.mark?.active).map((s) => s.text).join('')).toBe('乙丙');
    const { container } = render(<ZhText text={text} marks={[{ start: 2, end: 4, active: true }]} />);
    expect(container.querySelector('mark[data-active="true"]')?.textContent).toBe('畫線：乙丙');
  });
});

describe('字數、錯因統計、拍照點數、多選計分', () => {
  it('CharCount：含標點、不含空白；超過上限時寫出來', () => {
    expect(charCountText({ chars: 19, han: 16 }, 20)).toBe('19 字（含標點；漢字 16）／20 字以內');
    render(<CharCount text="希望保守村子的祕密，以免外人前來打擾村子。" max={20} />);
    expect(screen.getByText(/超過 20 字的限制/)).toBeInTheDocument();
  });

  it('ZhErrorStats：依錯因族加總、最常見的 3 個；英文代碼不算', () => {
    const summary = zhErrorSummary({ zh_form_homophone: 3, zh_sound_side: 1, zh_polysemy: 2, collocation: 9, careless: 1 });
    expect(summary.families.map((f) => [f.label, f.count])).toEqual([
      ['字音字形', 4],
      ['詞語', 2],
      ['通用', 1],
    ]);
    expect(summary.top.map((t) => t.code)).toEqual(['zh_form_homophone', 'zh_polysemy', 'careless']);
    render(<ZhErrorStats counts={{ zh_form_homophone: 3 }} />);
    expect(screen.getByRole('heading', { name: /國文錯因統計/ })).toBeInTheDocument();
    expect(screen.getByText(/「同音、音近字誤用」3 次/)).toBeInTheDocument();
  });

  it('PhotoBudgetLine：轉錄 3 點（2 張 4 點）＋解析約 6 點；點數不夠時建議改用貼上', () => {
    expect(photoBudget(1)).toEqual({ ocr: 3, analyze: 6, total: 9 });
    expect(photoBudget(2).total).toBe(10);
    render(<PhotoBudgetLine photos={1} remaining={5} />);
    expect(screen.getByTestId('zh-photo-budget')).toHaveTextContent('轉錄 3 點＋解析約 6 點＝9 點；你今天還有 5 點。');
    expect(screen.getByText('點數不夠做完這一題，建議改用貼上。')).toBeInTheDocument();
  });

  it('judgeComboLine：研判題的「推出組合」＝逐句判定 → 答案與選項文字；不是研判題時沒有這一行', () => {
    const item = zhJudgeAnalysis({ studentAnswer: 'D' }).items[0]!;
    expect(judgeComboLine(item, '①、②皆不符合')).toBe('① 不符合、② 不符合 → (B)「①、②皆不符合」');
    expect(judgeComboLine(item, null)).toBe('① 不符合、② 不符合 → (B)');
    expect(judgeComboLine(zhFormAnalysis({ studentAnswer: 'A' }).items[0]!, '素昧平生')).toBeNull();
  });

  it('先看提示、沒填題號：字形卡、診斷與逐選項都收在「看完整解析」裡，提示階梯在上面', () => {
    const analysis = zhFormAnalysis({ label: '', studentAnswer: null });
    render(<ZhChoiceView analysis={analysis} common={{ hintFirst: true, sourceNote: null, locatable: () => false, onLocate: () => {} }} />);
    expect(screen.getByText('每句只找成語或關鍵詞。')).toBeVisible();
    expect(screen.queryByRole('region', { name: '字形卡：錯字對照' })).toBeNull();
    expect(screen.getByText('(A)「價格卻不斐」有錯字，應該寫「不菲」。')).not.toBeVisible();
    expect(document.querySelector('[data-zh-shared-cards]')).toBeNull();
  });

  it('zhBlockMarks：先看提示（activeOnly）時只標按下的那一句', () => {
    const analysis = zhFormAnalysis({ label: '', studentAnswer: null });
    const blocks = [{ kind: 'question' as const, label: null, text: '(C)我們素昧平生，卻一見如故' }];
    expect(Object.values(zhBlockMarks(analysis, blocks, null)).flat().length).toBeGreaterThan(0);
    expect(zhBlockMarks(analysis, blocks, null, { activeOnly: true })).toEqual({});
    const id = zhQuoteId.step('', 0);
    expect(Object.values(zhBlockMarks(analysis, blocks, id, { activeOnly: true })).flat()).toEqual([expect.objectContaining({ active: true })]);
  });

  it('MultiScoreLine：顯示 shared 算好的那一行', () => {
    render(<MultiScoreLine score={zhMultiScore({ chosen: 'AC', key: 'AE', n: 5, basis: 'student_key' })} />);
    expect(screen.getByTestId('zh-multi-score')).toHaveTextContent('你誤選 (C)、漏選 (E)：答錯 2 個選項，得 1/5（每題 4 分時是 0.8 分）。');
  });
});

describe('ZhWritingView：國寫方法卡與程式檢查', () => {
  const common = { hintFirst: false, sourceNote: null, locatable: () => false, onLocate: () => {} };
  const cards = () => document.querySelector('[data-zh-method-cards]') as HTMLDetailsElement;

  it('國寫方法卡先收合；五張卡都有要點與練習；情意題只列「情意題」那一行；有來源說明', () => {
    render(<ZhWritingView analysis={zhWritingAnalysis()} common={common} />);
    expect(cards()).not.toHaveAttribute('open');
    expect(within(cards()).getByText('國寫方法卡').tagName).toBe('SUMMARY');
    expect(cards().querySelectorAll('[data-method-card]')).toHaveLength(5);
    for (const card of ZH_WRITING_METHOD_CARDS) {
      expect(within(cards()).getByText(card.title_zh)).not.toBeVisible();
      expect(within(cards()).getByText(card.emotion_zh)).toBeInTheDocument();
      expect(within(cards()).queryByText(card.reason_zh)).toBeNull();
      expect(within(cards()).getByText(card.practice_zh)).toBeInTheDocument();
    }
    expect(within(cards()).getAllByText('情意題：')).toHaveLength(5);
    expect(within(cards()).getByText('整理自全國語文競賽高中學生組得獎作品與評審講評的共同寫法（本站分析，不轉載原文）。')).toBeInTheDocument();
  });

  it('知性題只列「知性題」那一行；題型不明兩行都列', () => {
    const { unmount } = render(<ZhWritingView analysis={{ ...zhWritingAnalysis(), section: 'zh_writing_reason' }} common={common} />);
    expect(within(cards()).getAllByText('知性題：')).toHaveLength(5);
    expect(within(cards()).queryByText('情意題：')).toBeNull();
    unmount();
    render(<ZhWritingView analysis={{ ...zhWritingAnalysis(), section: 'zh_other' }} common={common} />);
    expect(within(cards()).getAllByText('知性題：')).toHaveLength(5);
    expect(within(cards()).getAllByText('情意題：')).toHaveLength(5);
  });

  it('附了段落：在「你附的段落」裡列程式檢查（標籤、錯因、引學生的字），標明不花點數、不送 AI', () => {
    const text = '我們一但放棄就回不去了！真的回不去了！';
    render(<ZhWritingView analysis={zhWritingAnalysis({ draft: text })} common={common} draftText={text} />);
    const section = screen.getByRole('region', { name: /你附的段落/ });
    const program = section.querySelector('[data-zh-draft-program]') as HTMLElement;
    expect(within(program).getByRole('heading', { name: '程式檢查（不花點數）' })).toBeInTheDocument();
    const items = program.querySelectorAll('[data-zh-draft-check]');
    expect([...items].map((li) => li.getAttribute('data-zh-draft-check'))).toEqual(['typo', 'exclamation']);
    expect(items[0]).toHaveTextContent('常見錯字');
    expect(items[0]).toHaveTextContent('文辭（含錯字、標點）');
    expect(items[0]).toHaveTextContent('「一但」應寫「一旦」');
    expect(items[1]).toHaveTextContent('這一段有 2 個驚嘆號（「我們一但放棄就回不去了！」）');
    expect(within(program).getByText('程式依固定規則比對，不送 AI；沒列出的不代表沒有問題。')).toBeInTheDocument();
  });

  it('附了段落但沒有發現：一行說明檢查了哪幾項（問題（一）的答案不列字數與開頭）', () => {
    const text = '選擇不是逃避，而是知道自己要往哪裡走。';
    const { unmount } = render(<ZhWritingView analysis={zhWritingAnalysis({ draft: text })} common={common} draftText={text} />);
    expect(screen.getByText('程式沒有找到這幾種常見問題：字數偏多、開頭太長、常見錯字、套語、驚嘆號太多、分號串排比。')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-zh-draft-check]')).toHaveLength(0);
    unmount();
    const q1 = zhWritingAnalysis({ draft: text });
    render(<ZhWritingView analysis={{ ...q1, draft: { ...q1.draft!, target: 'q1' } }} common={common} draftText={text} />);
    expect(screen.getByText('程式沒有找到這幾種常見問題：常見錯字、套語、驚嘆號太多、分號串排比。')).toBeInTheDocument();
  });

  it('沒有附段落：沒有程式檢查（即使傳了文字）；有附段落但拿不到原文：只顯示 AI 的檢核', () => {
    const { unmount } = render(<ZhWritingView analysis={zhWritingAnalysis()} common={common} draftText="我們一但放棄！" />);
    expect(document.querySelector('[data-zh-draft-program]')).toBeNull();
    unmount();
    render(<ZhWritingView analysis={zhWritingAnalysis({ draft: '我在渡過暑假的時候…' })} common={common} />);
    expect(screen.getByRole('region', { name: /你附的段落/ })).toBeInTheDocument();
    expect(document.querySelector('[data-zh-draft-program]')).toBeNull();
  });
});
