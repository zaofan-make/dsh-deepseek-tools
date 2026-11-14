/**
 * DeepSeek「全家桶应用 API」的最小封装（TypeScript 版）。
 *
 * 五个能力（官方文档 2026-11 线）：
 *   1. 联网搜索 / 深度思考搜索（服务端工具 `deepseek_web_search`，支持图片搜索）
 *   2. 阅读链接（服务端工具 `deepseek_read_url`）
 *   3. OCR   POST /v1/tools/ocr   （multipart：file + purpose）
 *   4. ASR   POST /v1/tools/asr   （multipart：file；16bit PCM WAV 或 Ogg Opus，≤8MiB/≤120s）
 *   5. TTS   POST /v1/tools/tts   （JSON：text / voice_id / format / filter_markdown）
 *
 * 只依赖 Node 内置（fetch / FormData / Blob，需 Node ≥ 18）。
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

/** 调用配置（由插件把「设置页 + cordis config」合成后传进来） */
export interface DsCfg {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** OCR 的默认 purpose */
  ocrPurpose?: string;
  /** TTS 默认音色 */
  ttsVoice?: string;
  /** TTS 默认格式 */
  ttsFormat?: string;
}

/** 统一错误：带上 HTTP 状态与服务端原文，便于 AI 自己判断要不要重试 */
export class DsError extends Error {
  status: number;
  body: string;
  constructor(message: string, extra: { status?: number; body?: string } = {}) {
    super(message);
    this.name = 'DsError';
    this.status = extra.status ?? 0;
    this.body = extra.body ?? '';
  }
}

function authHeaders(cfg: DsCfg, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, ...extra };
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

async function readErr(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  return body.slice(0, 600);
}

/** JSON 请求（chat/completions、tts） */
async function postJson(cfg: DsCfg, path: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<Response> {
  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: timeoutSignal(opts.timeoutMs ?? cfg.timeoutMs),
    });
  } catch (err) {
    throw new DsError(`请求 ${path} 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const b = await readErr(res);
    throw new DsError(`HTTP ${res.status} (${path}): ${b}`, { status: res.status, body: b });
  }
  return res;
}

/** multipart 请求（ocr、asr） */
async function postForm(cfg: DsCfg, path: string, form: FormData, opts: { timeoutMs?: number } = {}): Promise<Response> {
  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg), // 不要手写 Content-Type，让 fetch 自己带 boundary
      body: form,
      signal: timeoutSignal(opts.timeoutMs ?? cfg.timeoutMs),
    });
  } catch (err) {
    throw new DsError(`上传 ${path} 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const b = await readErr(res);
    throw new DsError(`HTTP ${res.status} (${path}): ${b}`, { status: res.status, body: b });
  }
  return res;
}

// ══════════════════════════════════════════════════════════════════
// 1) 联网搜索 / 深度思考搜索 / 图片搜索
// ══════════════════════════════════════════════════════════════════

/** 本地图片 → data URL（图片搜索要把它放进 user content） */
export function imageToDataUrl(path: string): string {
  const buf = readFileSync(path);
  const name = basename(path).toLowerCase();
  const mime = name.endsWith('.png') ? 'image/png'
    : name.endsWith('.gif') ? 'image/gif'
      : name.endsWith('.webp') ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export interface SearchResult {
  text: string;
  citations: Array<{ url: string; title: string }>;
  calls: unknown[];
  usage: unknown;
}

/**
 * 跑一次 chat/completions，声明服务端联网工具。
 * 联网由模型自己判断，搜索 / 开页 / 页内查找都在服务端完成，客户端只是收结果。
 */
export async function webSearch(opt: {
  cfg: DsCfg;
  query: string;
  thinking?: boolean;
  imagePaths?: string[];
  withReadUrl?: boolean;
}): Promise<SearchResult> {
  const { cfg, query, thinking = false, imagePaths = [], withReadUrl = true } = opt;
  const tools: Array<{ type: string }> = [{ type: 'deepseek_web_search' }];
  if (withReadUrl) tools.push({ type: 'deepseek_read_url' });

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: String(query || '').trim() }];
  for (const p of imagePaths) {
    try {
      content.push({ type: 'image_url', image_url: { url: imageToDataUrl(p) } });
    } catch {
      /* 单张图读失败不影响搜索 */
    }
  }

  const body: Record<string, unknown> = {
    model: cfg.model || 'deepseek-flash',
    messages: [{ role: 'user', content: content.length === 1 ? content[0]!.text : content }],
    tools,
    stream: false,
  };
  if (thinking) body.thinking = { type: 'enabled' };

  const res = await postJson(cfg, '/chat/completions', body, { timeoutMs: 240_000 });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown; annotations?: unknown[]; server_tool_calls?: unknown[] } }>;
    usage?: unknown;
  };
  if (data?.error) throw new DsError(`模型返回错误: ${data.error.message ?? JSON.stringify(data.error)}`);

  const msg = data?.choices?.[0]?.message ?? {};
  const text = String(msg.content ?? '').trim();
  const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
  const citations = annotations
    .map((a) => a as { type?: string; url_citation?: { url?: string; title?: string } })
    .filter((a) => a?.type === 'url_citation' && a?.url_citation?.url)
    .map((a) => ({ url: String(a.url_citation!.url), title: String(a.url_citation!.title ?? '') }));
  const calls = Array.isArray(msg.server_tool_calls) ? msg.server_tool_calls : [];
  return { text, citations, calls, usage: data?.usage ?? null };
}

