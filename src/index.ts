/**
 * dsh-deepseek-tools —— DeepSeek 全家桶五件套（独立 DSH 插件）
 *
 * 五个工具（**注册在插件全局层 ⇒ 所有会话都能用**，不限 QQ）：
 *   ds_search   联网搜索 / 深度思考搜索 / 按图搜索
 *   ds_readurl  读网页并作答（一次最多 10 个链接）
 *   ds_ocr      识别 PDF / Word / PPT / 图片里的文字
 *   ds_asr      音频转文字（16bit PCM WAV / Ogg Opus）
 *   ds_tts      文字转语音（返回音频文件路径）
 *
 * 配置：cordis config 或【设置页】的 "deepseek-tools" 命名空间（改完即时生效）。
 * 没配 API Key 时工具仍然存在，调用会返回一句友好提示（不会报 unknown tool）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import {
  DsError,
  asrFile,
  ocrFile,
  readUrls,
  ttsText,
  webSearch,
  type DsCfg,
} from './api.js';
import { EditableConfigSchema, type EditableConfig } from './config.js';

export const name = 'deepseek-tools';
/** 本插件不依赖其它服务；settings 在 apply 里按需 inject */
export const inject: string[] = [];
export const Config = EditableConfigSchema;

/** 插件日志接口（宿主 Logger 的最小子集，避免硬依赖类型） */
interface LoggerLike {
  info?: (m: string) => void;
  warn?: (m: string) => void;
  debug?: (m: string) => void;
}

const ND = 'deepseek-tools';

/** 把「设置页 live 值 + cordis config」合成一次调用用的配置 */
function toCfg(live: EditableConfig): DsCfg {
  return {
    apiKey: String(live.apiKey ?? '').trim(),
    baseUrl: String(live.baseUrl ?? '').trim() || 'https://api.deepseek.com',
    model: String(live.model ?? '').trim() || 'deepseek-flash',
    timeoutMs: Number.isFinite(live.timeoutMs) && (live.timeoutMs as number) > 0 ? Number(live.timeoutMs) : 180_000,
    ...(live.ocrPurpose ? { ocrPurpose: live.ocrPurpose } : {}),
    ...(live.ttsVoice ? { ttsVoice: live.ttsVoice } : {}),
    ...(live.ttsFormat ? { ttsFormat: live.ttsFormat } : {}),
  };
}

/** 没配 Key 时统一返回这句（工具仍然可见，只是调用会说清楚缺什么） */
function noKey(): { ok: false; text: string } {
  return {
    ok: false as const,
    text: `还没配 DeepSeek API Key：请到【设置 → ${ND}】里填一个 sk- 开头的 Key（或装插件时在 cordis.patch.yml 里配 apiKey）。`,
  };
}

/** 把异常转成人话（区分"没 Key / HTTP 错误 / 网络错误"） */
function errText(err: unknown): string {
  if (err instanceof DsError) {
    return err.status ? `调用失败（HTTP ${err.status}）：${err.body || err.message}` : `调用失败：${err.message}`;
  }
  return `调用失败：${err instanceof Error ? err.message : String(err)}`;
}

/**
 * 注册设置页。
 *
 * 与 dsh-qqbot 同款做法：优先新版 `ctx.inject(['settings'])` + `installSection`，
 * legacy 包在时兜底；都不可用则静默跳过（插件照常工作，只是没有设置页）。
 */
