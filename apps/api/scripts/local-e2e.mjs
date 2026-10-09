#!/usr/bin/env node
/**
 * 本機端對端測試：wrangler dev（本機 D1＋Queue）＋假 Google＋假 Anthropic，跑完「登入 → 同意 → AI 批改 → 後台核准 →
 * 額度用完 → 登出所有裝置」的完整流程。負責：整合者（docs/design/ai-auth-mvp.md §10「整合」）。
 *
 * 用法：npm run test:local-e2e -w @gsat/api（或在 apps/api 下 node scripts/local-e2e.mjs；E2E_VERBOSE=1 會同步印出 wrangler 的輸出）。
 *
 * 不需要任何真金鑰、不連外網：
 *   - 假 Google（本機 HTTP）：/auth 直接帶授權碼跳回回呼網址（模擬使用者選了帳號）、/token 回 id_token
 *     （不簽章：Worker 是用 client secret 直連 token 端點換來的，只驗 claims，見 src/auth/oauth.ts）。
 *   - 假 Anthropic（本機 HTTP）：/v1/messages 依請求內容回 SSE 串流的結構化輸出（系統提示判斷任務與評分框架、
 *     <student_text> 取學生文字）；可以排一次 429（SDK 自動重試）與一次拒答；同時檢查 ARCHITECTURE §6.2 的呼叫規則
 *     與「送出的內容不含 email、暱稱、帳號 id」。
 *   - 機密用暫存的 env 檔（--env-file，權限 600，結束時刪除）、端點與允許來源用 --var 傳給 wrangler dev。
 *     有 --env-file 時 wrangler 不讀 apps/api/.dev.vars，站主本機的真金鑰不會被用到。
 *   - D1 與 Queue 的本機狀態放在暫存目錄（--persist-to）：每次都是全新的資料庫，結束時刪除；不動 .wrangler/state。
 * 結束時（成功、失敗、Ctrl-C）一律關掉 wrangler／workerd（整個行程群組）與兩個假伺服器，並刪掉暫存目錄。
 *
 * 文字內容（學生作答、作文、手寫轉錄）都是本站自己寫的練習句，不是官方參考譯文或範文（D8）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
/** wrangler 的 CLI 入口（bin/wrangler.js 不在 exports 裡，從 package.json 的位置與 bin 欄位推）。 */
const WRANGLER = (() => {
  const pkgPath = require.resolve('wrangler/package.json', { paths: [API_DIR] });
  return join(dirname(pkgPath), require(pkgPath).bin.wrangler);
})();
const VERBOSE = process.env.E2E_VERBOSE === '1';

/** 題目庫裡的題組（scripts/build-writing-prompts.mjs 產生；115 學測，中譯英 2 句各 4 分、作文要求 2 段）。 */
const TRANSLATION_GROUP = 'gsat-115.s7g1@1';
const ESSAY_GROUP = 'gsat-115.s8g1@1';
const MODEL = 'claude-opus-5-5';
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** 管理員與一般學生的 Google 帳號（假的；暱稱用不會出現在提示詞裡的字串，方便檢查有沒有送給 Claude）。 */
const ADMIN = { email: 'e2e-owner@example.com', name: '整合測試站主甲' };
const STUDENT = { email: 'e2e-student@example.com', name: '整合測試學生乙', nickname: '整合測試小乙' };

// ───────────────────────── 測試資料（本站自己寫的句子） ─────────────────────────

/**
 * 中譯英作答（故意有錯）：第 1 句主詞單複數；第 2 句句首小寫、句尾沒有句號、english 小寫、activity 單複數。
 * 程式計分（scoring.ts）的預期：
 *   第一位（analytic，報 3 個錯）：第 1 句 4−0.5＝3.5；第 2 句 4−0.5−0.5＝3，再扣大小寫 0.5、標點 0.5 → 2；合計 5.5
 *   第二位（holistic，只報 2 個文法錯）：第 1 句 3.5；第 2 句 3.5−1＝2.5；合計 6
 *   平均 5.75，各句 [3.5, 2.25]
 */
const TRANSLATION_ANSWER = [
  'Nowadays more high school English teacher has raised how often they speak English in class.',
  'they put students in groups by their english level and do many listening and speaking activity',
];
const EXPECTED_TRANSLATION = { analytic: 5.5, holistic: 6, final: 5.75, sentences: [3.5, 2.25] };

/** 假評分者會「找到」的錯誤（依請求裡的學生文字比對；analytic 全報、holistic 只報文法）。 */
const TRANSLATION_MISTAKES = [
  { pattern: /\bteacher has\b/, category: 'grammar', suggestion: 'teachers have', explanation_zh: '主詞是複數 teachers，動詞要用 have。', holistic: true },
  { pattern: /\benglish\b/, category: 'other', suggestion: 'English', explanation_zh: '語言名稱的第一個字母要大寫。', holistic: false },
  { pattern: /\bactivity\b/, category: 'grammar', suggestion: 'activities', explanation_zh: 'many 後面要接複數名詞。', holistic: true },
];

/** 打字作文（兩段、126 個字）。 */
const TYPED_ESSAY = [
  'In the three pictures, we can see how the role of pets has changed. In the first picture, a man carries a small dog on his shoulder while a woman pushes two dogs in a stroller, just like parents taking children for a walk. The last picture shows a couple feeding a puppy with a spoon at home, as if the dog were their baby.',
  'I think this happens for two reasons. First, many young people in Taiwan live alone and feel lonely after work, so a pet gives them comfort. Second, raising a child is expensive, so some couples choose to keep a dog instead. This trend can make people happier, but it may also lead owners to spend too much money on their pets.',
].join('\n\n');

/** 手寫作文的轉錄（假 OCR 回這份；一處看不清楚 [[?]]，候選字 children／child）。 */
const HANDWRITTEN_LINES = [
  [
    'The pictures show that many people in Taiwan now treat',
    'their pets as family members. Some owners push dogs in',
    'strollers, and a young couple even feeds a puppy with a spoon,',
    'just as other parents feed their baby at the dinner table.',
    'Pets are not just animals that guard the house anymore.',
  ],
  [
    'In my opinion, this trend has two main causes. First,',
    'many young adults live alone in big cities, so a pet keeps',
    'them company after a long day of work. Second, raising [[?]]',
    'costs a lot, so some couples decide to raise a dog instead.',
    'This change can make people happier, but owners should also',
    'remember that pets need time, money, and patience every day.',
  ],
];
const OCR_TEXT = HANDWRITTEN_LINES.map((lines) => lines.join('\n')).join('\n\n');
const CONFIRMED_TEXT = OCR_TEXT.replace('[[?]]', 'children');

/**
 * 作文的假分數：第一位四項 4／3／3／4（14）、第二位 3／3／3／3（12），第二位的 holistic_total 故意寫 20
 * （程式不採用 AI 給的總分）。兩篇都 ≥100 字、2 段，不扣分 → 平均 13、等級 fair。
 */
const ESSAY_ANALYTIC_SCORES = { content: 4, organization: 3, grammar: 3, vocabulary: 4 };
const ESSAY_HOLISTIC_SCORES = { content: 3, organization: 3, grammar: 3, vocabulary: 3 };
const EXPECTED_ESSAY = { analytic: 14, holistic: 12, final: 13, band: 'fair', criteria: { content: 3.5, organization: 3, grammar: 3, vocabulary: 3.5 } };
/** 作文裡假評分者會引用的片段（第一個找得到的；程式要在原文裡找出位置）。 */
const ESSAY_EXCERPTS = ['feel lonely after work', 'raise a dog instead'];

/** 點數（AI_TASK_POINTS）與預設額度（wrangler.toml）。 */
const POINTS = { translation_grade: 3, essay_grade: 7, essay_ocr: 2 };
const STUDENT_DAY_LIMIT = 30;

/** 最小的合法 JPEG（含 APP1／EXIF 區段，伺服器存檔前要剝掉；長邊 1600 px）。 */
function tinyJpeg(width, height, fill) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const exif = [...Buffer.from('Exif\0\0GPS-E2E')];
  const app1 = [0xff, 0xe1, 0x00, exif.length + 2, ...exif];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...sof0, ...sos, ...new Array(64).fill(fill), 0xff, 0xd9]);
}

// ───────────────────────── 小工具 ─────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, message) {
  if (!cond) throw new Error(message);
}

