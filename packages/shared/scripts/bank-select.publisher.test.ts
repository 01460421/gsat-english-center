/**
 * bank-select.mjs 的出版社部分（docs/design/weak-paper.md §8.3、§8.4、§7.6）：下架清單收 data/publisher 的路徑、
 * selectPublisherGroups（版本、撤下、下架、來源停用與到期、契約檢查、D8）。
 * 用 tools/tests/data/publisher/pub-test 的兩個合成題組（站方自己寫的測試文字，不是任何出版社的內容），在暫存目錄造 repo。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEM_SOURCE_ID_PATTERN, PUBLISHER_FILENAME_PATTERN as SHARED_FILENAME, PUBLISHER_SCHEMA as SHARED_SCHEMA } from '../src/item-source';
import {
  BankSelectError,
  PUBLISHER_FILENAME_PATTERN,
  PUBLISHER_SCHEMA,
  SOURCE_ID_PATTERN,
  officialCorpus,
  publisherProblems,
  readUnpublish,
  selectPublisherGroups,
  selectWritingGroups,
  sourcePublishable,
} from './bank-select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DATA = path.join(HERE, '..', '..', '..', 'tools', 'tests', 'data');
const FIXTURE = path.join(TOOLS_DATA, 'publisher', 'pub-test');
const CZ = 'v1/cloze/advanced/pb.cz.5a6b7c@1.json';
const MX = 'v1/mixed/advanced/pb.mx.7a8b9c@1.json';

type Json = Record<string, any>;
const read = (rel: string): Json => JSON.parse(readFileSync(path.join(FIXTURE, rel), 'utf8')) as Json;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PUB = { id: 'pub-test', ns: 'pb', active: true, ends_on: '2027-12-31', scope: ['web', 'pdf', 'ai_assist'] };
const answerKey = (raw: Json) => JSON.stringify((raw.group?.questions ?? []).map((q: Json) => [q.label, q.answer, q.accepted_answers ?? null]));

/** 暫存 repo：data/publisher/pub-test/v1/…（兩個合成題組）＋ data/bank/v1 的一個寫作範例（寫作選題照常要成功）。 */
function repo(options: { unpublish?: string; extra?: Array<{ rel: string; raw: Json | string }> } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'publisher-select-'));
  dirs.push(root);
  const pubDir = path.join(root, 'data', 'publisher');
  cpSync(FIXTURE, path.join(pubDir, 'pub-test'), { recursive: true });
  for (const e of options.extra ?? []) {
    const file = path.join(pubDir, e.rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof e.raw === 'string' ? e.raw : JSON.stringify(e.raw));
  }
  const tr = JSON.parse(readFileSync(path.join(TOOLS_DATA, 'ai.tr.0b1c2d@1.json'), 'utf8')) as Json;
  tr.status = 'verified';
  const trDir = path.join(root, 'data', 'bank', 'v1', 'translation', 'basic');
  mkdirSync(trDir, { recursive: true });
  writeFileSync(path.join(trDir, 'ai.tr.0b1c2d@1.json'), JSON.stringify(tr));
  if (options.unpublish !== undefined) writeFileSync(path.join(root, 'data', 'unpublish.jsonl'), options.unpublish);
  const unpublishFile = path.join(root, 'data', 'unpublish.jsonl');
  const select = (opts: { sources?: Json[]; today?: string; exams?: Json[] } = {}) =>
    selectPublisherGroups(pubDir, {
      sources: (opts.sources ?? [PUB]) as never,
      today: opts.today ?? '2026-11-02',
      corpus: officialCorpus(opts.exams ?? []),
      contentKey: answerKey,
      unpublished: readUnpublish(unpublishFile, { repoRoot: root }),
      repoRoot: root,
      relative: (f) => path.relative(root, f),
    });
  return { root, pubDir, unpublishFile, select };
}

const ids = (r: { chosen: Array<{ uid: string; version: number }> }) => r.chosen.map((c) => `${c.uid}@${c.version}`);
const reasons = (r: { skipped: Array<{ file: string; reason: string }> }) => r.skipped.map((s) => [path.basename(s.file), s.reason]).sort();

describe('格式常數和 shared 的 item-source.ts 一致', () => {
  it('schema、檔名、來源 id', () => {
    expect(PUBLISHER_SCHEMA).toBe(SHARED_SCHEMA);
    expect(PUBLISHER_FILENAME_PATTERN.source).toBe(SHARED_FILENAME.source);
    expect(SOURCE_ID_PATTERN.source).toBe(ITEM_SOURCE_ID_PATTERN.source);
  });
});

describe('sourcePublishable（fail closed）', () => {
  it('停用、過了到期日（到期日當天仍可）、授權不含 web、不是出版社來源：都不發布', () => {
    expect(sourcePublishable(PUB, '2027-12-31')).toBe(true);
    expect(sourcePublishable(PUB, '2028-01-01')).toBe(false);
    expect(sourcePublishable({ ...PUB, active: false }, '2026-11-02')).toBe(false);
    expect(sourcePublishable({ ...PUB, scope: ['pdf'] }, '2026-11-02')).toBe(false);
    expect(sourcePublishable({ ...PUB, ns: 'ai' }, '2026-11-02')).toBe(false);
    expect(sourcePublishable({ ...PUB, ends_on: null }, '2099-01-01')).toBe(true);
  });
});

