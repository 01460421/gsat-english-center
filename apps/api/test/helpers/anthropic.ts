/**
 * 測試用的假 Anthropic API：注入 SDK 的 fetch（createQueueHandler({ fetch })），依請求內容回傳串流（SSE）或錯誤。
 * 測試絕不打真的 API、絕不需要真金鑰（設計文件 §8）。負責：後端 AI A2。
 *
 * 用法：
 *   const fake = new FakeAnthropic((req) => fake.json(outputObject));   // 依 req 決定回應
 *   const handler = createQueueHandler({ fetch: fake.fetch });
 *   fake.requests                                                       // 收到的請求（解析過的 JSON 本體與標頭）
 */

export interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
  /** system 第一段文字（判斷是哪一位評分者用）。 */
  system: string;
  /** user 訊息的文字部分。 */
  userText: string;
}

export interface FakeMessageOptions {
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use';
  refusalCategory?: string | null;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  /** usage.iterations（模擬 server-side fallback）。 */
  iterations?: Array<Record<string, unknown>> | null;
  /** 額外的 content 區塊（放在文字之前，例如輸出前拒答的 fallback 區塊）。 */
  prefixBlocks?: Array<Record<string, unknown>>;
  /**
   * 中途拒答、server-side fallback 接手：文字在第 at 個字元處切開，前段是被拒答模型的輸出，
   * 中間插一個 fallback 區塊，後段是接手模型的續寫（mode='continue'）或從頭重寫的完整文字（mode='restart'）。
   */
  midStreamFallback?: { at: number; from: string; to: string; mode: 'continue' | 'restart' };
  requestId?: string;
}

export type Responder = (req: CapturedRequest, index: number) => Response | Promise<Response>;

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 組一個完整的 SSE 串流回應（message_start → 文字 → message_delta → message_stop）。 */
export function sseResponse(text: string, o: FakeMessageOptions = {}): Response {
  const model = o.model ?? 'claude-opus-5-5';
  const cacheCreation = { ephemeral_5m_input_tokens: o.cacheWrite5m ?? 0, ephemeral_1h_input_tokens: o.cacheWrite1h ?? 0 };
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: o.inputTokens ?? 1_000,
      output_tokens: 1,
      cache_read_input_tokens: o.cacheRead ?? 0,
      cache_creation_input_tokens: (o.cacheWrite5m ?? 0) + (o.cacheWrite1h ?? 0),
      cache_creation: cacheCreation,
      iterations: null,
    },
  };
  const chunks: string[] = [sseEvent('message_start', { type: 'message_start', message })];
  let index = 0;
  for (const block of o.prefixBlocks ?? []) {
    chunks.push(sseEvent('content_block_start', { type: 'content_block_start', index, content_block: block }));
    chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index }));
    index++;
  }
  const textBlock = (t: string) => {
    chunks.push(sseEvent('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }));
    // 分兩段送，確認 SDK 會把 delta 接起來。
    const mid = Math.floor(t.length / 2);
    for (const part of [t.slice(0, mid), t.slice(mid)]) {
      chunks.push(sseEvent('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } }));
    }
    chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index }));
    index++;
  };
  const fb = o.midStreamFallback;
  if (fb) {
    textBlock(text.slice(0, fb.at));
    chunks.push(sseEvent('content_block_start', { type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: fb.from }, to: { model: fb.to } } }));
    chunks.push(sseEvent('content_block_stop', { type: 'content_block_stop', index }));
    index++;
    textBlock(fb.mode === 'continue' ? text.slice(fb.at) : text);
  } else {
    textBlock(text);
  }
  chunks.push(
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: o.stopReason ?? 'end_turn',
        stop_sequence: null,
        stop_details: o.stopReason === 'refusal' ? { type: 'refusal', category: o.refusalCategory ?? 'bio', explanation: null } : null,
      },
      usage: { output_tokens: o.outputTokens ?? 500, ...(o.iterations ? { iterations: o.iterations } : {}) },
    }),
  );
  chunks.push(sseEvent('message_stop', { type: 'message_stop' }));
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'request-id': o.requestId ?? 'req_test_123' },
  });
}

/** API 錯誤回應（retry-after-ms: 1 讓 SDK 的自動重試不要真的等）。 */
export function errorResponse(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1', 'request-id': 'req_err_1' },
  });
}

export class FakeAnthropic {
  readonly requests: CapturedRequest[] = [];
  constructor(public responder: Responder) {}

  json(output: unknown, o: FakeMessageOptions = {}): Response {
    return sseResponse(JSON.stringify(output), o);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, any>) : {};
    const system = Array.isArray(body['system']) ? String(body['system'][0]?.text ?? '') : String(body['system'] ?? '');
    const content = body['messages']?.[0]?.content;
    const userText = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '';
    const req: CapturedRequest = { url, headers, body, system, userText };
    this.requests.push(req);
    return this.responder(req, this.requests.length - 1);
  };
}

/** 依系統提示判斷評分者框架。 */
export function frameworkOf(req: CapturedRequest): 'analytic' | 'holistic' | 'ocr' {
  if (req.system.includes('careful transcriber')) return 'ocr';
  return req.system.includes('independent second grader') ? 'holistic' : 'analytic';
}
