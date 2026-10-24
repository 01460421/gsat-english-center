// @vitest-environment node
/**
 * build-data 的出版社題組輸出（lib/bank-data.mjs 的 publisher；docs/design/weak-paper.md §8.4、§8.9）。
 *
 * 範例是 tools/tests/data/publisher/pub-test 的兩個合成題組（站方自己寫的測試文字）與 tools/tests/data/publisher-sources.json
 * 的範例登記。預期輸出（golden）在 tests/fixtures/publisher-public：練習頁、確認頁與 PDF 的元件測試拿它當出版社題組的假資料，
 * 資料契約的測試也拿它檢查前端型別。改了輸出格式要更新 golden：
 *   UPDATE_PUBLISHER_GOLDEN=1 npx vitest run scripts/lib/bank-data.publisher.test.ts     （在 apps/web 底下執行）
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssistSkillCode, isPracticeGroupFileCore, isSourceRegistry, skillsOfQuestion } from '@gsat/shared';
import { officialCorpus, selectPublisherGroups } from '../../../../packages/shared/scripts/bank-select.mjs';
import { BankDataError, buildBankData, groupSkills, practiceGroupPath, publisherAnswerKey, publisherExplanationItems } from './bank-data.mjs';
import { buildPaperSkills } from './bank-paper-skills.mjs';
import { effectiveSources, publicSourceRegistry, readSourceRegistry, selectableSources } from './item-sources.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(WEB_DIR, '..', '..');
const PUBLISHER = path.join(REPO, 'tools', 'tests', 'data', 'publisher');
const REGISTRY = path.join(REPO, 'tools', 'tests', 'data', 'publisher-sources.json');
const GOLDEN = path.join(WEB_DIR, 'tests', 'fixtures', 'publisher-public');
const CZ = 'pub-test/v1/cloze/advanced/pb.cz.5a6b7c@1.json';
const MX = 'pub-test/v1/mixed/advanced/pb.mx.7a8b9c@1.json';
const TODAY = '2026-11-02';

type Json = Record<string, any>;
const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 選題＋輸出；dir 預設是範例目錄，registry 可以改範例登記（例如拿掉 explanations 以外的授權範圍）。 */
function build(options: { dir?: string; registry?: (raw: Json) => void } = {}) {
  const raw = readJson(REGISTRY);
  options.registry?.(raw);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'gsat-registry-')), 'sources.json');
  tmpDirs.push(path.dirname(file));
  writeFileSync(file, JSON.stringify(raw));
  const registry = readSourceRegistry(file);
  const sources = effectiveSources(registry.sources, TODAY);
  const sel = selectPublisherGroups(options.dir ?? PUBLISHER, {
    sources: selectableSources(sources.effective),
    today: TODAY,
    corpus: officialCorpus([]),
    contentKey: publisherAnswerKey,
  });
  const result = buildBankData('/nonexistent/bank/v1', {
    relative: (f) => path.relative(REPO, f),
    publisher: { chosen: sel.chosen, sources: new Map(registry.sources.map((s) => [s.id, s])) },
  });
  return { sel, result, publicRegistry: publicSourceRegistry(sources.effective, 'fixture') };
}

/** 範例複製到暫存目錄，改一個檔再建置。 */
function buildVariant(rel: string, change: (raw: Json) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'gsat-publisher-'));
  tmpDirs.push(root);
  cpSync(PUBLISHER, root, { recursive: true });
  const file = path.join(root, rel);
  const raw = readJson(file);
  change(raw);
  writeFileSync(file, JSON.stringify(raw));
  return build({ dir: root });
}

