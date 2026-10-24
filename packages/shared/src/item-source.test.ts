/**
 * 題目來源契約（docs/design/weak-paper.md §8.2、§8.3、§8.7、§7.6）：出處文字、來源登記的守衛與到期判斷、
 * 題組檔守衛對出版社題組的要求。基本的命名空間與 usablePaperSources 在 skill-aliases.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { GROUP_KEY_PATTERN, isPracticeGroupFileCore } from './bank-practice-file';
import {
  AI_BANK_SOURCE,
  ITEM_GROUP_KEY_PATTERN,
  defaultAttribution,
  forbiddenSourceTerms,
  groupSourceLine,
  isItemGroupSource,
  isSourceRegistry,
  labelRangeText,
  publisherOriginLabel,
  sourceRefText,
  sourceStatus,
  sourceTitle,
  type ItemGroupSource,
  type ItemSourcePublic,
} from './item-source';

const pub: ItemSourcePublic = {
  id: 'pub-test',
  ns: 'pb',
  kind: 'publisher',
  label_zh: '測試出版',
  publisher_zh: '測試出版股份有限公司',
  product_zh: '測試模擬試題',
  attribution_zh: defaultAttribution('測試出版', '測試模擬試題'),
  scope: ['web', 'pdf', 'ai_assist'],
  active: true,
  retired_on: null,
  ends_on: '2027-12-31',
};

const groupSource: ItemGroupSource = {
  id: 'pub-test',
  label_zh: '測試出版',
  product_zh: '測試模擬試題',
  attribution_zh: pub.attribution_zh,
  ref_text: sourceRefText({ paper: '第一回', labels: ['41', '42', '43', '44'] }),
};

describe('出處文字', () => {
  it('出處句的預設格式（站主 2026-10-23）', () => {
    expect(defaultAttribution('測試出版', '測試模擬試題')).toBe('本題出自測試出版《測試模擬試題》，經授權使用');
  });

  it('原卷位置：連續題號用 –，不連續用、；有回次時寫進括號', () => {
    expect(labelRangeText(['41', '42', '43', '44'])).toBe('41–44');
    expect(labelRangeText(['41', '42', '43', '45'])).toBe('41–43、45');
    expect(labelRangeText(['7'])).toBe('7');
    expect(labelRangeText(['A', 'B'])).toBe('A、B');
    expect(sourceRefText({ labels: ['16', '17', '18'] })).toBe('原卷第 16–18 題');
    expect(sourceRefText({ paper: '第一回', labels: ['41', '42', '43', '44'] })).toBe('原卷（第一回）第 41–44 題');
    expect(sourceRefText({ paper: ' ', labels: ['1'] })).toBe('原卷第 1 題');
    expect(sourceRefText({ labels: [] })).toBeNull();
    expect(sourceRefText(null)).toBeNull();
  });

  it('每組的出處列、學習助手案例的出處（§8.7）', () => {
    expect(sourceTitle(groupSource)).toBe('測試出版《測試模擬試題》');
    expect(sourceTitle({ label_zh: '測試出版', product_zh: null })).toBe('測試出版');
    expect(groupSourceLine(groupSource)).toBe('測試出版《測試模擬試題》原卷（第一回）第 41–44 題・經授權使用');
    expect(groupSourceLine({ ...groupSource, ref_text: null })).toBe('測試出版《測試模擬試題》・經授權使用');
    expect(publisherOriginLabel(groupSource, '進階練習')).toBe('測試出版《測試模擬試題》・進階練習・經授權使用');
  });

  it('禁字：大考中心、CEEC（不分大小寫）', () => {
    expect(forbiddenSourceTerms('本題出自測試出版《模擬試題》')).toEqual([]);
    expect(forbiddenSourceTerms('仿大考中心題型')).toEqual(['大考中心']);
    expect(forbiddenSourceTerms('ceec style')).toEqual(['CEEC']);
    for (const text of [pub.attribution_zh, groupSourceLine(groupSource), publisherOriginLabel(groupSource, '穩定基礎'), AI_BANK_SOURCE.attribution_zh]) {
      expect(forbiddenSourceTerms(text), text).toEqual([]);
    }
  });
});

describe('守衛', () => {
  it('isSourceRegistry：欄位、命名空間、授權範圍、日期格式', () => {
    expect(isSourceRegistry({ version: 'v', sources: [AI_BANK_SOURCE, pub] })).toBe(true);
    expect(isSourceRegistry({ version: 'v', sources: [] })).toBe(true);
    for (const bad of [
      { ...pub, ns: 'xx' },
      { ...pub, scope: ['web', 'print'] },
      { ...pub, ends_on: '2027/12/31' },
      { ...pub, id: 'Pub Test' },
      { ...pub, active: 'yes' },
      { ...pub, attribution_zh: null },
    ]) {
      expect(isSourceRegistry({ version: 'v', sources: [bad] }), JSON.stringify(bad)).toBe(false);
    }
    expect(isSourceRegistry({ sources: [] })).toBe(false);
  });

  it('isItemGroupSource', () => {
    expect(isItemGroupSource(groupSource)).toBe(true);
    expect(isItemGroupSource({ ...groupSource, ref_text: null, product_zh: null })).toBe(true);
    expect(isItemGroupSource({ ...groupSource, id: '../x' })).toBe(false);
    expect(isItemGroupSource({ ...groupSource, attribution_zh: undefined })).toBe(false);
  });

  it('題組代號收 ai 與 pb；公開題組檔的守衛要求出版社題組帶 source、本站題不能帶', () => {
    expect(GROUP_KEY_PATTERN).toBe(ITEM_GROUP_KEY_PATTERN);
    expect(GROUP_KEY_PATTERN.test('pb.rd.0a1b2c@1')).toBe(true);
    expect(GROUP_KEY_PATTERN.test('xx.rd.0a1b2c@1')).toBe(false);
    const file = (uid: string, extra: Record<string, unknown> = {}) => ({
      schema: 'gsat-bank-practice/v1',
      uid,
      version: 1,
      section_type: 'cloze',
      tier: 'advanced',
      group: { passage: 'x', options_bank: null, questions: [{ no: 1, label: '1', mode: 'single_choice', stem: null }] },
      annotations: { explanations: { items: {} }, elimination: null },
      ...extra,
    });
    expect(isPracticeGroupFileCore(file('ai.cz.0a1b2c'), 'ai.cz.0a1b2c@1')).toBe(true);
    expect(isPracticeGroupFileCore(file('ai.cz.0a1b2c', { source: groupSource }))).toBe(false);
    expect(isPracticeGroupFileCore(file('pb.cz.0a1b2c'))).toBe(false);
    expect(isPracticeGroupFileCore(file('pb.cz.0a1b2c', { source: groupSource, skills: { '1': ['tp:grammar'] } }), 'pb.cz.0a1b2c@1')).toBe(true);
    expect(isPracticeGroupFileCore(file('pb.cz.0a1b2c', { source: groupSource, skills: { '1': 'tp:grammar' } }))).toBe(false);
  });
});

describe('sourceStatus（fail closed，§7.6）', () => {
  const registry = { version: 'v', sources: [AI_BANK_SOURCE, pub, { ...pub, id: 'pub-noai', scope: ['web', 'pdf'] as ItemSourcePublic['scope'] }] };
  it('有效、到期日當天仍有效；過期、停用、不在登記檔都是 ended；授權不含 ai_assist 是 no_scope', () => {
    expect(sourceStatus(registry, 'pub-test', '2027-12-31', ['ai_assist'])).toBe('ok');
    expect(sourceStatus(registry, 'pub-test', '2028-01-01', ['ai_assist'])).toBe('ended');
    expect(sourceStatus({ ...registry, sources: [{ ...pub, active: false }] }, 'pub-test', '2026-11-01')).toBe('ended');
    expect(sourceStatus(registry, 'pub-unknown', '2026-11-01')).toBe('ended');
    expect(sourceStatus(registry, 'pub-noai', '2026-11-01', ['ai_assist'])).toBe('no_scope');
    expect(sourceStatus(registry, 'pub-noai', '2028-01-01', ['ai_assist'])).toBe('ended');
  });

  it('登記檔讀不到（null）：只認本站題庫', () => {
    expect(sourceStatus(null, 'ai-bank', '2026-11-01', ['ai_assist'])).toBe('ok');
    expect(sourceStatus(null, 'pub-test', '2026-11-01')).toBe('ended');
  });
});