describe('selectPublisherGroups', () => {
  it('合成題組都通過：依題型、難度、uid 排序，bySource 計數', () => {
    const r = repo().select();
    expect(ids(r)).toEqual(['pb.cz.5a6b7c@1', 'pb.mx.7a8b9c@1']);
    expect(r.bySource).toEqual({ 'pub-test': 2 });
    expect(r.warnings).toEqual([]);
    expect(r.inputs.map((f) => path.basename(f))).toEqual(['pb.cz.5a6b7c@1.json', 'pb.mx.7a8b9c@1.json']);
  });

  it('data/publisher 不存在：空的結果', () => {
    expect(selectPublisherGroups('/nonexistent/publisher', { sources: [], today: '2026-11-02', corpus: officialCorpus([]), contentKey: answerKey })).toEqual({
      chosen: [],
      skipped: [],
      warnings: [],
      inputs: [],
      scanned: 0,
      bySource: {},
    });
  });

  it('兩個出版社來源用了同一個 uid（不論狀態）：建置失敗，不會出兩筆同 uid 的條目', () => {
    const PUB_B = { ...PUB, id: 'pub-b' };
    const { select } = repo({ extra: [{ rel: `pub-b/${CZ}`, raw: { ...read(CZ) } }] });
    expect(() => select({ sources: [PUB, PUB_B] })).toThrow(BankSelectError);
    expect(() => select({ sources: [PUB, PUB_B] })).toThrow(/pb\.cz\.5a6b7c 同時出現在出版社來源 pub-b 與 pub-test|pb\.cz\.5a6b7c 同時出現在出版社來源 pub-test 與 pub-b/);
    // 其中一個來源停用也一樣（不論狀態都檢查）。
    expect(() => select({ sources: [PUB, { ...PUB_B, active: false }] })).toThrow(BankSelectError);
    // 不同 uid 的兩個來源照常發布。
    const ok = repo({ extra: [{ rel: `pub-b/v1/cloze/advanced/pb.cz.000001@1.json`, raw: { ...read(CZ), uid: 'pb.cz.000001' } }] });
    expect(() => ok.select({ sources: [PUB, PUB_B] })).not.toThrow();
  });

  it('來源停用或到期：整個來源都不發布（source_inactive），不必重新匯入', () => {
    for (const opts of [{ sources: [{ ...PUB, active: false }] }, { today: '2028-01-01' }, { sources: [{ ...PUB, scope: ['pdf'] }] }]) {
      const r = repo().select(opts);
      expect(ids(r)).toEqual([]);
      expect(reasons(r)).toEqual([
        ['pb.cz.5a6b7c@1.json', 'source_inactive'],
        ['pb.mx.7a8b9c@1.json', 'source_inactive'],
      ]);
    }
  });

  it('目錄的來源不在登記檔：丟錯（登記檔是授權的唯一依據）', () => {
    expect(() => repo().select({ sources: [] })).toThrow(BankSelectError);
    expect(() => repo().select({ sources: [{ ...PUB, ns: 'ai' }] })).toThrow(/不在 data\/sources\.json/);
  });

  it('每個 uid 取最大的 verified 版本；較新的 draft 改了答案就撤下舊版', () => {
    const v2 = read(CZ);
    v2.version = 2;
    const draft = read(CZ);
    draft.version = 3;
    draft.status = 'draft';
    draft.group.questions[0].answer = 'B';
    const ok = repo({ extra: [{ rel: 'pub-test/v1/cloze/advanced/pb.cz.5a6b7c@2.json', raw: v2 }] }).select();
    expect(ids(ok)).toEqual(['pb.cz.5a6b7c@2', 'pb.mx.7a8b9c@1']);
    expect(reasons(ok)).toContainEqual(['pb.cz.5a6b7c@1.json', 'older_version']);
    const withdrawn = repo({
      extra: [
        { rel: 'pub-test/v1/cloze/advanced/pb.cz.5a6b7c@2.json', raw: v2 },
        { rel: 'pub-test/v1/cloze/advanced/pb.cz.5a6b7c@3.json', raw: draft },
      ],
    }).select();
    expect(ids(withdrawn)).toEqual(['pb.mx.7a8b9c@1']);
    expect(reasons(withdrawn)).toContainEqual(['pb.cz.5a6b7c@2.json', 'withdrawn']);
  });

  it('契約檢查：open_key 不是 complete、授權、人工檢查紀錄、source_id、原卷位置', () => {
    const cases: Array<[string, (raw: Json) => void, string]> = [
      [MX, (raw) => (raw.open_key = 'listed'), 'bad_shape'],
      [MX, (raw) => delete raw.open_key, 'bad_shape'],
      [CZ, (raw) => (raw.open_key = 'complete'), 'bad_shape'],
      [CZ, (raw) => (raw.provenance.license = 'original-ai'), 'license'],
      [CZ, (raw) => (raw.provenance.derivation = 'adapted'), 'license'],
      [CZ, (raw) => (raw.review.checks = ['tier']), 'not_reviewed'],
      [CZ, (raw) => delete raw.review, 'not_reviewed'],
      [CZ, (raw) => (raw.source_id = 'pub-other'), 'bad_source'],
      [CZ, (raw) => (raw.source_ref = { paper: '第一回', labels: [] }), 'bad_shape'],
      [CZ, (raw) => (raw.tier_basis = 'gut'), 'bad_shape'],
      [CZ, (raw) => (raw.tag_basis = 'ai'), 'bad_shape'],
      [CZ, (raw) => (raw.explanation_basis = 'publisher'), 'bad_shape'],
      [MX, (raw) => (raw.explanation_basis = null), 'bad_shape'],
      [CZ, (raw) => (raw.skill_extra = { '1': { item_type: 'x' } }), 'bad_shape'],
      [MX, (raw) => (raw.scoring_extra = { '1': { partial_credit_forms: [] } }), 'bad_shape'],
      [CZ, (raw) => (raw.tier = 'basic'), 'bad_shape'],
    ];
    for (const [rel, mutate, reason] of cases) {
      const raw = read(rel);
      mutate(raw);
      const r = repo({ extra: [{ rel: `pub-test/${rel}`, raw }] }).select();
      expect(reasons(r), `${rel} ${mutate.toString()}`).toContainEqual([path.basename(rel), reason]);
      expect(r.warnings.some((w) => w.includes('不發布')), mutate.toString()).toBe(true);
    }
    expect(publisherProblems(read(CZ), { sourceId: 'pub-test', uid: 'pb.cz.5a6b7c', version: 1, file: path.join(FIXTURE, CZ) })).toEqual([]);
  });

  it('D8：題組或 scoring_extra 含官方譯文、評分原則的片段就不發布（警告不印官方文字）', () => {
    const official = 'Many students find it difficult to balance schoolwork and part-time jobs these days.';
    const exams = [{ sections: [{ groups: [{ questions: [{ mode: 'translation', answer: official, stem: '中文' }] }] }] }];
    const raw = read(CZ);
    raw.group.passage = `${raw.group.passage} ${official}`;
    const r = repo({ extra: [{ rel: `pub-test/${CZ}`, raw }] }).select({ exams });
    expect(ids(r)).toEqual(['pb.mx.7a8b9c@1']);
    expect(reasons(r)).toContainEqual(['pb.cz.5a6b7c@1.json', 'd8_overlap']);
    expect(r.warnings.join('\n')).not.toContain(official);
    const mx = read(MX);
    mx.scoring_extra['1'].partial_credit_forms = [official];
    const r2 = repo({ extra: [{ rel: `pub-test/${MX}`, raw: mx }] }).select({ exams });
    expect(reasons(r2)).toContainEqual(['pb.mx.7a8b9c@1.json', 'd8_overlap']);
  });
});

