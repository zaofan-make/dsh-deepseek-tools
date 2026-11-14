# dsh-deepseek-tools

> DeepSeek「全家桶应用 API」五件套，做成**独立 DSH 插件** —— 不用装 QQ 机器人也能用。

五个工具，**注册在全局层 ⇒ 所有会话（终端 / Web / QQ / 任何接入）都能直接调用**：

| 工具 | 能力 |
|---|---|
| `ds_search` | 联网搜索 / 深度思考搜索（多步检索+开页+页内查找）/ **按图搜索** |
| `ds_readurl` | 读网页并作答，一次最多 10 个链接 |
| `ds_ocr` | 识别 PDF / Word / PPT / 图片里的文字，按页返回；可切「版面结构」模式 |
| `ds_asr` | 音频转文字（16bit PCM WAV 或 Ogg Opus，≤8MiB / ≤120s） |
| `ds_tts` | 文字转语音（stella 女声 / tide 男声），合成后**保存成文件**返回路径 |

## 为什么要单独做一个

很多人只是想在 DSH 里用上 DeepSeek 的这五个能力，但不想装整个 QQ 机器人插件。
这个包就是为此准备的：**零额外依赖、只做这五个工具、带独立设置页**。

（如果你已经在用 `@zaofan/dsh-qqbot`，它的扩展包市场里也有同名能力的 `deepseek-kit`，
两者工具名前缀不同（`ds_*` vs `dskit_*`）、配置各存各的，装在一起不会互相干扰。）

## 安装

```bash
dsh plugin --profile <你的profile> add @zaofan/dsh-deepseek-tools
```

装好后重启 dsh。

## 配置 API Key（两种方式，任选）

**方式一：设置页（推荐）**

重启后打开 DSH 的【设置】，找到 **deepseek-tools** 一节，把 `apiKey` 填成你的
DeepSeek 开放平台 Key（`sk-` 开头）。**改完即时生效，不用重启。**

**方式二：写进配置**

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: deepseek-tools
  config:
    apiKey: sk-xxxxxxxx
```

**没填 Key 会怎样**：五个工具**仍然存在**（不会报 `unknown tool`），调用时会返回一句
「还没配 API Key，请去设置页填」——不会静默失败，也不会污染其它插件。

## 其余可调项（都有默认值）

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `https://api.deepseek.com` | 走代理 / 私有网关时才改 |
| `model` | `deepseek-flash` | 搜索与读链接用的模型 |
| `timeoutMs` | `180000` | 单个请求超时（OCR/TTS 内部另有更长固定超时） |
| `ocrPurpose` | `text_recognition` | 可切 `rich_layout_recognition`（带版面） |
| `ttsVoice` | `stella` | 女声；男声是 `tide` |
| `ttsFormat` | `wav` | 或 `pcm`（裸流） |

## 用法示例

```text
帮我搜一下 2026 年最新的 RPG Maker 插件生态，要带来源
（→ ds_search，thinking=true）

读一下这三个链接，告诉我它们的安装步骤有什么不同
（→ ds_readurl）

把这个 PDF 里的表格识别出来
（→ ds_ocr path=D:\docs\report.pdf purpose=rich_layout_recognition）

这段语音说了什么
（→ ds_asr path=D:\audio\voice.ogg）

把这句话合成语音，用男声
（→ ds_tts text=今天也要好好吃饭 voice=tide）
```

## 注意

- **ASR 限制**：只吃 16bit PCM WAV 或 Ogg Opus，≤8MiB、≤120 秒。MP3/AMR 要先转码。
- **OCR 限制**：文件 ≤100 MiB。
- **TTS 限制**：单次 ≤10,000 个计费字符，超了请分段。
- 这些额度/限制都来自 DeepSeek 官方接口，本插件只做封装。

## 许可

MIT
