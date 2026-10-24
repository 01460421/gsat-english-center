// @vitest-environment node
/**
 * scripts/lib/item-sources.mjs：來源登記檔 data/sources.json → 公開的 bank/sources.json（docs/design/weak-paper.md §8.3、§7.6）。
 * 範例登記在 tools/tests/data/publisher-sources.json（本站題庫＋合成的「測試出版」，不是任何出版社的資料）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_BANK_SOURCE,
  ITEM_SOURCE_SCOPES,
  defaultAttribution as sharedDefaultAttribution,
  isSourceRegistry,
  labelRangeText as sharedLabelRange,
  sourceRefText as sharedSourceRefText,
} from '@gsat/shared';
import { AI_GROUP_LABEL } from '../../src/features/practice/labels';
import {
  AI_BANK_ATTRIBUTION,
  EXPIRY_WARNING_DAYS,
  ItemSourcesError,
  SOURCE_SCOPES,
  defaultAttribution,
  effectiveSources,
  labelRangeText,
  parseSourceRegistry,
  publicSourceRegistry,
  readSourceRegistry,
  selectableSources,
  sourceLogLines,
  sourceRefText,
  taiwanToday,
} from './item-sources.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = path.join(REPO, 'tools', 'tests', 'data', 'publisher-sources.json');

type Json = Record<string, any>;
const fixture = (): Json => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Json;
const pubOf = (raw: Json): Json => raw['sources'][1] as Json;

describe('和 shared（item-source.ts）、練習頁的常數一致', () => {
  it('本站題庫的出處句、授權範圍、預設出處句、原卷位置的文字', () => {
    expect(AI_BANK_ATTRIBUTION).toBe(AI_GROUP_LABEL);
    expect(AI_BANK_ATTRIBUTION).toBe(AI_BANK_SOURCE.attribution_zh);
    expect([...SOURCE_SCOPES]).toEqual([...ITEM_SOURCE_SCOPES]);
    expect(defaultAttribution('甲出版', '乙書')).toBe(sharedDefaultAttribution('甲出版', '乙書'));
    for (const labels of [['41', '42', '43', '44'], ['1', '3', '4'], ['A'], [], ['9', '10', '12', '13']]) {
      expect(labelRangeText(labels)).toBe(sharedLabelRange(labels));
      for (const paper of [null, '第一回', ' ']) expect(sourceRefText({ paper, labels })).toBe(sharedSourceRefText({ paper, labels }));
    }
  });

  it('taiwanToday：UTC 16:00 以後是台灣的隔天', () => {
    expect(taiwanToday(Date.UTC(2026, 9, 23, 15, 59))).toBe('2026-10-23');
    expect(taiwanToday(Date.UTC(2026, 9, 23, 16, 0))).toBe('2026-10-24');
  });
});

describe('parseSourceRegistry', () => {
  it('範例登記：出版社出處句沒給時套預設格式「本題出自{出版社}《{書名}》，經授權使用」', () => {
    const sources = readSourceRegistry(FIXTURE).sources;
    expect(sources.map((s) => s.id)).toEqual(['ai-bank', 'pub-test']);
    expect(sources[1]?.attribution_zh).toBe('本題出自測試出版《測試模擬試題》，經授權使用');
    expect(sources[1]?.licence).toEqual({ code: 'publisher-licensed', ref: 'TEST-0001', scope: ['web', 'pdf', 'ai_assist'], public_ok: true, until: '2099-12-31' });
    const given = fixture();
    pubOf(given)['attribution_zh'] = '本題出自測試出版（逐字出處句）';
    expect(parseSourceRegistry(given)[1]?.attribution_zh).toBe('本題出自測試出版（逐字出處句）');
  });

  it('檔案不存在：只有本站題庫', () => {
    const r = readSourceRegistry('/nonexistent/sources.json');
    expect(r.exists).toBe(false);
    expect(r.sources.map((s) => [s.id, s.attribution_zh])).toEqual([['ai-bank', AI_GROUP_LABEL]]);
  });

  it('格式錯一律丟錯（建置失敗）', () => {
    const cases: Array<[(raw: Json) => void, RegExp]> = [
      [(raw) => (raw['extra'] = 1), /必須是 \{ "sources"/],
      [(raw) => (pubOf(raw)['untill'] = '2027-01-01'), /不認得的欄位：untill/],
      [(raw) => (pubOf(raw)['licence']['until_date'] = '2027-01-01'), /licence 有不認得的欄位/],
      [(raw) => (pubOf(raw)['id'] = 'ai-bank'), /重複/],
      [(raw) => (pubOf(raw)['id'] = 'Pub_Test'), /id 必須是小寫英數與連字號/],
      [(raw) => (pubOf(raw)['kind'] = 'ai_bank'), /kind 必須是/],
      [(raw) => (pubOf(raw)['product_zh'] = null), /要有 publisher_zh 與 product_zh/],
      [(raw) => (pubOf(raw)['attribution_zh'] = '仿大考中心題型'), /不能有「大考中心」/],
      [(raw) => (pubOf(raw)['product_zh'] = 'CEEC 模擬題'), /不能有「CEEC」/],
      [(raw) => (pubOf(raw)['label_zh'] = 'ceec'), /CEEC/],
      [(raw) => (pubOf(raw)['licence']['code'] = 'original-ai'), /publisher-licensed/],
      [(raw) => (pubOf(raw)['licence']['scope'] = ['web', 'print']), /licence\.scope/],
      [(raw) => (pubOf(raw)['licence']['scope'] = ['web', 'web']), /licence\.scope/],
      [(raw) => (pubOf(raw)['licence']['until'] = '2027/12/31'), /licence\.until/],
      [(raw) => delete pubOf(raw)['licence']['public_ok'], /public_ok/],
      [(raw) => (pubOf(raw)['active'] = 'yes'), /active/],
      [(raw) => (pubOf(raw)['added'] = null), /added/],
      [(raw) => (pubOf(raw)['tier_labels'] = { 易: 'easy' }), /tier_labels/],
      [(raw) => (raw['sources'][0]['attribution_zh'] = 'AI 出題'), /本站題庫的出處句/],
      [(raw) => raw['sources'].shift(), /剛好有一筆本站題庫/],
      [(raw) => raw['sources'].push({ ...raw['sources'][0], id: 'ai-bank-2' }), /id 必須是 ai-bank/],
    ];
    for (const [mutate, msg] of cases) {
      const raw = fixture();
      mutate(raw);
      expect(() => parseSourceRegistry(raw), mutate.toString()).toThrow(ItemSourcesError);
      expect(() => parseSourceRegistry(raw), mutate.toString()).toThrow(msg);
    }
  });
});

describe('到期與公開輸出（fail closed）', () => {
  const sources = readSourceRegistry(FIXTURE).sources;
  const withPub = (change: (pub: Json) => void) => {
    const raw = fixture();
    change(pubOf(raw));
    return parseSourceRegistry(raw);
  };

  it('有效、手動停用、到期（到期日當天仍有效）、不允許公開、沒有 web', () => {
    const state = (list: ReturnType<typeof parseSourceRegistry>, today: string) => effectiveSources(list, today).effective.map((e) => [e.entry.id, e.state, e.publishable]);
    expect(state(sources, '2026-11-02')).toEqual([
      ['ai-bank', 'active', false],
      ['pub-test', 'active', true],
    ]);
    expect(state(sources, '2099-12-31')[1]).toEqual(['pub-test', 'active', true]);
    expect(state(sources, '2100-01-01')[1]).toEqual(['pub-test', 'expired', false]);
    expect(state(withPub((p) => (p['active'] = false)), '2026-11-02')[1]).toEqual(['pub-test', 'inactive', false]);
    expect(state(withPub((p) => (p['licence']['public_ok'] = false)), '2026-11-02')[1]).toEqual(['pub-test', 'not_public', false]);
    expect(state(withPub((p) => (p['licence']['scope'] = ['pdf'])), '2026-11-02')[1]).toEqual(['pub-test', 'no_web', false]);
  });

  it(`警告：${EXPIRY_WARNING_DAYS} 天內到期、已經到期、停用沒有 retired_on`, () => {
    expect(effectiveSources(sources, '2099-12-01').warnings).toEqual([expect.stringMatching(/pub-test 的授權 2099-12-31 到期（還有 30 天）/)]);
    expect(effectiveSources(sources, '2099-11-30').warnings).toEqual([]);
    expect(effectiveSources(sources, '2100-01-01').warnings).toEqual([expect.stringMatching(/已在 2099-12-31 到期：這次建置自動停用/)]);
    expect(effectiveSources(withPub((p) => (p['active'] = false)), '2026-11-02').warnings).toEqual([expect.stringMatching(/建議寫上 retired_on/)]);
    expect(effectiveSources(withPub((p) => ((p['active'] = false), (p['retired_on'] = '2026-11-01'))), '2026-11-02').warnings).toEqual([]);
  });

  it('公開檔：只有公開欄位、本站題庫排第一；到期的來源 active 是 false、仍帶 ends_on；合約編號不公開', () => {
    const pub = publicSourceRegistry(effectiveSources(sources, '2100-01-01').effective, 'v1');
    expect(isSourceRegistry(pub)).toBe(true);
    expect(pub.sources.map((s) => Object.keys(s).sort())).toEqual(
      Array(2).fill(['active', 'attribution_zh', 'ends_on', 'id', 'kind', 'label_zh', 'ns', 'product_zh', 'publisher_zh', 'retired_on', 'scope'].sort()),
    );
    expect(pub.sources[1]).toMatchObject({ id: 'pub-test', active: false, ends_on: '2099-12-31', attribution_zh: '本題出自測試出版《測試模擬試題》，經授權使用' });
    expect(JSON.stringify(pub)).not.toContain('TEST-0001');
    expect(JSON.stringify(pub)).not.toContain('tier_labels');
    expect(publicSourceRegistry(effectiveSources(sources, '2026-11-02').effective, 'v1').sources[1]?.active).toBe(true);
  });

  it('selectPublisherGroups 用的清單與建置紀錄', () => {
    const { effective } = effectiveSources(sources, '2100-01-01');
    expect(selectableSources(effective)).toEqual([
      { id: 'ai-bank', ns: 'ai', active: true, ends_on: null, scope: ['web', 'pdf', 'ai_assist', 'explanations'] },
      { id: 'pub-test', ns: 'pb', active: false, ends_on: '2099-12-31', scope: ['web', 'pdf', 'ai_assist'] },
    ]);
    expect(sourceLogLines(effective, { 'pub-test': 3 })).toEqual(['來源 ai-bank（本站題庫）：有效', '來源 pub-test（測試出版）：授權到期，授權到 2099-12-31，發布 3 組']);
  });
});
