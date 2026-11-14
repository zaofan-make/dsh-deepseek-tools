/**
 * 插件配置 Schema。
 *
 * 两个入口共用同一份结构：
 *   · `cordis.patch.yml` 里的 `config`（装好就能用，适合写进 profile）
 *   · 设置页（`installSection` 注册的 "deepseek-tools" 命名空间，改完即时生效）
 */
import Schema from '@deepseek-ai/schemastery';

/** 用户在设置页 / yml 里能填的字段（都可选，空着就是没配） */
export interface EditableConfig {
  /** DeepSeek 开放平台 API Key（sk-...）。留空 = 五个工具对 AI 不可见 */
  apiKey?: string;
  /** API 基址，默认 https://api.deepseek.com */
  baseUrl?: string;
  /** 搜索/读链接用的模型，默认 deepseek-flash */
  model?: string;
  /** 单个请求超时（毫秒），默认 180000 */
  timeoutMs?: number;
  /** OCR 默认识别模式 */
  ocrPurpose?: 'text_recognition' | 'rich_layout_recognition';
  /** TTS 默认音色：stella（女声）/ tide（男声） */
  ttsVoice?: string;
  /** TTS 默认输出格式 */
  ttsFormat?: 'wav' | 'pcm';
}

export const EditableConfigSchema: Schema<EditableConfig> = Schema.object({
  apiKey: Schema.string()
    .default('')
    .description(
      'DeepSeek 开放平台 API Key（sk- 开头）。留空时五个工具对 AI 不可见（不会报错，只是看不见）；'
      + '填了之后立刻生效，不用重启。',
    ),
  baseUrl: Schema.string()
    .default('https://api.deepseek.com')
    .description('API 基址，一般不用改；走代理/私有网关时才需要。'),
  model: Schema.string()
    .default('deepseek-flash')
    .description('联网搜索 / 读链接用的模型（这两个能力由模型驱动服务端工具）。'),
  timeoutMs: Schema.number()
    .default(180000)
    .description('单个请求超时（毫秒）。OCR / TTS 内部另有更长的固定超时，不受这里影响。'),
  ocrPurpose: Schema.union(['text_recognition', 'rich_layout_recognition'])
    .default('text_recognition')
    .description('OCR 默认模式：纯文字识别 / 带版面结构的富文本识别。'),
  ttsVoice: Schema.string()
    .default('stella')
    .description('TTS 默认音色：stella（女声）/ tide（男声）。'),
  ttsFormat: Schema.union(['wav', 'pcm'])
    .default('wav')
    .description('TTS 默认输出格式。wav 带文件头，pcm 是裸流。'),
});
