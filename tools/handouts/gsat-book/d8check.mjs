// 講義各單元的文字 × 官方文字（參考譯文、評分原則等）的重疊檢查；只印本站文字的位置與片段，不印官方文字。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { officialCorpus, d8HitsInStrings } from '/home/user/zh-ai/packages/shared/scripts/bank-select.mjs';

const EX = '/home/user/zh-ai/data/exams/parsed';
const exams = readdirSync(EX).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${EX}/${f}`, 'utf8')));
const corpus = officialCorpus(exams);
const PARTS = '/tmp/claude-0/book/parts';
let total = 0;
for (const f of readdirSync(PARTS).filter((x) => x.endsWith('.html')).sort()) {
  const html = readFileSync(`${PARTS}/${f}`, 'utf8');
  // 以區塊元素切段，去標籤
  const blocks = html
    .replace(/<(\/?)(p|li|div|td|th|h[1-6]|section|span class="(?:en|zh|why)")[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const hits = d8HitsInStrings(blocks, corpus);
  for (const h of hits) {
    total++;
    console.log(`HIT ${f} [${h.kind}] ${blocks[h.index].slice(0, 120)}`);
  }
}
console.log(`total hits: ${total}`);
