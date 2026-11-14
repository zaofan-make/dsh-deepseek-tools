# ds全家桶

> DeepSeek「全家桶应用 API」五件套，做成**独立 DSH 插件** —— 不用装 QQ 机器人也能用。

五个工具，**注册在全局层 ⇒ 所有会话（终端 / Web / QQ / 任何接入）都能直接调用**：

| 工具 | 能力 |
|---|---|
| `ds_search` | 联网搜索 / 深度思考搜索（多步检索+开页+页内查找）/ **按图搜索** |
| `ds_readurl` | 读网页并作答，一次最多 10 个链接 |
| `ds_ocr` | 识别 PDF / Word / PPT / 图片里的文字，按页返回；可切「版面结构」模式 |
| `ds_asr` | 音频转文字（16bit PCM WAV 或 Ogg Opus，≤8MiB / ≤120s） |
| `ds_tts` | 文字转语音（stella 女声 / tide 男声），合成后**保存成文件**返回路径 |

## 安装

下载本仓库 Release 里的 `.tgz`，然后：

```bash
dsh plugin --profile web add <下载后的 tgz 完整路径>
```

重启 dsh。

## 配置 API Key

**在插件页里改**：打开「插件」→ 点本插件 → 右侧「DeepSeek 设置」卡片，填 `API Key`，点保存，**即时生效、不用重启**。

也可以写进 `cordis.patch.yml`：

```yaml
- insert:
    - id: deepseek-tools
      name: '@zaofan/dsh-deepseek-tools'
      config:
        apiKey: sk-xxxxxxxx
        model: deepseek-flash
```

**没填 Key 会怎样**：五个工具**仍然存在**（不会报 `unknown tool`），调用时返回
「还没配 API Key，请去插件页填」——不会静默失败，也不会污染其它插件。

## 可调项（都有默认值）

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKey` | 空 | DeepSeek 开放平台 Key（`sk-` 开头） |
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

读一下这三个链接，告诉我安装步骤有什么不同
（→ ds_readurl）

把这个 PDF 里的表格识别出来
（→ ds_ocr path=D:\docs\report.pdf purpose=rich_layout_recognition）

这段语音说了什么
（→ ds_asr path=D:\audio\voice.ogg）

把这句话合成语音，用男声
（→ ds_tts text=今天也要好好吃饭 voice=tide）
```

## 注意

- **ASR**：只吃 16bit PCM WAV 或 Ogg Opus，≤8MiB、≤120 秒。MP3/AMR 要先转码。
- **OCR**：文件 ≤100 MiB。
- **TTS**：单次 ≤10,000 个计费字符，超了请分段。
- 这些额度/限制都来自 DeepSeek 官方接口，本插件只做封装。

## 开发备注（DSH 插件三件事，实测踩坑）

想给 DSH 插件配好「名字 / 图标 / 设置页」，需要分别做三件事，**互不替代**：

1. **显示名 + 描述** → `locale/zh.json`（`locale/en.json` 同理）
   ```json
   { "meta": { "title": "ds全家桶", "description": "…" } }
   ```
   并在 `package.json` 的 `exports` 里暴露 `"./locale/*.json"`。

2. **插件列表图标** → `package.json` **顶层** `icon` 字段
   ```json
   "icon": "./icon.png"
   ```
   建议 256×256 PNG。（`dsh.client`、`dsh-plugin.json` 都不管这个。）

3. **设置页表单** → 必须自己写 `client.js`（DSH **不会**从 schema 自动生成表单）
   - `window.__ModuleLoader__.load({ id: '<npm 包名>', factory })`
   - `ctx.inject(['remote','remote.settings'])` 拿 `rpc`，`ctx.inject(['slots'])` 注册卡片
   - 插槽 `plugins.bundle.config`（key = npm 包名）
   - 读写：`rpc.describe()` / `rpc.mutate(ns, ops, revision)`
   - 主机端 schema 字段**必须**标 `.volatile()`，否则保存报
     `Plugin entry "<ns>" has no volatile fields`
     注意 schemastery 的 `.volatile()` **返回一个新 schema**，要用返回值

## 许可

MIT