function same(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}：預期 ${e}，實際 ${a}`);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** 找一個沒被占用的埠（給 wrangler dev 與 inspector；假伺服器直接 listen(0)）。 */
function freePort() {
  return new Promise((ok, fail) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/** 關掉假伺服器（workerd 的 keep-alive 連線也一起切斷，否則 close() 會一直等）。 */
function closeServer(server) {
  return new Promise((ok) => {
    server.close(() => ok());
    server.closeAllConnections?.();
    setTimeout(ok, 2_000).unref();
  });
}

function listen(server) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok(server.address().port));
  });
}

/** 只保留最後 N 行的輸出緩衝（失敗時印出 wrangler 的尾巴）。 */
class RingLog {
  constructor(max = 600) {
    this.max = max;
    this.lines = [];
    this.all = '';
    this.partial = '';
  }
  push(chunk) {
    const text = chunk.toString();
    this.all += text;
    if (this.all.length > 4_000_000) this.all = this.all.slice(-2_000_000);
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim() === '') continue;
      this.lines.push(line);
      if (this.lines.length > this.max) this.lines.shift();
      if (VERBOSE) process.stdout.write(`    │ ${line}\n`);
    }
  }
  tail(n = 80) {
    return this.lines.slice(-n).join('\n');
  }
}

// ───────────────────────── cookie 與 HTTP ─────────────────────────

/** 最小的 cookie jar：只有一個主機（Worker），不管 Domain／Path；Max-Age≤0、過期或空值就刪掉。 */
class CookieJar {
  constructor(entries = []) {
    this.cookies = new Map(entries);
  }
  clone() {
    return new CookieJar(this.cookies);
  }
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const attr = {};
      for (const a of attrs) {
        const [k, ...v] = a.trim().split('=');
        attr[k.toLowerCase()] = v.join('=');
      }
      const expired = attr['max-age'] !== undefined ? Number(attr['max-age']) <= 0 : attr.expires ? Date.parse(attr.expires) <= Date.now() : false;
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  get(name) {
    return this.cookies.get(name);
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** 呼叫 Worker：json 送 JSON、raw 原樣送（FormData、位元組）；非 GET 和瀏覽器一樣帶 Origin；不自動跟隨轉址。 */
async function http(base, method, path, { jar, json, raw, headers = {} } = {}) {
  const h = { ...headers };
  const cookie = jar?.header();
  if (cookie) h.Cookie = cookie;
  let body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    body = raw;
  }
  if (method !== 'GET' && method !== 'HEAD' && !h.Origin) h.Origin = base;
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  jar?.store(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, text, json: data };
}

function expectStatus(res, status, label) {
  if (res.status !== status) throw new Error(`${label}：預期 HTTP ${status}，實際 ${res.status} ${res.text.slice(0, 400)}`);
}

function expectError(res, status, code, label) {
  expectStatus(res, status, label);
  if (res.json?.error?.code !== code) throw new Error(`${label}：預期錯誤碼 ${code}，實際 ${res.text.slice(0, 300)}`);
}

// ───────────────────────── 假 Google ─────────────────────────

/**
 * 假 Google OAuth：
 *   GET  /auth   檢查授權參數，記下 nonce 與 redirect_uri，302 回 redirect_uri?code=&state=
 *                （測試腳本另外帶 e2e_email、e2e_name 指定「使用者選了哪個帳號」）
 *   POST /token  檢查 client_id／secret、授權碼（只能用一次）、redirect_uri 一致，回 { id_token, … }
 */
async function startFakeGoogle({ clientId, clientSecret }) {
  const state = { problems: [], authorizations: 0, tokens: 0, base: '' };
  const codes = new Map();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/auth') {
        const p = url.searchParams;
        const problems = [];
        if (p.get('client_id') !== clientId) problems.push('client_id 不符');
        if (p.get('response_type') !== 'code') problems.push('response_type 不是 code');
        if (p.get('scope') !== 'openid email profile') problems.push(`scope=${p.get('scope')}`);
        if (p.get('prompt') !== 'select_account') problems.push('沒有 prompt=select_account');
        if (!p.get('state') || !p.get('nonce') || !p.get('redirect_uri')) problems.push('缺少 state／nonce／redirect_uri');
        if (problems.length > 0) {
          state.problems.push(...problems.map((x) => `授權請求：${x}`));
          res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
          return;
        }
        const email = p.get('e2e_email') ?? 'nobody@example.com';
        const code = `e2e-code-${randomUUID()}`;
        codes.set(code, {
          email,
          name: p.get('e2e_name'),
          nonce: p.get('nonce'),
          redirectUri: p.get('redirect_uri'),
          verified: p.get('e2e_unverified') !== '1',
        });
        state.authorizations++;
        const back = new URL(p.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', p.get('state'));
        res.writeHead(302, { location: back.toString() }).end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams((await readBody(req)).toString());
        const grant = codes.get(form.get('code') ?? '');
        const problems = [];
        if (form.get('grant_type') !== 'authorization_code') problems.push('grant_type 不是 authorization_code');
        if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) problems.push('client_id／client_secret 不符');
        if (!grant) problems.push('授權碼不存在或已用過');
        else if (form.get('redirect_uri') !== grant.redirectUri) problems.push('redirect_uri 和授權時不同');
        if (problems.length > 0) {
          state.problems.push(...problems.map((x) => `token 請求：${x}`));
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        codes.delete(form.get('code'));
        state.tokens++;
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          iss: 'https://accounts.google.com',
          azp: clientId,
          aud: clientId,
          sub: `e2e-${createHash('sha256').update(grant.email).digest('hex').slice(0, 21)}`,
          email: grant.email,
          email_verified: grant.verified,
          name: grant.name,
          nonce: grant.nonce,
          iat: now,
          exp: now + 3600,
        };
        const idToken = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.${b64url('e2e-signature')}`;
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ access_token: 'e2e-access-token', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: idToken }));
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      state.problems.push(`假 Google 處理失敗：${err.message}`);
      res.writeHead(500).end();
    }
  });
  const port = await listen(server);
  state.base = `http://127.0.0.1:${port}`;
  return { server, state };
}

// ───────────────────────── 假 Anthropic ─────────────────────────