describe('下架清單收出版社路徑（§8.4）', () => {
  const line = (p: string) => JSON.stringify({ path: p, date: '2026-11-02', reason: '人工審核退回：測試' });
  const PB_PATH = `data/publisher/pub-test/${MX}`;

  it('登記 pb 題組之後：readUnpublish、selectPublisherGroups、selectWritingGroups 都成功，那一組不再發布', () => {
    const { select, root, unpublishFile } = repo({ unpublish: `${line(PB_PATH)}\n` });
    expect([...readUnpublish(unpublishFile, { repoRoot: root }).keys()]).toEqual([PB_PATH]);
    const r = select();
    expect(ids(r)).toEqual(['pb.cz.5a6b7c@1']);
    expect(reasons(r)).toContainEqual(['pb.mx.7a8b9c@1.json', 'unpublished']);
    const writing = selectWritingGroups(path.join(root, 'data', 'bank', 'v1'), { exams: [], unpublishFile, repoRoot: root });
    expect(writing.chosen.map((c) => c.uid)).toEqual(['ai.tr.0b1c2d']);
  });

  it('出版社路徑的格式錯、檔案不存在：一樣丟錯（fail closed）', () => {
    for (const [p, msg] of [
      ['data/publisher/pub-test/v1/mixed/advanced/pb.mx.ffffff@1.json', /不存在/],
      ['data/publisher/Pub_Test/v1/mixed/advanced/pb.mx.7a8b9c@1.json', /path 必須是/],
      ['data/publisher/pub-test/mixed/advanced/pb.mx.7a8b9c@1.json', /path 必須是/],
      ['data/publisher/pub-test/v1/mixed/advanced/ai.mx.7a8b9c@1.json', /path 必須是/],
    ] as const) {
      const { root, unpublishFile } = repo({ unpublish: line(p) });
      expect(() => readUnpublish(unpublishFile, { repoRoot: root }), p).toThrow(msg);
    }
  });
});
