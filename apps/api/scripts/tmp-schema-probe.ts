// 臨時探測（只在開發分支，不合併）：哪些 JSON schema 會被 Anthropic 拒絕為「compiled grammar is too large」。
// 每個請求只要 64 個 token；被拒的請求不產生輸出。只印 schema 名稱與結果。
import Anthropic from '@anthropic-ai/sdk';
import { outgoingJsonSchema } from '../src/ai/client';
import { essayAnalyticSchema } from '../src/ai/prompts/essay';
import { assistOcrSchema } from '../src/ai/prompts/assist-ocr';
import { assistItemSchema, assistWritingSchema, assistVocabSchema, assistFollowupSchema } from '../src/assist/analysisSchemas';
import { assistReportSchema } from '../src/assist/reportSchemas';

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
const MODEL = process.env['PROBE_MODEL'] ?? 'claude-opus-5-5';

type J = Record<string, unknown>;
const str = { type: 'string' };
const obj = (props: Record<string, unknown>): J => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const flat = (n: number) => obj(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, str])));
const nested = (k: number, inner: number) => obj(Object.fromEntries(Array.from({ length: k }, (_, i) => [`a${i}`, { type: 'array', items: flat(inner) }])));

/** $ref 全部展開（看 $defs 本身是不是成本）。 */
function inline(schema: J): J {
  const defs = (schema['$defs'] ?? {}) as Record<string, J>;
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === 'object') {
      const o = n as J;
      if (typeof o['$ref'] === 'string') return walk(defs[(o['$ref'] as string).split('/').pop()!]);
      return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '$defs').map(([k, v]) => [k, walk(v)]));
    }
    return n;
  };
  return walk(schema) as J;
}
/** 拿掉 description（看說明文字算不算進 grammar）。 */
function noDesc(schema: J): J {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n as J).filter(([k]) => k !== 'description').map(([k, v]) => [k, walk(v)]));
    return n;
  };
  return walk(schema) as J;
}

const item = outgoingJsonSchema(assistItemSchema) as J;
const report = outgoingJsonSchema(assistReportSchema) as J;
const cases: Array<[string, J]> = [
  ['assistItem inlined (repeat)', inline(item)],
  ['assistReport inlined', inline(report)],
  ['assistWriting inlined', inline(outgoingJsonSchema(assistWritingSchema) as J)],
  ['assistVocab inlined', inline(outgoingJsonSchema(assistVocabSchema) as J)],
  ['assistFollowup inlined', inline(outgoingJsonSchema(assistFollowupSchema) as J)],
  ['assistOcr inlined', inline(outgoingJsonSchema(assistOcrSchema) as J)],
  ['essayAnalytic inlined', inline(outgoingJsonSchema(essayAnalyticSchema) as J)],
];

for (const [name, schema] of cases) {
  try {
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: 'Reply with a JSON object. Use empty strings and empty arrays.',
      messages: [{ role: 'user', content: 'test' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    } as never);
    console.log(`[probe] OK    ${name} (${JSON.stringify(schema).length} bytes) stop=${(r as { stop_reason?: string }).stop_reason}`);
  } catch (err) {
    const e = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
    console.log(`[probe] FAIL  ${name} (${JSON.stringify(schema).length} bytes) ${e.status ?? ''} ${e.error?.error?.message ?? e.message}`);
  }
}