function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 回一個完整的 SSE 串流（message_start → 文字 → message_delta → message_stop），格式同 test/helpers/anthropic.ts。 */
function writeSse(res, text, { stopReason = 'end_turn', refusalCategory = null, inputTokens = 1500, outputTokens = 600 } = {}) {
  const message = {
    id: `msg_e2e_${randomUUID().slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      iterations: null,
    },
  };
  const chunks = [sseEvent('message_start', { type: 'message_start', message })];
  chunks.push(sseEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  const mid = Math.floor(text.length / 2);
  for (const part of [text.slice(0, mid), text.slice(mid)]) {
    if (part) chunks.push(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }));
  }
  chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }));
  chunks.push(
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
        stop_details: stopReason === 'refusal' ? { type: 'refusal', category: refusalCategory ?? 'cyber', explanation: null } : null,
      },
      usage: { output_tokens: outputTokens },
    }),
  );
  chunks.push(sseEvent('message_stop', { type: 'message_stop' }));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': `req_e2e_${randomUUID().slice(0, 8)}` });
  res.end(chunks.join(''));
}

/** <student_text …> 標籤裡的文字（studentTextBlock 的格式：開標籤、換行、內容、換行、關標籤）。 */
function studentTexts(userText) {
  return [...userText.matchAll(/<student_text[^>]*>\n([\s\S]*?)\n<\/student_text>/g)].map((m) => m[1]);
}

/** 把一句英文依字數切成 4 個連續的部分（假評分者的語意單位）。 */
function fourParts(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const size = Math.ceil(words.length / 4);
  return [0, 1, 2, 3].map((i) => ({ text: words.slice(i * size, (i + 1) * size).join(' ') }));
}

function partOf(sentence, index) {
  const wordIndex = sentence.slice(0, index).split(/\s+/).filter(Boolean).length;
  const size = Math.ceil(sentence.split(/\s+/).filter(Boolean).length / 4);
  return Math.min(4, Math.floor(wordIndex / size) + 1);
}

function translationOutput(framework, sentences, allMissing) {
  const errors = [];
  const out = sentences.map((s, i) => {
    let corrected = s;
    if (!allMissing) {
      for (const m of TRANSLATION_MISTAKES) {
        if (framework === 'holistic' && !m.holistic) continue;
        const hit = m.pattern.exec(s);
        if (!hit) continue;
        errors.push({
          sentence_index: i,
          part: partOf(s, hit.index),
          category: m.category,
          excerpt: hit[0],
          explanation_zh: m.explanation_zh,
          suggestion: m.suggestion,
          repeat_of: null,
        });
        corrected = corrected.replace(m.pattern, m.suggestion);
      }
    }
    corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
    if (!/[.!?]$/.test(corrected)) corrected += '.';
    const parts = fourParts(s).map((p, k) => ({ part: k + 1, source_zh: `第 ${k + 1} 個語意單位`, student_excerpt: allMissing ? '' : p.text, missing: allMissing }));
    const explanation = allMissing ? '這句沒有表達出中文的意思。' : '大致達意，注意單複數與大小寫。';
    return framework === 'holistic'
      ? { sentence_index: i, explanation_zh: explanation, parts, corrected }
      : { sentence_index: i, parts, corrected, explanation_zh: explanation };
  });
  return { sentences: out, errors };
}

function essayOutput(framework, essay) {
  const paragraphs = essay.split(/\n[ \t]*\n+/).filter((p) => p.trim() !== '');
  if (framework === 'holistic') {
    // holistic_total 故意和四項加總不同：程式只用四項加總（AI 給的總分不採用）。
    return { holistic_total: 20, off_topic: false, scores: { ...ESSAY_HOLISTIC_SCORES }, comment_zh: '內容完整，句型可以再多變化。', safety_flag: 'none' };
  }
  const excerpt = ESSAY_EXCERPTS.find((e) => essay.includes(e)) ?? paragraphs.at(-1).split(/\s+/).slice(0, 3).join(' ');
  return {
    off_topic: false,
    criteria: {
      content: { score: ESSAY_ANALYTIC_SCORES.content, explanation_zh: '有描述圖片，也說明了原因與影響。' },
      organization: { score: ESSAY_ANALYTIC_SCORES.organization, explanation_zh: '分成兩段，段落重點清楚，轉承可以再自然一點。' },
      grammar: { score: ESSAY_ANALYTIC_SCORES.grammar, explanation_zh: '大致正確，偶有小錯。' },
      vocabulary: { score: ESSAY_ANALYTIC_SCORES.vocabulary, explanation_zh: '用字恰當。' },
    },
    comment_zh: '整體表現不錯，第二段的例子可以更具體。',
    top_improvements: ['第二段加一個具體的例子', '多用轉承詞連接句子', '結尾句呼應主題'],
    paragraph_advice: paragraphs.map((_, i) => ({ paragraph_index: i, advice_zh: `第 ${i + 1} 段可以再加一個細節。` })),
    errors: [{ paragraph_index: paragraphs.length - 1, category: 'word_choice', excerpt, explanation_zh: '可以寫得更具體。', suggestion: `${excerpt} (more specific)` }],
    rewrite: null,
    safety_flag: 'none',
  };
}

function ocrOutput() {
  return {
    readable: true,
    paragraphs: HANDWRITTEN_LINES.map((lines) => ({
      lines: lines.map((text) => ({ text, unclear: text.includes('[[?]]') ? [{ candidates: ['children', 'child'] }] : [] })),
    })),
  };
}

/**
 * 假 Anthropic Messages API（只有 POST /v1/messages）。state.faults 依序排「下一個符合條件的請求」要怎麼失敗；
 * state.gapNext 讓下一個中譯英的第二位評分者把每個部分都判成漏譯（兩位差距 >2，觸發第三位）。
 */
async function startFakeAnthropic({ apiKey }) {
  const state = { requests: [], problems: [], faults: [], served: { ok: 0, rate_limited: 0, refusal: 0 }, gapNext: false, forbidden: new Set(), base: '' };
  const server = createServer(async (req, res) => {
    try {
      const raw = (await readBody(req)).toString();
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
        state.problems.push(`未預期的請求 ${req.method} ${url.pathname}`);
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
        return;
      }
      const body = JSON.parse(raw);
      const system = Array.isArray(body.system) ? String(body.system[0]?.text ?? '') : String(body.system ?? '');
      const content = body.messages?.[0]?.content;
      const userText = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
      const images = Array.isArray(content) ? content.filter((b) => b.type === 'image') : [];
      const task = system.includes('careful transcriber')
        ? 'ocr'
        : system.includes('Chinese-to-English translation')
          ? 'translation'
          : system.includes('English essay')
            ? 'essay'
            : 'unknown';
      const framework = task === 'ocr' ? 'ocr' : system.includes('independent second grader') ? 'holistic' : 'analytic';
      const info = { task, framework, images: images.length, maxTokens: body.max_tokens, effort: body.output_config?.effort };
      state.requests.push(info);

      // ── ARCHITECTURE §6.2 呼叫規則（單元測試掃請求建構函式；這裡再看一次真的送出來的請求）──
      const p = (msg) => state.problems.push(`[${task}/${framework}] ${msg}`);
      if (req.headers['x-api-key'] !== apiKey) p('x-api-key 不是設定的金鑰');
      if (!req.headers['anthropic-version']) p('缺少 anthropic-version');
      if (!String(req.headers['anthropic-beta'] ?? '').includes(SERVER_FALLBACK_BETA)) p(`anthropic-beta 沒有 ${SERVER_FALLBACK_BETA}`);
      if (url.searchParams.get('beta') !== 'true') p('不是走 beta messages');
      if (body.model !== MODEL) p(`model=${body.model}`);
      if (body.stream !== true) p('不是串流請求');
      for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice', 'tools', 'metadata']) if (k in body) p(`不該送 ${k}`);
      if (!Number.isInteger(body.max_tokens) || body.max_tokens <= 0) p('max_tokens 不合法');
      if (body.output_config?.effort !== (task === 'ocr' ? 'low' : 'medium')) p(`effort=${body.output_config?.effort}`);
      if (body.output_config?.format?.type !== 'json_schema' || typeof body.output_config?.format?.schema !== 'object') p('沒有 json_schema 結構化輸出');
      if (body.fallbacks !== 'default') p('沒有 fallbacks: default');
      if (!Array.isArray(body.messages) || body.messages.length !== 1 || body.messages[0].role !== 'user') p('messages 必須只有一則 user');
      if (body.system?.[0]?.cache_control?.type !== 'ephemeral') p('系統提示沒有 cache_control');
      if (task === 'unknown') p('認不出是哪個任務');
      if (task !== 'ocr' && !userText.includes('<student_text')) p('學生文字沒有包在 <student_text>');
      for (const s of state.forbidden) if (raw.includes(s)) p(`請求含有身分資訊（${s.slice(0, 3)}…）`);
      if (task === 'ocr') {
        if (images.length === 0) p('OCR 沒有附照片');
        for (const img of images) {
          if (img.source?.type !== 'base64' || img.source?.media_type !== 'image/jpeg') p('照片格式不對');
          if (Buffer.from(img.source?.data ?? '', 'base64').includes(Buffer.from('Exif'))) p('照片的 EXIF 沒有被剝除');
        }
      }

      // ── 排定的失敗 ──
      const fi = state.faults.findIndex((f) => f.task === task);
      const fault = fi >= 0 ? state.faults.splice(fi, 1)[0].kind : null;
      if (fault === '429') {
        state.served.rate_limited++;
        res
          .writeHead(429, { 'content-type': 'application/json', 'retry-after-ms': '300', 'request-id': 'req_e2e_429' })
          .end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'e2e: rate limited, please retry' } }));
        return;
      }
      if (fault === 'refusal') {
        state.served.refusal++;
        writeSse(res, '', { stopReason: 'refusal', refusalCategory: 'cyber', outputTokens: 5 });
        return;
      }

      // ── 依請求內容產生結構化輸出 ──
      let output;
      if (task === 'translation') {
        const allMissing = framework === 'holistic' && state.gapNext;
        if (allMissing) state.gapNext = false;
        output = translationOutput(framework, studentTexts(userText), allMissing);
      } else if (task === 'essay') {
        output = essayOutput(framework, studentTexts(userText)[0] ?? '');
      } else if (task === 'ocr') {
        output = ocrOutput();
      } else {
        output = {};
      }
      state.served.ok++;
      writeSse(res, JSON.stringify(output));
    } catch (err) {
      state.problems.push(`假 Anthropic 處理失敗：${err.message}`);
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'e2e fake failed' } }));
    }
  });
  const port = await listen(server);
  state.base = `http://127.0.0.1:${port}`;
  return { server, state };
}

// ───────────────────────── 子行程與清理 ─────────────────────────

const cleanupTasks = [];
/** 清理只跑一次；之後的呼叫拿到同一個 promise，等它真的做完（否則 Ctrl-C 時主流程可能先 exit，暫存目錄沒刪）。 */
let cleanupPromise = null;
/** 收到 Ctrl-C／SIGTERM。 */
let interrupted = false;
/** 還活著的子行程群組（exit 事件裡同步補刀用）。 */
const liveGroups = new Set();

function cleanup() {
  cleanupPromise ??= (async () => {
    for (const task of cleanupTasks.reverse()) {
      try {
        await task();
      } catch (err) {
        console.error(`清理時發生錯誤：${err.message}`);
      }
    }
  })();
  return cleanupPromise;
}

function killGroup(pid, signal) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    else process.kill(-pid, signal);
  } catch {
    // 已經結束（ESRCH）。
  }
}

