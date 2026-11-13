// 檢查單元內所有公式能否排版：node mathcheck.mjs 檔案...
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const katex = require('katex'); require('katex/contrib/mhchem');
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
let n = 0, bad = 0;
for (const f of process.argv.slice(2)) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/<(span|div) class="(m|mb)">([\s\S]*?)<\/\1>/g)) {
    n++;
    try { katex.renderToString(ent(m[3]), { displayMode: m[2] === 'mb', throwOnError: true, strict: 'ignore' }); }
    catch (e) { bad++; const line = t.slice(0, m.index).split('\n').length; console.log(`公式錯誤（${f.split('/').pop()} 第 ${line} 行）：${m[3].slice(0, 70)} → ${e.message.slice(0, 90)}`); }
  }
}
console.log(`MATH ${n} ${bad}`);
