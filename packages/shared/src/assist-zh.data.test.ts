/**
 * 學習助手國文的本站自寫文字對 D8 國文指紋（docs/design/assistant-subjects.md §3.9、§5.7、§11.1）。屬於 vitest 的 data 專案
 * （`npm run test:data`），讀 data/d8/ 的產物（只有雜湊）：
 *   - 每個題型的解法步驟、多選題策略、程式的固定說明、代碼的中文標籤：8 字窗口 0 命中，短答 3 字組的包含率都在門檻以下；
 *   - 測試用的公開題本全文（fixtures/zh-papers-public.txt）：8 字窗口 0 命中（指紋本來就扣掉題本，命中表示 fixture 混進了別的文字）。
 * 官方受保護文字不在 repo 裡，這裡只比對雜湊；失敗訊息只印本站自己的文字。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readZhFingerprintFile,
  ZH_D8_OFFICIAL_FILE,
  ZH_D8_SHORT_FILE,
  ZH_D8_SHORT_THRESHOLD,
  zhD8OfficialHitCount,
  zhShortContainment,
} from '../scripts/d8-zh-fingerprint.mjs';
import {
  ZH_CARD_COLUMNS,
  ZH_CARD_LABELS,
  ZH_ERROR_INFO,
  ZH_FLAW_LABELS,
  ZH_ITEM_WARNING_TEXT,
  ZH_NOTICE_TEXT,
  ZH_ROW_FLAG_TEXT,
  ZH_SECTION_LABELS,
  ZH_SECTION_SPECS,
  ZH_SECTIONS,
  ZH_SKILL_LABELS,
  zhSelfWrittenStepTexts,
} from './assist-zh';
import { ZH_CLICHE_GROUPS, ZH_DRAFT_CHECK_INFO, zhDraftChecks, zhWritingMethodCardTexts } from './assist-methods-zh';
import { ASSIST_DETECTED_SUBJECTS, assistSubjectMismatchText } from './assist-subjects';
import { ASSIST_INPUT_PROBLEM_MESSAGES } from './assist';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const official = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_OFFICIAL_FILE), 'utf8')));
const short = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_SHORT_FILE), 'utf8')));

/** 本站自寫、會出現在系統提示或畫面上的國文文字。 */
function selfWrittenTexts(): string[] {
  return [
    ...zhSelfWrittenStepTexts(),
    ...ZH_SECTIONS.flatMap((s) => [ZH_SECTION_LABELS[s], ZH_SECTION_SPECS[s].key_example_zh]),
    ...Object.values(ZH_ERROR_INFO).flatMap((i) => [i.label, i.note ?? '']),
    ...Object.values(ZH_FLAW_LABELS),
    ...Object.values(ZH_SKILL_LABELS),
    ...Object.values(ZH_CARD_LABELS),
    ...Object.values(ZH_CARD_COLUMNS).flatMap((c) => Object.values(c)),
    ...Object.values(ZH_NOTICE_TEXT),
    ...Object.values(ZH_ITEM_WARNING_TEXT),
    ...Object.values(ZH_ROW_FLAG_TEXT),
    ...Object.values(ASSIST_INPUT_PROBLEM_MESSAGES),
    ...ASSIST_DETECTED_SUBJECTS.flatMap((s) => (['input', 'analyze', 'ocr'] as const).map((stage) => assistSubjectMismatchText(s, stage))),
    // 國寫方法卡與附段落的程式檢查。說明句用本站自寫的段落產生：一次最多 5 筆，所以分三段，合起來每一種說明句
    // （各題型的字數與開頭、錯字、套語、單段與多段的驚嘆號、分號，問題（一）的驚嘆號）都至少出現一次；套語各組的建議另外直接列。
    ...zhWritingMethodCardTexts(),
    ...Object.values(ZH_DRAFT_CHECK_INFO).map((i) => i.label_zh),
    ...ZH_CLICHE_GROUPS.map((g) => g.advice_zh),
    ...(['zh_writing_reason', 'zh_writing_emotion', 'zh_other'] as const).flatMap((section) =>
      [
        zhDraftChecks(`隨著時代的進步，${'我'.repeat(800)}，一但開始就不能停！真的不能停！\n有人等待；有人出發；有人回頭；有人不選。`, section),
        zhDraftChecks('有人等待；有人出發；有人回頭；有人不選。好!真好!', section),
        zhDraftChecks('好！\n真好！', section),
        zhDraftChecks('好!真好!一但開始，讓我受益良多。', section, { target: 'q1' }),
      ].flatMap((fs) => fs.map((f) => f.detail_zh)),
    ),
  ].filter((t) => t !== '');
}

describe('D8 國文指紋：本站自寫的文字', () => {
  it('指紋檔讀得到、格式對', () => {
    expect(official.kind).toBe('zh-official');
    expect(short.kind).toBe('zh-short');
  });

  it('8 字窗口 0 命中（逐段，也試整串接起來）', () => {
    if (official.kind !== 'zh-official') return;
    const texts = selfWrittenTexts();
    expect(texts.length).toBeGreaterThan(100);
    for (const t of texts) expect(zhD8OfficialHitCount(t, official.set), t).toBe(0);
    expect(zhD8OfficialHitCount(texts.join('\n'), official.set)).toBe(0);
  });

  it('短答 3 字組：每一段對每一組的包含率都在門檻以下', () => {
    if (short.kind !== 'zh-short') return;
    for (const t of selfWrittenTexts()) {
      for (const s of short.sets) expect(zhShortContainment(t, s.set), `${t}（${s.year} ${s.item}）`).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
    }
  });

  it('常見的選擇題題幹（評測題目集的題幹與講義常用的寫法）：8 字窗口 0 命中（命中會讓解析裡引用題幹的說明被誤藏）', () => {
    if (official.kind !== 'zh-official') return;
    const golden = path.join(REPO, 'apps/api/test/fixtures/assist-zh-golden');
    const stems = ['b-choice.json', 'b-unseen.json'].flatMap((f) =>
      (JSON.parse(readFileSync(path.join(golden, f), 'utf8')) as { cases: Array<{ items: Array<{ stem: string }> }> }).cases.flatMap((c) => c.items.map((it) => it.stem)),
    );
    expect(stems.length).toBeGreaterThan(50);
    const common = [
      '下列文句，標點符號使用正確的是：',
      '這題考標點符號使用正確的是哪一句',
      '下列文句，標點符號使用恰當的是：',
      '下列「」內的字，字形完全正確的選項是：',
      '下列文句中「」內的字，何者字形錯誤？',
      '下列各組「」內的字，讀音前後相同的是：',
      '下列文句，完全沒有錯別字的是：',
      '下列文句畫底線處的詞語，運用適當的是：',
      '下列甲、乙、丙、丁四句，依文意排列順序最恰當的是：',
      '下列題辭，使用恰當的是：',
      '依據上文，下列敘述何者正確？',
    ];
    for (const t of [...stems, ...common]) expect(zhD8OfficialHitCount(t, official.set), t).toBe(0);
  });

  it('測試用的公開題本全文：8 字窗口 0 命中', () => {
    if (official.kind !== 'zh-official') return;
    const papers = readFileSync(new URL('./fixtures/zh-papers-public.txt', import.meta.url), 'utf8');
    expect(zhD8OfficialHitCount(papers, official.set)).toBe(0);
  });
});