function groupAlive(pid) {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

process.on('exit', () => {
  for (const pid of liveGroups) killGroup(pid, 'SIGKILL');
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\n收到 ${sig}，正在關閉子行程…`);
    cleanup().finally(() => process.exit(130));
  });
}

/** wrangler 用的環境：不送統計、不讀 process.env 當機密、不帶 Cloudflare 帳號（本機模式用不到，也避免誤連正式帳號）。 */
function wranglerEnv() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of ['CLOUDFLARE_INCLUDE_PROCESS_ENV', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) delete env[k];
  return env;
}

/** 跑一次 wrangler 指令（遷移、查詢），等它結束；失敗丟錯並附上輸出。 */
function runWrangler(args, label) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], { cwd: API_DIR, env: wranglerEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    liveGroups.add(child.pid);
    const log = new RingLog(200);
    let stdout = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
      log.push(c);
    });
    child.stderr.on('data', (c) => log.push(c));
    const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      liveGroups.delete(child.pid);
      if (code === 0) ok({ stdout, all: log.all });
      else fail(new Error(`${label} 失敗（exit ${code}）：\n${log.tail(40)}`));
    });
  });
}

/** 啟動 wrangler dev（獨立的行程群組，結束時整組關掉，workerd 一起收）。 */
function startWranglerDev({ port, inspectorPort, persistDir, envFile, vars }) {
  const args = [
    WRANGLER,
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(inspectorPort),
    '--persist-to',
    persistDir,
    '--env-file',
    envFile,
    '--show-interactive-dev-session=false',
    '--log-level',
    'log',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  const child = spawn(process.execPath, args, { cwd: API_DIR, env: wranglerEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  liveGroups.add(child.pid);
  const log = new RingLog();
  child.stdout.on('data', (c) => log.push(c));
  child.stderr.on('data', (c) => log.push(c));
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      killGroup(child.pid, 'SIGTERM');
      const result = await Promise.race([exited, sleep(10_000).then(() => null)]);
      if (result === null) {
        killGroup(child.pid, 'SIGKILL');
        await Promise.race([exited, sleep(5_000)]);
      }
    }
    // wrangler 結束後，群組裡若還有 workerd 之類的殘留也一起收掉。
    for (let i = 0; i < 20 && groupAlive(child.pid); i++) {
      killGroup(child.pid, i < 10 ? 'SIGTERM' : 'SIGKILL');
      await sleep(200);
    }
    liveGroups.delete(child.pid);
    return !groupAlive(child.pid);
  };
  return { child, log, exited, stop };
}

async function waitForHealth(base, dev, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dev.child.exitCode !== null) throw new Error(`wrangler dev 提早結束（exit ${dev.child.exitCode}）：\n${dev.log.tail(60)}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return (await res.json()).version;
    } catch {
      // 還沒起來
    }
    await sleep(300);
  }
  throw new Error(`等待 wrangler dev 啟動逾時：\n${dev.log.tail(60)}`);
}

// ───────────────────────── 步驟紀錄 ─────────────────────────

