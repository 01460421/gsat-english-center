/**
 * [[題號]] 與 <u>／<b> 的解析、refers_to 高亮位置，以及依資料形狀決定題組的作答介面。
 */
import { groupText, locateRefersTo } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { Question, QuestionGroup } from '../../data/exams';
import { bankBlanksInPassage, clusterQuestions, groupLayout, isBlankCell } from './paper';
import {
  blankLabels,
  groupTextOffsets,
  parseRichText,
  questionRangeTitle,
  questionTitle,
  refersToHighlights,
  resolveBlankQuestion,
  splitByHighlights,
  type RichNode,
} from './richText';
import { MINI_EXAM } from './testFixtures';

/** 把節點攤平成純文字（空格記號照原樣），用來對照 @gsat/shared 的 groupText 座標。 */
function plain(nodes: readonly RichNode[]): string {
  return nodes.map((n) => (n.kind === 'text' ? n.text : n.kind === 'blank' ? `[[${n.label}]]` : plain(n.children))).join('');
}

function groupOf(id: string): QuestionGroup {
  for (const s of MINI_EXAM.sections) for (const g of s.groups) if (g.id === id) return g;
  throw new Error(`找不到題組 ${id}`);
}

describe('parseRichText', () => {
  it('[[題號]] 變成空格節點，前後文字保留', () => {
    const [p] = parseRichText('White rhinos, [[11]], do the same.');
    expect(p?.nodes).toEqual([
      { kind: 'text', text: 'White rhinos, ', start: 0 },
      { kind: 'blank', label: '11', start: 14 },
      { kind: 'text', text: ', do the same.', start: 20 },
    ]);
  });

  it('混合題子題的 [[47A]] 也認得', () => {
    expect(blankLabels('dream of [[47A]] and the [[47B]] of')).toEqual(['47A', '47B']);
    expect(blankLabels('a [[11]] b [[12]]')).toEqual(['11', '12']);
    expect(blankLabels(null)).toEqual([]);
  });

  it('依 "\\n" 分段，每段記下在純文字座標的起點（標記不算長度、空格記號算）', () => {
    const paragraphs = parseRichText('A <u>bold</u> [[1]].\nSecond.');
    expect(paragraphs.map((p) => p.start)).toEqual([0, 'A bold [[1]].'.length + 1]);
    expect(paragraphs[1]?.nodes).toEqual([{ kind: 'text', text: 'Second.', start: 14 }]);
  });

  it('<u>、<b> 變成標記節點，可以巢狀，裡面的空格也找得到', () => {
    const [p] = parseRichText('x <b>bold <u>under [[5]]</u></b> y');
    expect(p?.nodes).toEqual([
      { kind: 'text', text: 'x ', start: 0 },
      {
        kind: 'mark',
        tag: 'b',
        children: [
          { kind: 'text', text: 'bold ', start: 2 },
          { kind: 'mark', tag: 'u', children: [{ kind: 'text', text: 'under ', start: 7 }, { kind: 'blank', label: '5', start: 13 }] },
        ],
      },
      { kind: 'text', text: ' y', start: 18 },
    ]);
  });

  it('不認得的角括號當成一般文字（不會被當成 HTML）', () => {
    const [p] = parseRichText('a < b <script>alert(1)</script>');
    expect(plain(p?.nodes ?? [])).toBe('a < b <script>alert(1)</script>');
    expect(p?.nodes.every((n) => n.kind === 'text')).toBe(true);
  });

  it('沒有結尾的標記延續到行尾；多出來的結尾標記忽略', () => {
    const [p] = parseRichText('a <u>b c');
    expect(p?.nodes[1]).toEqual({ kind: 'mark', tag: 'u', children: [{ kind: 'text', text: 'b c', start: 2 }] });
    const [q] = parseRichText('a </b> c');
    expect(plain(q?.nodes ?? [])).toBe('a  c');
  });

  it('詩的分節（"\\n\\n"）產生空行', () => {
    const lines = parseRichText('Line one\nLine two\n\nNew stanza');
    expect(lines.map((l) => l.empty)).toEqual([false, false, true, false]);
  });
});

describe('空格對應題目', () => {
  const q = (no: number, label: string) => ({ no, label });

  it('先比 label，再比 no', () => {
    const questions = [q(47, '47A'), q(47, '47B'), q(48, '48')];
    expect(resolveBlankQuestion('47B', questions)?.label).toBe('47B');
    expect(resolveBlankQuestion('48', questions)?.label).toBe('48');
    // 47 有兩題（47A、47B），用 no 對不出唯一一題。
    expect(resolveBlankQuestion('47', questions)).toBeNull();
  });

  it('gsat-83 的文意選填：選文寫 [[1]]，題目 label 是「選填1」', () => {
    expect(resolveBlankQuestion('1', [q(1, '選填1'), q(2, '選填2')])?.label).toBe('選填1');
  });

  it('題號顯示', () => {
    expect(questionTitle('11')).toBe('第 11 題');
    expect(questionTitle('47A')).toBe('第 47A 題');
    expect(questionTitle('中譯英1')).toBe('中譯英1');
    expect(questionRangeTitle(['47', '48'])).toBe('第 47–48 題');
    expect(questionRangeTitle(['47A'])).toBe('第 47A 題');
  });
});

