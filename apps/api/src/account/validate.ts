/**
 * 帳號與後台端點共用的輸入處理：讀 JSON 本體、清理使用者輸入的文字。負責：後端登入 A1。
 *
 * 寫入類 API 只收 application/json（ARCHITECTURE §7：跨來源送 JSON 一定會觸發 preflight，多一層 CSRF 防護）。
 * 錯誤訊息只說哪個欄位不對，不回顯使用者送來的值。
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/** JSON 本體上限：帳號類請求都很小（暱稱、同意、申請說明），超過就是異常。 */
const MAX_JSON_BYTES = 16 * 1024;

/**
 * 邊讀邊數地讀完本體（位元組）：Content-Length 超過上限就不讀、直接 413；沒有 Content-Length（chunked）時
 * 讀到超過上限就停止讀取、413。不會先把整個本體緩衝進記憶體（Workers 的 isolate 記憶體上限 128 MB）。
 * （A2 的提交、AI 任務、照片上傳也用這一支；設計文件 §10「A2 修正（第二輪審查）」。）
 */
export async function readBodyBytes(c: Context<AppEnv>, maxBytes: number, tooLargeMessage = '請求內容太大'): Promise<Uint8Array> {
  const declared = c.req.header('Content-Length');
  if (declared !== undefined && Number(declared) > maxBytes) throw new ApiError(413, 'payload_too_large', tooLargeMessage);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, 'payload_too_large', tooLargeMessage);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * 讀取並驗證 JSON 本體；Content-Type 不是 application/json 或格式不對 400 bad_request、太大 413 payload_too_large。
 * maxBytes 預設 16 KB（帳號類）；A2 的提交內容較大，自己傳上限。
 */
export async function readJsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>, maxBytes: number = MAX_JSON_BYTES): Promise<T> {
  const type = c.req.header('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new ApiError(400, 'bad_request', '請用 application/json 送出');
  }
  const text = new TextDecoder().decode(await readBodyBytes(c, maxBytes));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_request', '請求內容不是合法的 JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(本體)'))].slice(0, 5);
    throw new ApiError(400, 'bad_request', `欄位格式不正確：${fields.join('、')}`);
  }
  return result.data;
}

/**
 * 不可見與控制字元：C0／C1 控制字元（換行另外處理）、軟連字號、零寬字元、雙向文字控制字元（可用來在後台畫面
 * 偽造文字順序）、BOM。暱稱與申請說明會顯示在後台，先清掉。
 */
const INVISIBLE_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** 以 Unicode code point 計算長度（和 SQLite 的 length() 一致；JS 的 .length 會把 emoji 算成 2）。 */
export function codePointLength(value: string): number {
  return [...value].length;
}

/** 截到 max 個 code point（不會切斷 surrogate pair）。 */
export function truncateCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/** 單行文字（暱稱）：NFC、去不可見字元、連續空白縮成一個、去頭尾空白；空字串回 null。 */
export function cleanSingleLine(value: string): string | null {
  const s = value.normalize('NFC').replace(/[\r\n\t]+/g, ' ').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

/** 多行文字（申請說明）：保留換行（最多連續兩個），其他同 cleanSingleLine；空字串回 null。 */
export function cleanMultiLine(value: string): string | null {
  const s = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > 0 ? s : null;
}