/** 只读链接（不搜索）：把 URL 喂给模型，让它读网页后作答 */
export async function readUrls(opt: { cfg: DsCfg; urls: string | string[]; question?: string }): Promise<{
  text: string;
  pages: Array<{ url: string; title: string; status: string }>;
  usage: unknown;
}> {
  const { cfg, urls, question } = opt;
  const list = (Array.isArray(urls) ? urls : [urls]).map((u) => String(u || '').trim()).filter(Boolean).slice(0, 10);
  if (!list.length) throw new DsError('没有可读取的链接');
  const text = [String(question || '').trim(), ...list].filter(Boolean).join('\n');
  const body = {
    model: cfg.model || 'deepseek-flash',
    messages: [{ role: 'user', content: text }],
    tools: [{ type: 'deepseek_read_url' }],
    stream: false,
  };
  const res = await postJson(cfg, '/chat/completions', body, { timeoutMs: 240_000 });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown; server_tool_calls?: unknown[] } }>;
    usage?: unknown;
  };
  if (data?.error) throw new DsError(`模型返回错误: ${data.error.message ?? JSON.stringify(data.error)}`);
  const msg = data?.choices?.[0]?.message ?? {};
  const pages: Array<{ url: string; title: string; status: string }> = [];
  for (const step of Array.isArray(msg.server_tool_calls) ? msg.server_tool_calls : []) {
    const calls = (step as { calls?: unknown[] })?.calls;
    for (const c of Array.isArray(calls) ? calls : []) {
      const cc = c as { page?: { url?: string; title?: string }; status?: string };
      if (cc?.page?.url) pages.push({ url: String(cc.page.url), title: String(cc.page.title ?? ''), status: String(cc.status ?? '') });
    }
  }
  return { text: String(msg.content ?? '').trim(), pages, usage: data?.usage ?? null };
}

// ══════════════════════════════════════════════════════════════════
// 2) OCR
// ══════════════════════════════════════════════════════════════════

export interface OcrResult {
  id?: string;
  purpose?: string;
  pageCount: number;
  pages: Array<{ index: number; text: string; truncated: boolean }>;
}

/** 识别 PDF / Word / PPT / 图片里的文字，按页返回 */
export async function ocrFile(opt: { cfg: DsCfg; filePath: string; purpose?: string }): Promise<OcrResult> {
  const { cfg, filePath, purpose } = opt;
  const st = statSync(filePath);
  if (st.size > 100 * 1024 * 1024) throw new DsError('文件超过 100 MiB，OCR 接口上限');
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append('purpose', purpose || cfg.ocrPurpose || 'text_recognition');
  form.append('file', new Blob([new Uint8Array(buf)]), basename(filePath));
  // 官方：识别期间服务端会发换行符保活，响应体前面可能有一堆空白 ⇒ 先 trim 再 parse
  const res = await postForm(cfg, '/v1/tools/ocr', form, { timeoutMs: 300_000 });
  const raw = (await res.text()).trim();
  let data: {
    error?: { message?: string };
    id?: string;
    purpose?: string;
    page_count?: number;
    pages?: Array<{ index?: number; text?: string; finish_reason?: string }>;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new DsError('OCR 返回不是合法 JSON: ' + raw.slice(0, 200));
  }
  if (data?.error) throw new DsError(`OCR 失败: ${data.error.message ?? JSON.stringify(data.error)}`);
  const pages = (Array.isArray(data?.pages) ? data.pages : []).map((p) => ({
    index: Number(p?.index ?? 0),
    text: String(p?.text ?? ''),
    truncated: p?.finish_reason === 'length',
  }));
  return { id: data?.id, purpose: data?.purpose, pageCount: Number(data?.page_count ?? pages.length), pages };
}

// ══════════════════════════════════════════════════════════════════
// 3) ASR
// ══════════════════════════════════════════════════════════════════

export interface AsrResult {
  text: string;
  durationMs: number;
  requestId?: string;
}

/** 语音转文字（只吃 16bit PCM WAV 或 Ogg Opus，≤8MiB/≤120s） */
export async function asrFile(opt: { cfg: DsCfg; filePath: string }): Promise<AsrResult> {
  const { cfg, filePath } = opt;
  const st = statSync(filePath);
  if (st.size > 8 * 1024 * 1024) throw new DsError('音频超过 8 MiB；请先转成 16k 单声道 WAV 或 Ogg Opus');
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await postForm(cfg, '/v1/tools/asr', form, { timeoutMs: 180_000 });
  const data = (await res.json()) as { text?: string; duration_ms?: number; request_id?: string };
  return { text: String(data?.text ?? ''), durationMs: Number(data?.duration_ms ?? 0), requestId: data?.request_id };
}

// ══════════════════════════════════════════════════════════════════
// 4) TTS
// ══════════════════════════════════════════════════════════════════

/** 文字转语音，返回音频字节 */
export async function ttsText(opt: {
  cfg: DsCfg;
  text: string;
  voice?: string;
  format?: 'wav' | 'pcm';
  filterMarkdown?: boolean;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const { cfg, text, voice, format, filterMarkdown } = opt;
  const t = String(text || '');
  if (!t.trim()) throw new DsError('没有可朗读的文本');
  if (t.length > 10000) throw new DsError('文本超过 10,000 个计费字符，请分段');
  const res = await postJson(cfg, '/v1/tools/tts', {
    text: t,
    voice_id: voice || cfg.ttsVoice || 'stella',
    format: format || cfg.ttsFormat || 'wav',
    filter_markdown: filterMarkdown !== false,
  }, { timeoutMs: 300_000 });
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType: String(res.headers.get('content-type') ?? 'audio/wav') };
}