describe('refers_to 高亮', () => {
  it('位置與 @gsat/shared 的 groupText／locateRefersTo 一致', () => {
    const group = groupOf('s4g1');
    const [h] = refersToHighlights(group);
    expect(h).toEqual({ start: 50, end: 54, label: '40' });
    expect(groupText(group).slice(h?.start, h?.end)).toBe('them');
    // 解析出來的節點座標也要對得上：找出含有這個區間的文字節點並切開。
    const offsets = groupTextOffsets(group);
    const nodes = parseRichText(group.passage ?? '', offsets.passage ?? 0).flatMap((p) => p.nodes);
    const pieces = nodes.flatMap((n) => (n.kind === 'text' ? splitByHighlights(n.text, n.start, h ? [h] : []) : []));
    expect(pieces.filter((p) => p.highlight).map((p) => p.text)).toEqual(['them']);
  });

  it('多文本：passage_parts 的座標接在 passage 後面（以換行相接、去掉標記）', () => {
    const group: QuestionGroup = {
      ...groupOf('s5g1'),
      passage: 'Intro <b>it</b>.',
      questions: [],
    };
    const offsets = groupTextOffsets(group);
    expect(offsets.passage).toBe(0);
    expect(offsets.parts).toEqual(['Intro it.'.length + 1, 'Intro it.'.length + 1 + 'Recycled plastic sunglasses.'.length + 1]);
    const range = locateRefersTo(group, { text: 'Coffee', occurrence: 1 });
    expect(range?.[0]).toBe(offsets.parts[1]);
  });

  it('沒有 passage 時多文本從 0 開始（groupText 會略過空字串）', () => {
    const offsets = groupTextOffsets({ passage: null, passage_parts: [{ label: 'A', title: null, text: 'One.' }, { label: 'B', title: null, text: 'Two.' }] });
    expect(offsets).toEqual({ passage: null, parts: [0, 5] });
  });

  it('splitByHighlights：區間落在節點中間、跨節點、重疊', () => {
    const hs = [
      { start: 12, end: 15, label: '1' },
      { start: 13, end: 20, label: '2' },
    ];
    expect(splitByHighlights('0123456789', 10, hs)).toEqual([
      { text: '01', highlight: null },
      { text: '234', highlight: hs[0] },
      { text: '56789', highlight: hs[1] },
    ]);
    expect(splitByHighlights('abc', 0, hs)).toEqual([{ text: 'abc', highlight: null }]);
  });
});

describe('題組版面', () => {
  it('依資料形狀選作答介面', () => {
    expect(groupLayout(groupOf('s1g1'))).toBe('standard');
    expect(groupLayout(groupOf('s2g1'))).toBe('cloze');
    expect(groupLayout(groupOf('s3g1'))).toBe('bank');
    expect(groupLayout(groupOf('s4g1'))).toBe('standard');
    expect(groupLayout(groupOf('s5g1'))).toBe('standard');
  });

  it('句子配合題：有選項庫但選文沒有空格', () => {
    const group = { ...groupOf('s3g1'), passage: '' };
    expect(groupLayout(group)).toBe('bank');
    expect(bankBlanksInPassage(group)).toBe(false);
    expect(bankBlanksInPassage(groupOf('s3g1'))).toBe(true);
  });

  it('共用題幹、題幹有 [[題號]] 的填充題併成一組；其他題各自一題', () => {
    const items = clusterQuestions(groupOf('s5g1').questions);
    expect(items.map((i) => (i.kind === 'fill_cluster' ? i.questions.map((q) => q.label) : i.question.label))).toEqual([['47', '48'], '49']);
  });

  it('題幹只有 ______、沒有 [[題號]] 的填充題不併（ref-111 第 49 題）', () => {
    const q: Question = { no: 49, label: '49', mode: 'fill_in_blank', stem: 'It means “… if you don’t ______ .”', options: null, answer: 'x', accepted_answers: null, points: 2, stats: null, tags: {} };
    expect(clusterQuestions([q])).toEqual([{ kind: 'single', question: q }]);
  });

  it('表格的待填格', () => {
    expect(isBlankCell('______')).toBe(true);
    expect(isBlankCell(' __ ')).toBe(true);
    expect(isBlankCell('')).toBe(false);
    expect(isBlankCell('iron and vitamins')).toBe(false);
  });
});