function installSettings(ctx: Context, live: EditableConfig, logger?: LoggerLike): void {
  // ⚠️ 关键：entry 必须带上**全部字段的当前值**。
  //   否则设置服务把 schema 默认值当成"用户值"回灌，首次同步就会把真实配置掀掉
  //   （例：apiKey 被空字符串覆盖）。
  const entry: EditableConfig = {
    apiKey: live.apiKey ?? '',
    baseUrl: live.baseUrl ?? 'https://api.deepseek.com',
    model: live.model ?? 'deepseek-flash',
    timeoutMs: live.timeoutMs ?? 180_000,
    ocrPurpose: live.ocrPurpose ?? 'text_recognition',
    ttsVoice: live.ttsVoice ?? 'stella',
    ttsFormat: live.ttsFormat ?? 'wav',
  };
  let source: () => EditableConfig = () => entry;

  const sync = (): void => {
    try {
      const next = source();
      if (!next) return;
      if (typeof next.apiKey === 'string') live.apiKey = next.apiKey;
      if (typeof next.baseUrl === 'string') live.baseUrl = next.baseUrl;
      if (typeof next.model === 'string') live.model = next.model;
      if (typeof next.timeoutMs === 'number') live.timeoutMs = next.timeoutMs;
      if (next.ocrPurpose === 'text_recognition' || next.ocrPurpose === 'rich_layout_recognition') live.ocrPurpose = next.ocrPurpose;
      if (typeof next.ttsVoice === 'string') live.ttsVoice = next.ttsVoice;
      if (next.ttsFormat === 'wav' || next.ttsFormat === 'pcm') live.ttsFormat = next.ttsFormat;
    } catch {
      /* 同步失败不影响工具运行 */
    }
  };
  const hooks = {
    setSource: (s: () => EditableConfig): void => {
      source = s;
      sync();
    },
    onChange: (): void => sync(),
  };

  const tryInstall = (svc: unknown): boolean => {
    try {
      const s = svc as { installSection?: (c: unknown, ns: string, schema: unknown, entry: unknown, hooks: unknown) => unknown };
      if (!s || typeof s.installSection !== 'function') return false;
      s.installSection(ctx, ND, EditableConfigSchema, entry, hooks);
      logger?.info?.(`[${ND}] 设置页已注册（命名空间 ${ND}）`);
      return true;
    } catch (err) {
      logger?.warn?.(`[${ND}] 设置页注册失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  // 新版：声明式注入 settings 服务
  try {
    const injectable = ctx as unknown as { inject?: (deps: string[], cb: (c: { settings?: unknown }) => void) => unknown };
    if (typeof injectable.inject === 'function') {
      injectable.inject(['settings'], (settingsCtx) => {
        if (!tryInstall(settingsCtx?.settings)) {
          logger?.debug?.(`[${ND}] settings 服务不可用 —— 只能通过 cordis 配置改参数`);
        }
      });
      return;
    }
  } catch {
    /* 落到下面的老路径 */
  }

  // 老版：直接从 ctx 上找
  try {
    const legacy = (ctx as unknown as { get?: (k: string) => unknown }).get?.('settings');
    tryInstall(legacy);
  } catch {
    /* ignore */
  }
}

/** 插件入口 */
export function apply(ctx: Context, config?: EditableConfig): void {
  const logger = (ctx as unknown as { logger?: LoggerLike }).logger;
  // live：设置页与 yml 的共同落点，工具每次调用都现读它 ⇒ 改完即时生效
  const live: EditableConfig = {
    apiKey: String((config as EditableConfig | undefined)?.apiKey ?? ''),
    baseUrl: String((config as EditableConfig | undefined)?.baseUrl ?? 'https://api.deepseek.com'),
    model: String((config as EditableConfig | undefined)?.model ?? 'deepseek-flash'),
    timeoutMs: Number((config as EditableConfig | undefined)?.timeoutMs ?? 180_000),
    ocrPurpose: (config as EditableConfig | undefined)?.ocrPurpose ?? 'text_recognition',
    ttsVoice: (config as EditableConfig | undefined)?.ttsVoice ?? 'stella',
    ttsFormat: (config as EditableConfig | undefined)?.ttsFormat ?? 'wav',
  };

  installSettings(ctx, live, logger);

  const toolsReg = (ctx as unknown as { tools?: { register?: (t: unknown) => unknown } }).tools;
  if (!toolsReg || typeof toolsReg.register !== 'function') {
    logger?.warn?.(`[${ND}] 拿不到 ctx.tools.register —— 工具没注册（宿主版本可能太老）`);
    return;
  }

  // ── 1) 联网搜索 ────────────────────────────────────────────
  const dsSearch = defineTool({
    name: 'ds_search',
    description:
      'DeepSeek 官方联网搜索：可开深度思考（多步搜索+开页+页内查找），也支持传本地图片做按图搜索。'
      + '返回带引用的答案。',
    parameters: {
      query: { type: 'string', required: true, description: '要查的问题，自然语言即可' },
      thinking: { type: 'boolean', description: '是否开深度思考搜索（慢但更准），默认 false' },
      images: { type: 'string', description: '本地图片路径，逗号分隔（用于按图搜索）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; text: string }) => [{ type: 'text' as const, text: v.text }],
    },
    async execute(args: { query: string; thinking?: boolean; images?: string }) {
      const cfg = toCfg(live);
      if (!cfg.apiKey) return noKey();
      try {
        const imagePaths = String(args.images ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const r = await webSearch({
          cfg,
          query: String(args.query ?? ''),
          thinking: args.thinking === true,
          imagePaths,
        });
        const cites = r.citations.length
          ? '\n\n引用来源：\n' + r.citations.map((c, i) => `${i + 1}. ${c.title || '(无标题)'} — ${c.url}`).join('\n')
          : '';
        return { ok: true, text: (r.text || '(没有返回内容)') + cites };
      } catch (err) {
        return { ok: false, text: errText(err) };
      }
    },
  });

  // ── 2) 读链接 ──────────────────────────────────────────────
  const dsReadUrl = defineTool({
    name: 'ds_readurl',
    description: 'DeepSeek 官方读链接能力：把网页内容读进来再作答，一次最多 10 个链接。',
    parameters: {
      urls: { type: 'string', required: true, description: '要读的链接，多个用逗号或换行分隔（最多 10 个）' },
      question: { type: 'string', description: '想问什么；不给就总结要点' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; text: string }) => [{ type: 'text' as const, text: v.text }],
    },
    async execute(args: { urls: string; question?: string }) {
      const cfg = toCfg(live);
      if (!cfg.apiKey) return noKey();
      try {
        const urls = String(args.urls ?? '')
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const r = await readUrls({ cfg, urls, question: args.question });
        const pages = r.pages.length
          ? '\n\n读到的页面：\n' + r.pages.map((p, i) => `${i + 1}. ${p.title || '(无标题)'} — ${p.url}${p.status ? `（${p.status}）` : ''}`).join('\n')
          : '';
        return { ok: true, text: (r.text || '(没有返回内容)') + pages };
      } catch (err) {
        return { ok: false, text: errText(err) };
      }
    },
  });

  // ── 3) OCR ─────────────────────────────────────────────────
  const dsOcr = defineTool({
    name: 'ds_ocr',
    description: 'DeepSeek 官方 OCR：识别 PDF / Word / PPT / 图片里的文字，按页返回。',
    parameters: {
      path: { type: 'string', required: true, description: '本机文件绝对路径（PDF/DOC/DOCX/PPT/PPTX/PNG/JPG/WebP/GIF/BMP/TIFF）' },
      purpose: {
        type: 'string',
        description: 'text_recognition（默认，纯文字）/ rich_layout_recognition（带版面结构）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; text: string }) => [{ type: 'text' as const, text: v.text }],
    },
    async execute(args: { path: string; purpose?: string }) {
      const cfg = toCfg(live);
      if (!cfg.apiKey) return noKey();
      try {
        const purpose = args.purpose === 'rich_layout_recognition' ? 'rich_layout_recognition' : undefined;
        const r = await ocrFile({ cfg, filePath: String(args.path ?? ''), ...(purpose ? { purpose } : {}) });
        const head = `共 ${r.pageCount} 页（${r.purpose ?? 'text_recognition'}）`;
        const body = r.pages
          .map((p) => `— 第 ${p.index + 1} 页${p.truncated ? '（超长已截断）' : ''} —\n${p.text}`)
          .join('\n\n');
        return { ok: true, text: `${head}\n\n${body}` };
      } catch (err) {
        return { ok: false, text: errText(err) };
      }
    },
  });

  // ── 4) ASR ─────────────────────────────────────────────────
  const dsAsr = defineTool({
    name: 'ds_asr',
    description: 'DeepSeek 官方语音转文字。只吃 16bit PCM WAV 或 Ogg Opus，≤8MiB、≤120 秒；超了请先转码。',
    parameters: {
      path: { type: 'string', required: true, description: '本机音频绝对路径（.wav / .ogg）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; text: string }) => [{ type: 'text' as const, text: v.text }],
    },
    async execute(args: { path: string }) {
      const cfg = toCfg(live);
      if (!cfg.apiKey) return noKey();
      try {
        const r = await asrFile({ cfg, filePath: String(args.path ?? '') });
        const secs = r.durationMs > 0 ? `（${(r.durationMs / 1000).toFixed(1)} 秒）` : '';
        return { ok: true, text: `转写${secs}：\n${r.text || '(没有识别到文字)'}` };
      } catch (err) {
        return { ok: false, text: errText(err) };
      }
    },
  });

  // ── 5) TTS ─────────────────────────────────────────────────
  const dsTts = defineTool({
    name: 'ds_tts',
    description:
      'DeepSeek 官方文字转语音：把文本合成音频并**保存成文件**，返回文件路径（供后续发送/播放）。',
    parameters: {
      text: { type: 'string', required: true, description: '要朗读的文本（≤10,000 个计费字符）' },
      voice: { type: 'string', description: '音色：stella（女声，默认）/ tide（男声）' },
      savePath: { type: 'string', description: '保存到的绝对路径；不传则存到系统临时目录' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; text: string }) => [{ type: 'text' as const, text: v.text }],
    },
    async execute(args: { text: string; voice?: string; savePath?: string }) {
      const cfg = toCfg(live);
      if (!cfg.apiKey) return noKey();
      try {
        const fmt = cfg.ttsFormat === 'pcm' ? 'pcm' : 'wav';
        const r = await ttsText({
          cfg,
          text: String(args.text ?? ''),
          ...(args.voice ? { voice: String(args.voice) } : {}),
          format: fmt,
        });
        const out = String(args.savePath ?? '').trim()
          || join(tmpdir(), `${ND}-${Date.now()}.${fmt}`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, r.buffer);
        return {
          ok: true,
          text: `已合成语音（${(r.buffer.length / 1024).toFixed(1)} KB，${r.contentType}）\n文件：${out}`,
        };
      } catch (err) {
        return { ok: false, text: errText(err) };
      }
    },
  });

  for (const t of [dsSearch, dsReadUrl, dsOcr, dsAsr, dsTts]) {
    try {
      toolsReg.register(t);
    } catch (err) {
      logger?.warn?.(`[${ND}] 工具注册失败（${(t as { name?: string }).name}）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger?.info?.(`[${ND}] 五个工具已注册到全局层（所有会话可见）：ds_search / ds_readurl / ds_ocr / ds_asr / ds_tts`);
}
