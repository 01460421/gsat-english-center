/**
 * 這台裝置問過的題（錯題清單的「只看沒問過的」與「可能 0 點」用）：localStorage 的 gsat-assist:v1:asked。
 * 每一筆是「來源｜代號｜題號」（題號是畫面上的題號；單字是條目 id、寫作是提交 id），最多 2,000 筆，新的在前。
 * 只是方便：清掉或存不進去時，清單只是少了「問過」的標示。
 */
import { parseAskParams, type AskRef } from '@gsat/shared';

export const ASKED_KEY = 'gsat-assist:v1:asked';
const MAX = 2_000;

function idOf(ask: AskRef): string {
  switch (ask.src) {
    case 'bank':
      return ask.ref;
    case 'exam':
      return ask.exam;
    case 'bankmock':
    case 'mock':
      return ask.attempt;
    case 'writing':
      return ask.sub;
    case 'vocab':
      return 'vocab';
  }
}

function keysOf(ask: AskRef, labels: readonly string[]): string[] {
  return labels.map((l) => `${ask.src}|${idOf(ask)}|${l}`);
}

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(ASKED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 記下問過的題（labels 是畫面上的題號；單字是條目 id；寫作傳空陣列）。 */
export function markAsked(ask: AskRef, labels: readonly string[]): void {
  const added = ask.src === 'writing' ? [`writing|${ask.sub}|`] : keysOf(ask, labels);
  try {
    const next = [...new Set([...added, ...read()])].slice(0, MAX);
    window.localStorage.setItem(ASKED_KEY, JSON.stringify(next));
  } catch {
    // 只是標示
  }
}

/** 錯題清單的一列（以確認頁網址判斷）有沒有任何一題問過。 */
export function isAskedHref(href: string | null, asked: ReadonlySet<string> = new Set(read())): boolean {
  if (!href) return false;
  const ask = parseAskParams(href.slice(href.indexOf('?') + 1));
  if (!ask) return false;
  if (ask.src === 'writing') return asked.has(`writing|${ask.sub}|`);
  const labels = ask.src === 'vocab' ? ask.entries : ask.labels;
  return keysOf(ask, labels).some((k) => asked.has(k));
}

export function readAsked(): Set<string> {
  return new Set(read());
}
