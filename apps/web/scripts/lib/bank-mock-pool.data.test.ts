// @vitest-environment node
/**
 * 自組模擬考組卷池的真實題庫測試（docs/design/bank-mock.md §10.2 的建置端部分；web 的 data 專案，`npm run test:data`）：
 * 直接呼叫 buildBankData、buildWritingBank 與 buildMockPool，從 data/bank/v1 建池子，不依賴先跑過 build:data。
 *
 * 題庫每天加題、下架，這裡的失敗只出現在題庫那條 CI（exams job），不擋程式的 PR。
 * 組卷層級的檢查（300 個種子組卷、連續組卷份數、答案位置分布）要用前端的組卷程式，放在 bank-mock.data.test.ts。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readExams, readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { buildBankData } from './bank-data.mjs';
import { MOCK_SECTIONS, buildMockPool, poolSupply, type MockPoolFile } from './bank-mock-pool.mjs';
import { CONCEPT_ALIASES, SINGLE_CHAR_WHITELIST, compileAliases, conceptIds, topicPlanIndex } from './bank-mock-themes.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');
const PLAN_FILES = ['topic-plan.json', 'topic-plan-writing.json'].map((f) => path.join(REPO_ROOT, 'data', 'bank', f));
const TIERS = ['basic', 'advanced', 'top'] as const;
const UID_CODES: Record<string, string> = { vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx', translation: 'tr', composition: 'cp' };

/**
 * §4.3 實測到的撞題（同一難度、不同大題）：每一組的 uid 兩兩都要有共同的主題鍵。
 * uid 已經不在池子裡（改版撤下、下架）的那一組略過，不算失敗。
 */
const KNOWN_COLLISIONS: { tier: (typeof TIERS)[number]; concept: string; uids: string[] }[] = [
  { tier: 'basic', concept: '自行車', uids: ['ai.wb.3c8e51', 'ai.st.06d3ea', 'ai.rd.5b3a62'] },
  { tier: 'basic', concept: '鉛筆', uids: ['ai.cz.f2954f', 'ai.wb.9a4f27'] },
  { tier: 'basic', concept: '絲路', uids: ['ai.wb.5e72c9', 'ai.st.a287bd'] },
  { tier: 'basic', concept: '剩食', uids: ['ai.wb.b2f483', 'ai.st.16ba2b'] },
  { tier: 'basic', concept: '睡眠', uids: ['ai.cz.5b6bf5', 'ai.st.47d418', 'ai.mx.d202e4'] },
  { tier: 'advanced', concept: '光害／睡眠與午睡', uids: ['ai.st.c06d09', 'ai.cz.e2b63d'] },
  { tier: 'top', concept: '光害', uids: ['ai.cz.0becb9', 'ai.wb.d5b4a7'] },
];

/**
 * 白名單裡的單一中文字在目前題庫實際比對到的主題（人工看過，都是同一個概念）。
 * 新的主題比對到時這個測試會失敗：看過確認是同一個概念就加進來，不是就改別名表（bank-mock-themes.mjs）。
 */
const REVIEWED_SINGLE_CHAR_TOPICS: Record<string, string[]> = {
  睡: ['不夜城與早睡小鎮', '動物怎麼睡覺'],
};

let pool: MockPoolFile;
let topics: Map<string, { tier: string; section: string; topic: string | null; texts: string[] }>;

beforeAll(() => {
  const unpublished = readUnpublish(UNPUBLISH_FILE, { repoRoot: REPO_ROOT });
  const bank = buildBankData(BANK_DIR, { unpublished, repoRoot: REPO_ROOT });
  const { exams, warnings } = readExams(path.join(REPO_ROOT, 'data', 'exams', 'parsed'));
  expect(warnings).toEqual([]);
  const writing = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH_FILE, repoRoot: REPO_ROOT });
  const topicPlans = PLAN_FILES.filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown);
  const result = buildMockPool({ version: 'data-test', bankDir: BANK_DIR, practice: bank.groups, writing: writing.index, topicPlans });
  pool = result.pool;
  // 每個題組比對概念別名用的文字（主題＋對得上 topic-plan 的 keywords、angle_en），給單字白名單的檢查用。
  const plans = topicPlanIndex(topicPlans);
  topics = new Map();
  const add = (uid: string, tier: string, section: string, topic: string | null) => {
    const plan = topic ? plans.get(topic) : undefined;
    topics.set(uid, { tier, section, topic, texts: topic ? [topic, ...(plan?.keywords ?? []), ...(plan?.angle ? [plan.angle] : [])] : [] });
  };
  for (const g of bank.groups) {
    const tags = (g['group'] as { tags?: { topic?: unknown } } | undefined)?.tags;
    add(g.uid, g.tier, g.section_type, typeof tags?.topic === 'string' ? tags.topic : null);
  }
  for (const w of writing.index) add(w.uid, w.tier, w.section_type, w.topic);
  const supply = poolSupply(pool);
  console.log(
    `[bank-mock-pool.data] 不重複可組：${TIERS.map((t) => `${t} ${supply[t].total} 份（瓶頸 ${supply[t].bottleneck.join('、')}）`).join('；')}；` +
      `排除 ${result.excluded.length} 組${result.excluded.length > 0 ? `（${result.excluded.map((e) => `${e.key} ${e.reason}`).join('、')}）` : ''}`,
  );
}, 120_000);