const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, detail: detail ?? '', ms });
    console.log(`[通過] ${name}${detail ? `：${detail}` : ''}（${ms} ms）`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, ms: Date.now() - t0 });
    console.log(`[失敗] ${name}：${err.message}`);
    throw err;
  }
}

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
  const t0 = Date.now();
  console.log('== 本機端對端測試（wrangler dev＋假 Google＋假 Anthropic）==');

  // 題目庫（Worker 打包用；和 npm 的 predev 一樣）。
  const prompts = spawnSync(process.execPath, ['scripts/build-writing-prompts.mjs'], { cwd: API_DIR, encoding: 'utf8' });
  if (prompts.status !== 0) throw new Error(`產生題目庫失敗：${prompts.stderr || prompts.stdout}`);

  // 每次執行都用新的隨機機密（假的；只寫進權限 600 的暫存 env 檔，不出現在指令列與輸出）。
  const secrets = {
    GOOGLE_CLIENT_ID: `e2e-${randomBytes(6).toString('hex')}.apps.googleusercontent.com`,
    GOOGLE_CLIENT_SECRET: `e2e-google-${randomBytes(18).toString('base64url')}`,
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    LEDGER_SALT: randomBytes(32).toString('base64url'),
    ANTHROPIC_API_KEY: `sk-ant-e2e-${randomBytes(24).toString('base64url')}`,
    ADMIN_EMAIL: ADMIN.email,
  };

  const tmp = mkdtempSync(join(tmpdir(), 'gsat-local-e2e-'));
  cleanupTasks.push(async () => rmSync(tmp, { recursive: true, force: true }));
  const persistDir = join(tmp, 'state');
  const envFile = join(tmp, 'e2e.env');

  const google = await startFakeGoogle({ clientId: secrets.GOOGLE_CLIENT_ID, clientSecret: secrets.GOOGLE_CLIENT_SECRET });
  cleanupTasks.push(() => closeServer(google.server));
  const anthropic = await startFakeAnthropic({ apiKey: secrets.ANTHROPIC_API_KEY });
  cleanupTasks.push(() => closeServer(anthropic.server));
  for (const s of [ADMIN.email, ADMIN.name, STUDENT.email, STUDENT.name, STUDENT.nickname]) anthropic.state.forbidden.add(s);

  const port = await freePort();
  const inspectorPort = await freePort();
  const BASE = `http://127.0.0.1:${port}`;

  writeFileSync(envFile, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(envFile, 0o600);
  // env 檔只在 wrangler 啟動時讀；起來之後就刪（清理時也會連同暫存目錄再刪一次）。
  const removeEnvFile = () => rmSync(envFile, { force: true });
  cleanupTasks.push(async () => removeEnvFile());

  let dev = null;
  try {
    await step('套用本機遷移（全新的暫存 D1）', async () => {
      const { all: out } = await runWrangler(['d1', 'migrations', 'apply', 'gsat-english', '--local', '--persist-to', persistDir], 'wrangler d1 migrations apply');
      check(out.includes('0001_init.sql') && out.includes('0002_ai_photo_temp.sql'), '遷移輸出沒有 0001、0002');
      return '0001_init.sql、0002_ai_photo_temp.sql';
    });

    await step('啟動 wrangler dev（本機 D1＋Queue，機密走暫存 env 檔）', async () => {
      dev = startWranglerDev({
        port,
        inspectorPort,
        persistDir,
        envFile,
        vars: {
          APP_ORIGIN: BASE,
          ALLOWED_ORIGINS: BASE,
          GOOGLE_OAUTH_AUTH_URL: `${google.state.base}/auth`,
          GOOGLE_TOKEN_URL: `${google.state.base}/token`,
          GOOGLE_USERINFO_URL: `${google.state.base}/userinfo`,
          ANTHROPIC_BASE_URL: anthropic.state.base,
        },
      });
      cleanupTasks.push(async () => {
        const gone = await dev.stop();
        if (!gone) console.error('警告：wrangler dev 的行程群組沒有完全結束');
      });
      const version = await waitForHealth(BASE, dev);
      removeEnvFile();
      check(!dev.log.all.includes('.dev.vars'), 'wrangler dev 讀了 .dev.vars');
      return `${BASE}（API ${version}）`;
    });

    const S = {};
    const admin = new CookieJar();
    const student = new CookieJar();

    await step('GET /api/features：登入、AI、OCR 都已啟用', async () => {
      const r = await http(BASE, 'GET', '/api/features');
      expectStatus(r, 200, 'features');
      same(r.json, { auth: true, ai: true, ocr: true, aiPaused: false }, 'features');
    });

    await step('GET／POST /auth/probe：多個 Set-Cookie 原樣轉送、1.25 MB 本體、延遲回應（ARCHITECTURE §4.3）', async () => {
      const jar = new CookieJar();
      const set = await http(BASE, 'GET', '/auth/probe?set=1', { jar });
      expectStatus(set, 200, '/auth/probe?set=1');
      same(set.headers.getSetCookie().length, 2, 'Set-Cookie 標頭數');
      const read = await http(BASE, 'GET', '/auth/probe', { jar });
      same(read.json, { probe: true, cookies: { a: true, b: true } }, '讀回兩個測試 cookie');
      const body = new Uint8Array(1_250_000).fill(0x2a);
      const post = await http(BASE, 'POST', '/auth/probe', { headers: { 'Content-Type': 'application/octet-stream' }, raw: body });
      same(post.json, { probe: true, bytes: body.length }, 'POST 本體位元組數');
      const t = Date.now();
      const delayed = await http(BASE, 'GET', '/auth/probe?delay=1');
      same(delayed.json, { probe: true, delayed_seconds: 1 }, 'delay=1');
      check(Date.now() - t >= 950, '延遲回應太早回來');
      const clear = await http(BASE, 'GET', '/auth/probe?clear=1', { jar });
      expectStatus(clear, 200, '/auth/probe?clear=1');
      check(!jar.get('__Host-gsat_probe_a') && !jar.get('__Host-gsat_probe_b'), '清除測試 cookie');
      return '兩個 __Host- cookie 都讀回、1,250,000 bytes、delay 1 秒';
    });

    /** 完整的 Google 登入：start → 假 Google 授權頁 → callback。 */
    async function googleLogin(jar, who, next) {
      const start = await http(BASE, 'GET', `/auth/google/start?next=${encodeURIComponent(next)}`, { jar });
      expectStatus(start, 302, '/auth/google/start');
      const auth = new URL(start.headers.get('location'));
      check(`${auth.origin}${auth.pathname}` === `${google.state.base}/auth`, `start 沒有轉到 GOOGLE_OAUTH_AUTH_URL（${auth.origin}${auth.pathname}）`);
      check(auth.searchParams.get('redirect_uri') === `${BASE}/auth/google/callback`, `redirect_uri=${auth.searchParams.get('redirect_uri')}`);
      check(jar.get('__Host-gsat_oauth'), '沒有種 __Host-gsat_oauth nonce cookie');
      auth.searchParams.set('e2e_email', who.email);
      auth.searchParams.set('e2e_name', who.name);
      const consent = await fetch(auth, { redirect: 'manual' });
      check(consent.status === 302, `假 Google 授權頁回 ${consent.status}：${google.state.problems.join('；')}`);
      const cb = new URL(consent.headers.get('location'));
      check(`${cb.origin}${cb.pathname}` === `${BASE}/auth/google/callback`, '假 Google 沒有跳回 Worker 的回呼網址');
      const callback = await http(BASE, 'GET', `${cb.pathname}${cb.search}`, { jar });
      expectStatus(callback, 200, '/auth/google/callback');
      check((callback.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), '回呼頁沒有嚴格 CSP');
      check(callback.text.includes(`url=${BASE}${next}`), `回呼頁沒有跳回 APP_ORIGIN＋next：${callback.text.slice(0, 300)}`);
      check(jar.get('__Host-gsat_sid'), '沒有種 __Host-gsat_sid session cookie');
      check(!jar.get('__Host-gsat_oauth'), 'nonce cookie 用過沒有清掉');
      // 同一個授權碼／state 再用一次要失敗（nonce 已用掉）。
      const replay = await http(BASE, 'GET', `${cb.pathname}${cb.search}`, { jar: jar.clone() });
      expectStatus(replay, 302, '重送回呼');
      check(replay.headers.get('location') === `${BASE}/account?auth_error=state`, `重送回呼應該是 auth_error=state，實際 ${replay.headers.get('location')}`);
    }

    // ── 管理員（ADMIN_EMAIL）──
    await step('管理員 Google 登入：/auth/google/start → 假 Google → /auth/google/callback', async () => {
      await googleLogin(admin, ADMIN, '/writing');
      return 'session cookie 已種、nonce 用一次就失效、重送回呼回 auth_error=state';
    });

    await step('GET /api/me：首次登入要先同意條款；需要登入的 API 回 403 consent_required', async () => {
      const me = await http(BASE, 'GET', '/api/me', { jar: admin });
      expectStatus(me, 200, '/api/me');
      check(me.json.user, '/api/me 沒有 user');
      same(me.json.pending_consents, ['privacy', 'terms'], 'pending_consents');
      same(me.json.onboarded, false, 'onboarded');
      same(me.json.user.display_name, ADMIN.name, 'Google 名稱（UTF-8）當預設暱稱');
      check(!('email' in me.json.user), '/api/me 不該回 email');
      S.versions = me.json.consent_versions;
      S.adminPublicId = me.json.user.id;
      anthropic.state.forbidden.add(S.adminPublicId);
      const quota = await http(BASE, 'GET', '/api/ai/quota', { jar: admin });
      expectError(quota, 403, 'consent_required', '同意前 /api/ai/quota');
      return `consent_versions=${JSON.stringify(S.versions)}`;
    });

    await step('POST /api/me/consents：同意隱私權說明與服務條款、填年齡區間', async () => {
      const r = await http(BASE, 'POST', '/api/me/consents', {
        jar: admin,
        json: {
          items: [
            { kind: 'privacy', version: S.versions.privacy, granted: true },
            { kind: 'terms', version: S.versions.terms, granted: true },
          ],
          age_band: '18plus',
        },
      });
      expectStatus(r, 200, 'consents');
      same(r.json.pending_consents, [], 'pending_consents');
      same(r.json.onboarded, true, 'onboarded');
    });

    await step('ADMIN_EMAIL 帳號自動成為管理員並核准 AI', async () => {
      const me = await http(BASE, 'GET', '/api/me', { jar: admin });
      same([me.json.user.role, me.json.user.ai_status, me.json.user.ai_tier], ['admin', 'approved', 'unlimited'], 'role／ai_status／ai_tier');
      same(me.json.pending_ai_consents, [], 'pending_ai_consents（管理員免）');
      const health = await http(BASE, 'GET', '/api/admin/health', { jar: admin });
      expectStatus(health, 200, '/api/admin/health');
      check(Object.values(health.json.config).every((v) => v === true), `設定不齊：${JSON.stringify(health.json.config)}`);
      check(health.json.migrations.ok, `遷移狀態：${JSON.stringify(health.json.migrations)}`);
      check(health.json.approvals_allowed, '§6.3 啟動檢查沒過');
      check(!JSON.stringify(health.json).includes(secrets.ANTHROPIC_API_KEY.slice(0, 12)), 'health 回了機密');
      return `health：設定全為 true、遷移 ${health.json.migrations.applied.join('＋')}、名額 ${health.json.ai.approval_cap}`;
    });

    // ── 中譯英（排一次 429：SDK 自動重試）──
    await step('建立中譯英提交（POST /api/submissions）', async () => {
      const r = await http(BASE, 'POST', '/api/submissions', {
        jar: admin,
        json: {
          kind: 'translation',
          group_id: TRANSLATION_GROUP,
          body: { items: TRANSLATION_ANSWER.map((text, i) => ({ item_id: `${TRANSLATION_GROUP}#中譯英${i + 1}`, text })) },
        },
      });
      expectStatus(r, 201, 'POST /api/submissions');
      same(r.json.status, 'draft', 'status');
      S.translationId = r.json.id;
      return `id=${S.translationId}`;
    });

    async function waitFor(jar, id, statuses, timeoutMs = 90_000) {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        const r = await http(BASE, 'GET', `/api/submissions/${id}`, { jar });
        expectStatus(r, 200, '輪詢提交');
        last = r.json;
        if (statuses.includes(last.status)) return last;
        if (last.status === 'failed') throw new Error(`提交變成 failed（failure=${last.failure}）`);
        await sleep(300);
      }
      throw new Error(`等待提交變成 ${statuses.join('／')} 逾時（最後 ${last?.status}）\n${dev.log.tail(40)}`);
    }

    await step('POST /api/ai/translation-grade → 202（假 Anthropic 先回一次 429）', async () => {
      anthropic.state.faults.push({ task: 'translation', kind: '429' });
      const r = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: admin, json: { submission_id: S.translationId } });
      expectStatus(r, 202, 'translation-grade');
      same([r.json.submission_id, r.json.status], [S.translationId, 'queued'], 'AiTaskAccepted');
      S.translationOp = r.json.op_id;
      return `op_id=${S.translationOp}`;
    });

    await step('輪詢到 graded；分數由程式依規則計算（不是模型給的）', async () => {
      const sub = await waitFor(admin, S.translationId, ['graded']);
      const g = sub.grading;
      check(g && g.kind === 'translation', '沒有中譯英批改結果');
      same(anthropic.state.served.rate_limited, 1, '假 Anthropic 回過的 429 次數');
      same(g.raters.map((r) => [r.role, r.score]), [['primary', EXPECTED_TRANSLATION.analytic], ['second', EXPECTED_TRANSLATION.holistic]], '兩位評分者的程式分數');
      same([g.final_score, g.max_score, sub.final_score], [EXPECTED_TRANSLATION.final, 8, EXPECTED_TRANSLATION.final], '最後分數');
      same(g.sentence_scores, EXPECTED_TRANSLATION.sentences, '各句分數');
      same(g.third_rater_used, false, 'third_rater_used');
      const mech = g.errors.filter((e) => e.part === null).map((e) => [e.sentence_index, e.category, e.deducted]);
      same(mech, [[1, 'capitalization', 0.5], [1, 'punctuation', 0.5]], '程式判定的大小寫與標點');
      for (const e of g.errors) {
        if (e.part === null) continue;
        const text = TRANSLATION_ANSWER[e.sentence_index];
        same(text.slice(e.start, e.end), e.excerpt, `錯誤位置（${e.excerpt}）`);
      }
      const op = await http(BASE, 'GET', `/api/ai/ops/${S.translationOp}`, { jar: admin });
      same([op.json.status, op.json.points_charged, op.json.submission_status], ['settled', POINTS.translation_grade, 'graded'], 'ai_ops');
      return `第一位 ${g.raters[0].score}、第二位 ${g.raters[1].score} → ${g.final_score}／8（各句 ${g.sentence_scores.join('、')}）；429 由 SDK 重試後成功；扣 ${op.json.points_charged} 點`;
    });

    // ── 打字作文（排一次拒答：退點、failed；再送一次成功）──
    await step('建立打字作文提交', async () => {
      const r = await http(BASE, 'POST', '/api/submissions', { jar: admin, json: { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: TYPED_ESSAY } } });
      expectStatus(r, 201, 'POST /api/submissions（作文）');
      same([r.json.word_count, r.json.paragraphs], [126, 2], '字數與段數（程式算）');
      S.essayId = r.json.id;
      return `id=${S.essayId}、126 字、2 段`;
    });

    await step('POST /api/ai/essay-grade（假 Anthropic 拒答一次）→ failed、點數全退', async () => {
      anthropic.state.faults.push({ task: 'essay', kind: 'refusal' });
      const r = await http(BASE, 'POST', '/api/ai/essay-grade', { jar: admin, json: { submission_id: S.essayId } });
      expectStatus(r, 202, 'essay-grade');
      S.refusedOp = r.json.op_id;
      const sub = await waitFor(admin, S.essayId, ['failed']);
      same(sub.failure, 'refusal', 'failure');
      same(anthropic.state.served.refusal, 1, '假 Anthropic 回過的拒答次數');
      const op = await http(BASE, 'GET', `/api/ai/ops/${S.refusedOp}`, { jar: admin });
      same([op.json.status, op.json.points_charged, op.json.refund_reason], ['refunded', 0, 'refusal'], '拒答的 ai_ops');
      return `op ${S.refusedOp.slice(0, 8)}… refunded（refusal）、points_charged=0`;
    });

    await step('同一份作文再送一次 essay-grade → graded（AI 給的總分不採用）', async () => {
      const r = await http(BASE, 'POST', '/api/ai/essay-grade', { jar: admin, json: { submission_id: S.essayId } });
      expectStatus(r, 202, '重送 essay-grade');
      const sub = await waitFor(admin, S.essayId, ['graded']);
      const g = sub.grading;
      same(g.raters.map((x) => [x.role, x.total]), [['primary', EXPECTED_ESSAY.analytic], ['second', EXPECTED_ESSAY.holistic]], '兩位評分者的程式總分（第二位的 holistic_total=20 不採用）');
      same([g.final_score, g.band, sub.final_band], [EXPECTED_ESSAY.final, EXPECTED_ESSAY.band, EXPECTED_ESSAY.band], '最後分數與等級');
      same(Object.fromEntries(Object.entries(g.criteria).map(([k, v]) => [k, v.score])), EXPECTED_ESSAY.criteria, '四項平均');
      same([g.deductions, g.word_count, g.paragraphs, g.third_rater_used], [[], 126, 2, false], '扣分、字數、段數');
      const err = g.errors[0];
      check(err && TYPED_ESSAY.slice(err.start, err.end) === 'feel lonely after work', `錯誤位置由程式在原文找出：${JSON.stringify(err)}`);
      same(g.top_improvements.length, 3, 'top_improvements');
      return `第一位 ${g.raters[0].total}、第二位 ${g.raters[1].total} → ${g.final_score}／20（${g.band}）`;
    });

    // ── 手寫作文：照片 → OCR → 確認 → 批改 ──
    await step('建立手寫作文提交並上傳兩張照片（multipart，一次一張）', async () => {
      const r = await http(BASE, 'POST', '/api/submissions', { jar: admin, json: { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'photo' } });
      expectStatus(r, 201, 'POST /api/submissions（照片）');
      S.photoId = r.json.id;
      let photos = [];
      for (const ord of [1, 2]) {
        const jpeg = tinyJpeg(1200, 1600, 0x40 + ord);
        const form = new FormData();
        form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), `page${ord}.jpg`);
        const up = await http(BASE, 'POST', `/api/submissions/${S.photoId}/photos?ord=${ord}`, { jar: admin, raw: form });
        expectStatus(up, 200, `上傳照片 ord=${ord}`);
        photos = up.json.photos;
        const meta = photos.find((p) => p.ord === ord);
        check(meta && meta.bytes < jpeg.length, `照片 ${ord} 的中繼資料沒有被剝除（${meta?.bytes} ≥ ${jpeg.length}）`);
        same([meta.width, meta.height], [1200, 1600], `照片 ${ord} 的寬高`);
      }
      same(photos.map((p) => p.ord), [1, 2], '照片順序');
      return `id=${S.photoId}、照片 ${photos.map((p) => `${p.ord}:${p.bytes}B`).join('、')}`;
    });

    await step('POST /api/ai/essay-ocr → 輪詢到 ocr_ready（照片立即刪除）', async () => {
      const r = await http(BASE, 'POST', '/api/ai/essay-ocr', { jar: admin, json: { submission_id: S.photoId } });
      expectStatus(r, 202, 'essay-ocr');
      same(r.json.status, 'ocr_queued', 'status');
      S.ocrOp = r.json.op_id;
      const sub = await waitFor(admin, S.photoId, ['ocr_ready']);
      same(sub.ocr.text, OCR_TEXT, 'OCR 文字');
      same(sub.ocr.uncertain.map((u) => [OCR_TEXT.slice(u.start, u.end), u.candidates]), [['[[?]]', ['children', 'child']]], '看不清楚的位置與候選字');
      same(sub.photos, [], '辨識完照片要刪掉');
      const ocrReq = anthropic.state.requests.filter((x) => x.task === 'ocr');
      same([ocrReq.length, ocrReq[0]?.images, ocrReq[0]?.effort], [1, 2, 'low'], 'OCR 請求（張數、effort）');
      return `辨識 ${sub.ocr.text.split(/\s+/).length} 個片段、1 處 [[?]]、照片已刪`;
    });

    await step('PUT /api/submissions/{id}/confirm：還有 [[?]] 時 400，處理完 → confirmed', async () => {
      const edit = await http(BASE, 'PUT', `/api/submissions/${S.photoId}`, { jar: admin, json: { body: { text: CONFIRMED_TEXT } } });
      expectError(edit, 409, 'conflict', '照片模式確認前用 PUT 改文字');
      const bad = await http(BASE, 'PUT', `/api/submissions/${S.photoId}/confirm`, { jar: admin, json: { text: OCR_TEXT } });
      expectError(bad, 400, 'bad_request', '帶著 [[?]] 確認');
      const ok = await http(BASE, 'PUT', `/api/submissions/${S.photoId}/confirm`, { jar: admin, json: { text: CONFIRMED_TEXT } });
      expectStatus(ok, 200, 'confirm');
      same([ok.json.status, ok.json.paragraphs, typeof ok.json.ocr.confirmed_at], ['confirmed', 2, 'number'], 'confirmed');
      S.photoWords = ok.json.word_count;
      return `confirmed：${ok.json.word_count} 字、${ok.json.paragraphs} 段`;
    });

    await step('POST /api/ai/essay-grade（已確認的 OCR 文字）→ graded', async () => {
      const r = await http(BASE, 'POST', '/api/ai/essay-grade', { jar: admin, json: { submission_id: S.photoId } });
      expectStatus(r, 202, 'essay-grade（照片）');
      const sub = await waitFor(admin, S.photoId, ['graded']);
      same([sub.grading.final_score, sub.grading.band, sub.grading.deductions], [EXPECTED_ESSAY.final, EXPECTED_ESSAY.band, []], '照片作文的分數');
      const err = sub.grading.errors[0];
      check(err && CONFIRMED_TEXT.slice(err.start, err.end) === 'raise a dog instead', '照片作文的錯誤位置');
      return `${sub.grading.final_score}／20（${sub.grading.band}）`;
    });

    await step('GET /api/ai/quota：管理員扣點＝3＋7＋2＋7＝19（拒答那次全退）', async () => {
      const q = await http(BASE, 'GET', '/api/ai/quota', { jar: admin });
      expectStatus(q, 200, 'quota');
      const expected = POINTS.translation_grade + POINTS.essay_grade + POINTS.essay_ocr + POINTS.essay_grade;
      same([q.json.points.day_used, q.json.points.month_used], [expected, expected], '已用點數');
      same([q.json.essays.day_used, q.json.concurrent.active], [2, 0], '今日作文篇數（退還的不算）與進行中任務');
      check(q.json.points.day_limit >= 100_000_000, '管理員的上限應該是「不限」');
      same(q.json.task_points, POINTS, 'task_points');
      return `day_used=${q.json.points.day_used}、essays=${q.json.essays.day_used}、上限 ${q.json.points.day_limit}（不限）`;
    });

    await step('後台全站暫停 → /api/features 的 aiPaused、AI 端點回 503 ai_paused → 恢復', async () => {
      const pause = await http(BASE, 'POST', '/api/admin/ai/pause', { jar: admin, json: { paused: true } });
      expectStatus(pause, 204, '暫停');
      const f = await http(BASE, 'GET', '/api/features');
      same(f.json.aiPaused, true, '暫停後的 aiPaused');
      const c = await http(BASE, 'POST', '/api/submissions', {
        jar: admin,
        json: { kind: 'translation', group_id: TRANSLATION_GROUP, body: { items: TRANSLATION_ANSWER.map((text, k) => ({ item_id: `${k + 1}`, text })) } },
      });
      expectStatus(c, 201, '暫停時建立提交（不受影響）');
      const r = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: admin, json: { submission_id: c.json.id } });
      expectError(r, 503, 'ai_paused', '暫停時送批改');
      const resume = await http(BASE, 'POST', '/api/admin/ai/pause', { jar: admin, json: { paused: false } });
      expectStatus(resume, 204, '恢復');
      const f2 = await http(BASE, 'GET', '/api/features');
      same(f2.json.aiPaused, false, '恢復後的 aiPaused');
      const del = await http(BASE, 'DELETE', `/api/submissions/${c.json.id}`, { jar: admin });
      expectStatus(del, 204, '刪掉暫停時建立的草稿');
    });

    // ── 一般學生：申請 → 管理員核准 → 能用 AI → 額度用完 ──
    await step('學生 Google 登入、同意條款（改暱稱）', async () => {
      await googleLogin(student, STUDENT, '/ai/apply');
      const r = await http(BASE, 'POST', '/api/me/consents', {
        jar: student,
        json: {
          items: [
            { kind: 'privacy', version: S.versions.privacy, granted: true },
            { kind: 'terms', version: S.versions.terms, granted: true },
          ],
          age_band: '18plus',
          display_name: STUDENT.nickname,
        },
      });
      expectStatus(r, 200, '學生 consents');
      same([r.json.user.role, r.json.user.ai_status, r.json.user.display_name, r.json.onboarded], ['student', 'none', STUDENT.nickname, true], '學生帳號');
      S.studentPublicId = r.json.user.id;
      anthropic.state.forbidden.add(S.studentPublicId);
      return `public_id=${S.studentPublicId}`;
    });

    await step('未核准的學生送 AI 批改 → 403 not_approved', async () => {
      const c = await http(BASE, 'POST', '/api/submissions', {
        jar: student,
        json: { kind: 'translation', group_id: TRANSLATION_GROUP, body: { items: TRANSLATION_ANSWER.map((text, i) => ({ item_id: `中譯英${i + 1}`, text })) } },
      });
      expectStatus(c, 201, '學生建立提交');
      S.studentDraft = c.json.id;
      const r = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: student, json: { submission_id: S.studentDraft } });
      expectError(r, 403, 'not_approved', '未核准送批改');
      const other = await http(BASE, 'GET', `/api/submissions/${S.translationId}`, { jar: student });
      expectError(other, 404, 'not_found', '學生讀管理員的提交（IDOR）');
      return '另外確認讀別人的提交回 404';
    });

    await step('POST /api/ai/apply → pending', async () => {
      const r = await http(BASE, 'POST', '/api/ai/apply', { jar: student, json: { note: '想練習中譯英和作文。', ai_consent_version: S.versions.ai, guardian_ack: false } });
      expectStatus(r, 200, 'apply');
      same(r.json.ai_status, 'pending', 'ai_status');
      const forbidden = await http(BASE, 'GET', '/api/admin/users', { jar: student });
      expectError(forbidden, 403, 'forbidden', '學生打後台');
    });

    await step('管理員在後台看到申請並核准（POST /api/admin/users/{id}/approve）', async () => {
      const list = await http(BASE, 'GET', '/api/admin/users?ai_status=pending', { jar: admin });
      expectStatus(list, 200, '/api/admin/users');
      const row = list.json.users.find((u) => u.id === S.studentPublicId);
      check(row, '申請佇列裡沒有這位學生');
      same([row.email, row.ai_apply_note, row.ai_apply_count], [STUDENT.email, '想練習中譯英和作文。', 1], '後台列表');
      const r = await http(BASE, 'POST', `/api/admin/users/${S.studentPublicId}/approve`, { jar: admin });
      expectStatus(r, 200, 'approve');
      same(r.json.user.ai_status, 'approved', '核准後的 ai_status');
      const me = await http(BASE, 'GET', '/api/me', { jar: student });
      same([me.json.user.ai_status, me.json.pending_ai_consents], ['approved', []], '學生看到自己已核准');
      return `名額 ${list.json.approval.approved}→1／${list.json.approval.cap}`;
    });

    await step('核准後學生能用 AI（第二位判全部漏譯 → 差距 >2 → Queue 重送補第三位）', async () => {
      anthropic.state.gapNext = true;
      const r = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: student, json: { submission_id: S.studentDraft } });
      expectStatus(r, 202, '學生 translation-grade');
      const sub = await waitFor(student, S.studentDraft, ['graded']);
      const g = sub.grading;
      same(g.raters.map((x) => [x.role, x.score]), [['primary', 5.5], ['second', 0], ['third', 6]], '三位評分者');
      same([g.third_rater_used, g.final_score], [true, 5.75], '取最接近的兩位平均');
      return `5.5／0／6 → 取 5.5 與 6 → ${g.final_score}`;
    });

    await step(`學生把今日 ${STUDENT_DAY_LIMIT} 點用完後再送 → 429 quota_day`, async () => {
      // 已用 3 點；再 9 次中譯英（每次 3 點）＝ 30 點。逐一等批改完成（同時任務上限 2）。
      for (let i = 0; i < 9; i++) {
        const c = await http(BASE, 'POST', '/api/submissions', {
          jar: student,
          json: { kind: 'translation', group_id: TRANSLATION_GROUP, body: { items: TRANSLATION_ANSWER.map((text, k) => ({ item_id: `${k + 1}`, text })) } },
        });
        expectStatus(c, 201, `第 ${i + 2} 份提交`);
        const g = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: student, json: { submission_id: c.json.id } });
        expectStatus(g, 202, `第 ${i + 2} 次 translation-grade`);
        const sub = await waitFor(student, c.json.id, ['graded']);
        same(sub.final_score, EXPECTED_TRANSLATION.final, `第 ${i + 2} 次的分數`);
      }
      const q = await http(BASE, 'GET', '/api/ai/quota', { jar: student });
      same([q.json.points.day_used, q.json.points.day_limit, q.json.ai_status], [STUDENT_DAY_LIMIT, STUDENT_DAY_LIMIT, 'approved'], '學生額度');
      const last = await http(BASE, 'POST', '/api/submissions', {
        jar: student,
        json: { kind: 'translation', group_id: TRANSLATION_GROUP, body: { items: TRANSLATION_ANSWER.map((text, k) => ({ item_id: `${k + 1}`, text })) } },
      });
      expectStatus(last, 201, '第 11 份提交');
      const over = await http(BASE, 'POST', '/api/ai/translation-grade', { jar: student, json: { submission_id: last.json.id } });
      expectError(over, 429, 'quota_day', '額度用完');
      const still = await http(BASE, 'GET', `/api/submissions/${last.json.id}`, { jar: student });
      same(still.json.status, 'draft', '預扣失敗後提交仍是草稿');
      return `10 次批改共 ${q.json.points.day_used} 點；第 11 次回 429 quota_day（${over.json.error.message}）`;
    });

    await step('後台用量彙總（GET /api/admin/usage）', async () => {
      const u = await http(BASE, 'GET', '/api/admin/usage', { jar: admin });
      expectStatus(u, 200, '/api/admin/usage');
      same([u.json.totals.ops, u.json.totals.points, u.json.totals.refunded_ops], [15, 19 + STUDENT_DAY_LIMIT, 1], '用量（ops、點數、退還）');
      check(u.json.totals.usd_micros > 0 && u.json.budget.today_usd_micros > 0, '實際成本沒有記帳');
      return `15 個任務、${u.json.totals.points} 點、實際成本 US$${(u.json.totals.usd_micros / 1e6).toFixed(4)}`;
    });

    await step('POST /auth/logout-all 之後舊 cookie 失效（其他帳號不受影響）', async () => {
      const old = student.clone();
      const r = await http(BASE, 'POST', '/auth/logout-all', { jar: student });
      expectStatus(r, 204, 'logout-all');
      check(!student.get('__Host-gsat_sid'), 'logout-all 沒有清 cookie');
      const me = await http(BASE, 'GET', '/api/me', { jar: old });
      same(me.json, { user: null }, '舊 cookie 的 /api/me');
      const q = await http(BASE, 'GET', '/api/ai/quota', { jar: old.clone() });
      expectError(q, 401, 'unauthorized', '舊 cookie 呼叫需要登入的 API');
      const adminMe = await http(BASE, 'GET', '/api/me', { jar: admin });
      same(adminMe.json.user?.role, 'admin', '管理員的 session 不受影響');
    });

    await step('學生重新登入 → 匯出資料 → 刪除帳號（提交、批改隨外鍵刪除，帳本去識別保留）', async () => {
      await googleLogin(student, STUDENT, '/account');
      const me = await http(BASE, 'GET', '/api/me', { jar: student });
      same([me.json.user?.id, me.json.user?.ai_status, me.json.pending_consents], [S.studentPublicId, 'approved', []], '重新登入後是同一個帳號');
      const exp = await http(BASE, 'GET', '/api/me/export', { jar: student });
      expectStatus(exp, 200, '/api/me/export');
      same([exp.json.format, exp.json.user.email, exp.json.submissions.length], ['gsat-export/v1', STUDENT.email, 11], '匯出內容');
      const graded = exp.json.submissions.filter((x) => x.status === 'graded');
      same([graded.length, graded.every((x) => x.gradings.length >= 2)], [10, true], '匯出的批改');
      check(exp.json.consents.some((c) => c.kind === 'ai_processing' && c.granted), '匯出沒有 AI 同意紀錄');
      check(!exp.text.includes('lease_until') && !exp.text.includes('"op_id"'), '匯出含內部欄位');
      const bad = await http(BASE, 'DELETE', '/api/me', { jar: student, json: { confirm: '刪除' } });
      expectError(bad, 400, 'bad_request', '確認字串不對');
      const del = await http(BASE, 'DELETE', '/api/me', { jar: student, json: { confirm: '刪除我的帳號' } });
      expectStatus(del, 204, 'DELETE /api/me');
      const gone = await http(BASE, 'GET', '/api/me', { jar: student });
      same(gone.json, { user: null }, '刪除後的 /api/me');
      const usage = await http(BASE, 'GET', '/api/admin/usage', { jar: admin });
      same([usage.json.totals.ops, usage.json.totals.points], [15, 19 + STUDENT_DAY_LIMIT], '刪帳號後帳本仍保留（去識別）');
      const list = await http(BASE, 'GET', '/api/admin/users', { jar: admin });
      check(!list.json.users.some((u) => u.id === S.studentPublicId), '後台列表還看得到已刪除的帳號');
      return `匯出 ${exp.json.submissions.length} 份提交（${graded.length} 份有批改）；刪除後帳本 ${usage.json.totals.ops} 個任務仍在`;
    });

    await step('管理員登出（POST /auth/logout）', async () => {
      const out = await http(BASE, 'POST', '/auth/logout', { jar: admin });
      expectStatus(out, 204, '管理員登出');
      check(!admin.get('__Host-gsat_sid'), '登出沒有清 cookie');
      const after = await http(BASE, 'GET', '/api/me', { jar: admin });
      same(after.json, { user: null }, '登出後的 /api/me');
    });

    await step('假 Anthropic：§6.2 呼叫規則、送出內容不含 email／暱稱／帳號 id', async () => {
      same(anthropic.state.problems, [], '假 Anthropic 發現的問題');
      same(google.state.problems, [], '假 Google 發現的問題');
      const byTask = {};
      for (const r of anthropic.state.requests) byTask[r.task] = (byTask[r.task] ?? 0) + 1;
      return `共 ${anthropic.state.requests.length} 次請求（${Object.entries(byTask).map(([k, v]) => `${k} ${v}`).join('、')}）；429 ×${anthropic.state.served.rate_limited}、拒答 ×${anthropic.state.served.refusal}`;
    });

    await step('Worker 日誌：沒有預期外的錯誤、沒有機密與身分資訊', async () => {
      const log = dev.log.all;
      for (const marker of ['AI 任務處理失敗（預期外）', '未預期的錯誤', 'Uncaught']) check(!log.includes(marker), `日誌出現「${marker}」：\n${dev.log.tail(60)}`);
      for (const [name, value] of Object.entries(secrets)) {
        if (name === 'ADMIN_EMAIL') continue;
        check(!log.includes(value), `日誌出現機密 ${name}`);
      }
      for (const s of [ADMIN.email, STUDENT.email, ADMIN.name, STUDENT.nickname, TRANSLATION_ANSWER[0], 'feel lonely after work']) check(!log.includes(s), `日誌出現身分資訊或學生文字（${s.slice(0, 12)}…）`);
      check(log.includes('ai_settled'), '日誌沒有 consumer 的結算紀錄');
      check(log.includes('"event":"ai_requeue_third"'), '第三位評分者沒有經過 Queue 重送');
    });

    await step('關閉 wrangler dev（含 workerd）', async () => {
      const gone = await dev.stop();
      check(gone, 'wrangler dev 的行程群組還有殘留');
      return '行程群組已全部結束';
    });

    await step('資料庫事後檢查：照片暫存已清空、帳本只有假名、刪帳號留下去識別帳本與刪除證明', async () => {
      const sql = [
        'SELECT COUNT(*) AS n FROM submission_photo_temp',
        'SELECT COUNT(*) AS n, SUM(CASE WHEN length(user_ref) = 64 THEN 1 ELSE 0 END) AS hashed FROM ai_calls',
        "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'refusal'",
        'SELECT COUNT(*) AS n FROM ai_budget_daily WHERE paused = 1',
        'SELECT COUNT(*) AS n FROM ai_ops WHERE user_id IS NULL',
        "SELECT COUNT(*) AS n FROM deletion_log WHERE kind = 'account'",
        'SELECT COUNT(*) AS n FROM submissions',
      ];
      const { stdout } = await runWrangler(
        ['d1', 'execute', 'gsat-english', '--local', '--persist-to', persistDir, '--json', '--command', sql.join('; ')],
        'wrangler d1 execute',
      );
      // --json 的結果在 stdout；前面可能有 wrangler 的警告（帶色碼），從第一個以 [ 開頭的行開始解析。
      const start = stdout.search(/^\[/m);
      check(start >= 0, `d1 execute 沒有輸出 JSON：${stdout.slice(0, 300)}`);
      const rows = JSON.parse(stdout.slice(start)).map((r) => r.results[0]);
      const [photos, calls, refusals, paused, anonymized, deletions, submissions] = rows;
      same(photos.n, 0, 'submission_photo_temp 列數');
      same(calls.hashed, calls.n, 'ai_calls.user_ref 都是 64 碼 HMAC 假名');
      same(refusals.n, 1, 'refusal 安全事件');
      same(paused.n, 0, '一般 429 不應觸發全站暫停');
      same(anonymized.n, 10, '刪帳號後學生的 ai_ops 去識別保留');
      same(deletions.n, 1, 'deletion_log');
      same(submissions.n, 3, '學生的提交隨帳號刪除（只剩管理員的 3 份）');
      return `ai_calls ${calls.n} 列（429 重試後成功的那次只記一列）、照片暫存 0 列、去識別 ai_ops 10 列`;
    });
  } catch (err) {
    if (dev && !interrupted) {
      console.log('\n── wrangler dev 最後的輸出 ──');
      console.log(dev.log.tail(80));
    }
    throw err;
  } finally {
    await cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n== 全部通過：${passed}／${results.length} 個步驟（${((Date.now() - t0) / 1000).toFixed(1)} 秒）；子行程與暫存目錄已清除 ==`);
}

main().then(
  () => process.exit(0),
  async (err) => {
    await cleanup();
    if (interrupted) {
      console.error('\n== 已中斷；子行程與暫存目錄已清除 ==');
      process.exit(130);
    }
    const failed = results.find((r) => !r.ok);
    console.error(`\n== 失敗${failed ? `於「${failed.name}」` : ''}：${err.message.split('\n')[0]} ==`);
    if (!failed) console.error(err);
    process.exit(1);
  },
);
