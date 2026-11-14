/**
 * 插件配置 Schema。
 *
 * 两个入口共用同一份结构：
 *   · 编辑 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里的 `config`（重新加载后生效）
 *   · **「插件」页里的表单** —— 每个字段都标了 `.volatile()`，
 *     dsh-settings 的 `volatileForm(schema)` 会把这些字段渲染成插件详情页里的可编辑表单，
 *     **点保存即生效，不用手改 yml，也不用重启**。
 *
 * ⚠️ 不标 `.volatile()` 的字段不会出现在插件页表单里；整份 schema 一个 volatile 都没有时，
 *    点保存会报 `Plugin entry "xxx" has no volatile fields`（dsh-aiwatch 踩过这个坑）。
 *
 * 🔧 为什么用 `V()` 包一层：`volatile()` 是 schemastery **3.18.5+** 才有的方法，
 *    本包的本地 node_modules 可能装着旧版（类型里没有它）。用运行时探测 + 类型断言，
 *    旧版下静默跳过（退化成"只能改 yml"），新版下正常出表单。
 */
import Schema from '@deepseek-ai/schemastery';

/**
 * 把某个字段标记成 volatile（可出现在插件页表单里、且运行时是实时值）。
 *
 * ⚠️ **必须用返回值** —— schemastery 的 `.volatile()` 是
 *   `return this.extra('volatile', true)`，它返回一个**新 schema**，不是原地改；
 *   只调用不接收返回值的话，`meta.volatile` 永远是 undefined，
 *   插件页表单也就永远渲染不出来（这是本项目踩过的坑）。
 *
 * 旧版 schemastery 没有这个方法时静默跳过，退化成"只能改 yml"。
 */
function V<T>(schema: T): T {
  try {
    const s = schema as unknown as { volatile?: () => unknown };
    if (typeof s.volatile === 'function') return s.volatile() as T;
  } catch {
    /* 旧版 schemastery / 已经包过一次：保持原样 */
  }
  return schema;
}

/** 用户在插件页 / yml 里能填的字段（都可选，空着就是没配） */
export interface EditableConfig {
  /** DeepSeek 开放平台 API Key（sk-...）。留空 = 五个工具调用时提示"还没配 Key" */
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

export const EditableConfigSchema = Schema.object({
  apiKey: V(Schema.string()
    .default('')
    .description(
      'DeepSeek 开放平台 API Key（sk- 开头）。填在「插件 → dsh-deepseek-tools」这一页里，保存即生效。'
      + '留空时五个工具仍然存在，但调用会提示还没配 Key。',
    )),
  baseUrl: V(Schema.string()
    .default('https://api.deepseek.com')
    .description('API 基址，一般不用改；走代理或私有网关时才需要。')),
  model: V(Schema.string()
    .default('deepseek-flash')
    .description('联网搜索 / 读链接用的模型（这两个能力由模型驱动服务端工具）。')),
  timeoutMs: V(Schema.number()
    .default(180000)
    .description('单个请求超时（毫秒）。OCR / TTS 内部另有更长的固定超时，不受这里影响。')),
  ocrPurpose: V(Schema.union(['text_recognition', 'rich_layout_recognition'])
    .default('text_recognition')
    .description('OCR 默认模式：纯文字识别 / 带版面结构的富文本识别。')),
  ttsVoice: V(Schema.string()
    .default('stella')
    .description('TTS 默认音色：stella（女声）/ tide（男声）。')),
  ttsFormat: V(Schema.union(['wav', 'pcm'])
    .default('wav')
    .description('TTS 默认输出格式。wav 带文件头，pcm 是裸流。')),
});