describe('真實題庫的組卷池', () => {
  it('三種難度、八個大題都有題組；uid 的題型代碼對得上大題；版本可以編進代號', () => {
    for (const t of TIERS) {
      for (const s of MOCK_SECTIONS) {
        const list = pool.tiers[t][s];
        expect(list.length, `${t}/${s}`).toBeGreaterThan(0);
        expect(list.map((e) => e.uid), `${t}/${s} 依 uid 排序`).toEqual([...list.map((e) => e.uid)].sort());
        for (const e of list) {
          expect(e.uid, `${t}/${s}`).toMatch(new RegExp(`^ai\\.${UID_CODES[s]}\\.[0-9a-f]{6}$`));
          expect(e.v).toBeGreaterThanOrEqual(1);
          expect(e.k.length, `${e.uid} 的指紋`).toBeGreaterThan(0);
          for (const v of Object.keys(e.prev ?? {})) expect(Number(v), `${e.uid} 的 prev`).toBeLessThan(e.v);
        }
      }
    }
  });

  it('完整 uid 在池子裡不重複（不同題型的相同十六進位是合法的）', () => {
    const all = TIERS.flatMap((t) => MOCK_SECTIONS.flatMap((s) => pool.tiers[t][s].map((e) => e.uid)));
    expect(new Set(all).size).toBe(all.length);
  });

  it('閱讀：fig、form、sw 的形狀；sw 的兩題都在題組裡、答案字母不同', () => {
    for (const t of TIERS) {
      for (const e of pool.tiers[t].reading) {
        expect([null, 'chart', 'table']).toContain(e.fig);
        expect(typeof e.form).toBe('string');
        for (const [q, r] of e.sw ?? []) {
          expect(q).not.toBe(r);
          expect(q).toBeGreaterThanOrEqual(1);
          expect(q).toBeLessThanOrEqual(e.k.length);
          expect(r).toBeLessThanOrEqual(e.k.length);
        }
      }
    }
  });

  it('不重複可以組的份數（§3.2 的公式，不考慮主題衝突）每種難度至少 6 份', () => {
    const supply = poolSupply(pool);
    for (const t of TIERS) expect(supply[t].total, `${t}：瓶頸 ${supply[t].bottleneck.join('、')}`).toBeGreaterThanOrEqual(6);
  });
});

describe('主題鍵（§4.3）', () => {
  const entryOf = (tier: string, uid: string) => {
    for (const s of MOCK_SECTIONS) {
      const e = (pool.tiers as Record<string, Record<string, { uid: string; theme: string[] }[]>>)[tier]?.[s]?.find((x) => x.uid === uid);
      if (e) return e;
    }
    return undefined;
  };

  it.each(KNOWN_COLLISIONS)('$tier 的「$concept」撞題都有共同的主題鍵', ({ tier, uids }) => {
    const present = uids.map((uid) => entryOf(tier, uid)).filter((e) => e !== undefined);
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const a = present[i];
        const b = present[j];
        if (!a || !b) continue;
        expect(a.theme.filter((k) => b.theme.includes(k)), `${a.uid} ／ ${b.uid}`).not.toEqual([]);
      }
    }
  });

  it('白名單裡的單一中文字只比對到人工看過的主題', () => {
    for (const ch of SINGLE_CHAR_WHITELIST) {
      const only = compileAliases(Object.fromEntries(Object.entries(CONCEPT_ALIASES).map(([id, list]) => [id, list.filter((s) => s === ch)])));
      const matched = [...topics.values()].filter((t) => conceptIds(t.texts, only).length > 0).map((t) => t.topic ?? '');
      const unreviewed = [...new Set(matched)].filter((t) => !(REVIEWED_SINGLE_CHAR_TOPICS[ch] ?? []).includes(t));
      expect(unreviewed, `「${ch}」比對到新的主題，確認是同一個概念後加進 REVIEWED_SINGLE_CHAR_TOPICS`).toEqual([]);
    }
  });
});