describe('範例出版社題組的輸出與 golden 一致', () => {
  const { result, publicRegistry } = build();
  const index = { version: 'fixture', count: result.entries.length, groups: result.entries };

  if (process.env['UPDATE_PUBLISHER_GOLDEN'] === '1') {
    rmSync(GOLDEN, { recursive: true, force: true });
    mkdirSync(path.join(GOLDEN, 'bank', 'groups'), { recursive: true });
    writeFileSync(path.join(GOLDEN, 'bank', 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    writeFileSync(path.join(GOLDEN, 'bank', 'sources.json'), `${JSON.stringify(publicRegistry, null, 2)}\n`);
    for (const g of result.groups) writeFileSync(path.join(GOLDEN, practiceGroupPath(g)), `${JSON.stringify(g, null, 2)}\n`);
  }

  it('index.json、題組檔、sources.json', () => {
    expect(index).toEqual(readJson(path.join(GOLDEN, 'bank', 'index.json')));
    for (const g of result.groups) expect(g).toEqual(readJson(path.join(GOLDEN, practiceGroupPath(g))));
    expect(publicRegistry).toEqual(readJson(path.join(GOLDEN, 'bank', 'sources.json')));
    expect(isSourceRegistry(publicRegistry)).toBe(true);
  });

  it('題組檔：出處、每一題的技能代碼、沒有 auto_verified；Worker 的守衛收得下', () => {
    const [cz, mx] = result.groups as Json[];
    expect(cz?.['source']).toEqual({
      id: 'pub-test',
      label_zh: '測試出版',
      product_zh: '測試模擬試題',
      attribution_zh: '本題出自測試出版《測試模擬試題》，經授權使用',
      ref_text: '原卷（第一回）第 16–18 題',
    });
    expect(cz?.['skills']).toEqual({ '1': ['tp:grammar'], '2': ['tp:connective', 'ct:cause_effect'], '3': ['tp:word_meaning', 'sn:core'] });
    expect(mx?.['source']?.['ref_text']).toBe('原卷（第一回）第 47–50 題');
    for (const g of result.groups as Json[]) {
      expect(g['auto_verified']).toBeUndefined();
      expect(g['curriculum']).toEqual([]);
      expect(g['provenance']).toEqual({ license: 'publisher-licensed', derivation: 'verbatim', attribution_text: g['source']['attribution_zh'], sources: [], references: [] });
      expect(isPracticeGroupFileCore(g, `${g['uid']}@${g['version']}`)).toBe(true);
      // 內部欄位（原卷位置的原始值、分級與標註依據、人工檢查、skill_extra、scoring_extra、open_key）不輸出。
      for (const k of ['source_ref', 'source_id', 'tier_basis', 'tag_basis', 'review', 'skill_extra', 'scoring_extra', 'open_key', 'explanation_basis', 'status']) {
        expect(Object.keys(g), k).not.toContain(k);
      }
      for (const q of g['group']['questions'] as Json[]) expect(q['stats']).toBeNull();
    }
  });

  it('index：src 是來源 id，skills 是每一題代碼的聯集', () => {
    expect(result.entries.map((e) => [e.uid, e.src, e.skills])).toEqual([
      ['pb.cz.5a6b7c', 'pub-test', ['ct:cause_effect', 'sn:core', 'tp:connective', 'tp:grammar', 'tp:word_meaning']],
      ['pb.mx.7a8b9c', 'pub-test', ['it:synthesis', 'it:vocab_in_context']],
    ]);
    for (const g of result.groups) expect(groupSkills(g)).toEqual(result.entries.find((e) => e.uid === g.uid)?.skills);
  });

  it('每一題的代碼：作答紀錄的 k（skillsOfQuestion 讀題組檔的 skills）等於技能分布的 q，而且都在封閉清單裡', () => {
    const skills = buildPaperSkills({ version: 'fixture', practice: result.groups, writing: [] });
    for (const g of result.groups as Json[]) {
      for (const q of g['group']['questions'] as Json[]) {
        const k = skillsOfQuestion(g['skills'], q['label'], { tags: q['tags'] ?? null, explanation: null });
        expect(skills.groups[`${g['uid']}@${g['version']}`]?.q?.[q['label']], `${g['uid']} ${q['label']}`).toEqual(k);
        for (const code of k) expect(isAssistSkillCode(code), code).toBe(true);
      }
    }
  });

  it('解析：授權沒有 explanations 時不輸出出版社的解析；部分給分寫法（scoring_extra）一律併進解析列', () => {
    const mx = (result.groups as Json[])[1];
    expect(mx?.['annotations']).toEqual({
      explanations: { items: { '1': { explanation_zh: '', evidence: [], partial_credit_forms: ['borrows', 'borrowed'], interchangeable_with: null } } },
      translation_zh: null,
      elimination: null,
    });
    const withExplanations = build({ registry: (raw) => raw['sources'][1]['licence']['scope'].push('explanations') }).result.groups[1] as Json;
    const items = withExplanations['annotations']['explanations']['items'];
    expect(Object.keys(items)).toEqual(['1', '2', '3', '4']);
    expect(items['1']).toEqual({
      explanation_zh: '文中說 visitors can borrow packets of vegetable seeds，主詞是複數，用原形 borrow。',
      evidence: ['visitors can borrow packets of vegetable seeds'],
      partial_credit_forms: ['borrows', 'borrowed'],
      interchangeable_with: null,
    });
    // 沒有出版社解析（explanation_basis null）的綜合測驗：沒有任何解析列。
    expect((result.groups as Json[])[0]?.['annotations']['explanations']).toEqual({ items: {} });
  });
});

describe('出版社題組的答案鍵（撤下規則）', () => {
  it('scoring_extra 的部分給分寫法改了也算改了答案', () => {
    const raw = readJson(path.join(PUBLISHER, MX));
    const changed = JSON.parse(JSON.stringify(raw)) as Json;
    changed['scoring_extra']['1']['partial_credit_forms'] = ['borrows'];
    expect(publisherAnswerKey(changed)).not.toBe(publisherAnswerKey(raw));
    const reordered = JSON.parse(JSON.stringify(raw)) as Json;
    reordered['scoring_extra']['1']['partial_credit_forms'] = ['borrowed', 'borrows'];
    expect(publisherAnswerKey(reordered)).toBe(publisherAnswerKey(raw));
    expect(publisherExplanationItems(raw, false)).toEqual({ '1': { explanation_zh: '', evidence: [], partial_credit_forms: ['borrows', 'borrowed'], interchangeable_with: null } });
  });
});

describe('違反前端契約時建置失敗', () => {
  const cases: Array<[string, string, (raw: Json) => void, RegExp]> = [
    ['部分給分寫法用在單選題', MX, (raw) => (raw['scoring_extra'] = { '3': { partial_credit_forms: ['A'] } }), /只能用在填充、簡答/],
    ['scoring_extra 的題號不存在', MX, (raw) => (raw['scoring_extra'] = { '9': { partial_credit_forms: ['x'] } }), /題號不存在/],
    ['可對調的格不是填充', MX, (raw) => (raw['scoring_extra'] = { '1': { interchangeable_with: 4 } }), /只能用在兩格填充之間/],
    ['skill_extra 的 clue_type 不在封閉清單', CZ, (raw) => (raw['skill_extra'] = { '2': { clue_type: 'vibes' } }), /clue_type 不合法/],
    ['出版社解析缺了一題', MX, (raw) => delete raw['annotations']['explanations']['items']['4'], /第 4 題缺少解析/],
    ['填充題沒有完整的可接受答案', MX, (raw) => (raw['group']['questions'][0]['accepted_answers'] = []), /accepted_answers/],
    ['單選題的正解不在選項裡', CZ, (raw) => (raw['group']['questions'][0]['answer'] = 'E'), /選項裡沒有正解/],
  ];
  for (const [name, rel, change, msg] of cases) {
    it(name, () => {
      expect(() => buildVariant(rel, change)).toThrow(BankDataError);
      expect(() => buildVariant(rel, change)).toThrow(msg);
    });
  }
});
