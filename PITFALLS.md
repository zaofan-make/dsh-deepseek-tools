# 踩坑记录（PITFALLS）

这份文档记录开发本插件时**实际踩到**的坑，每一条都是「现象 → 原因 → 正确做法」。
如果你在写 DSH 插件，这些坑大概率也会遇到。

DSH 版本：`0.2.2-rc.3`

---

## 1. `export const inject` 少声明服务 → 插件静默不激活

**现象**

插件装了、显示「运行中」，但设置页没有、工具也不存在。启动日志里只有一行很难注意到的：

```
dsh: warning: 1 entry did not activate
deepseek-tools (@zaofan/dsh-deepseek-tools): Error: cannot get property "tools" without inject
```

**原因**

Cordis 的 `ctx` 是**受限访问**的：读 `ctx.tools`、`ctx.settings` 这类服务属性，必须先在
`export const inject` 里**静态声明**。没声明就读，会直接抛错，整个 `apply` 失败 —— 而宿主
只在你特意去看启动日志时才告诉你。

**正确做法**

```ts
export const inject = ['tools']          // 要用 ctx.tools 就写
export const inject = ['agents', 'commands']  // 多个服务照写
```

`ctx.inject(['settings'], cb)` 那种**动态注入**不受此限，但静态声明更保险。

---

## 2. schemastery 的 `.volatile()` 返回**新 schema**

**现象**

字段都标了 `.volatile()`，`meta.volatile` 却是 `undefined`，插件页设置表单怎么都不出现。

**原因**

```js
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError('volatile schema is already wrapped')
  return this.extra('volatile', true)   // ← 返回新对象，不修改原对象
}
```

它**不可变**。只调用不接收返回值，等于什么都没做。

**正确做法**

```ts
// ✗ 错：返回值丢了
Schema.string().volatile()
return schema

// ✓ 对：用返回值
return schema.volatile()

// ✓ 也可以链式写
apiKey: Schema.string().default('').description('…').volatile()
```

标注后，`dsh-settings` 的 `volatileForm(schema)` 才能把它投影成可写字段；
**没标就会在保存时报** `Plugin entry "<ns>" has no volatile fields`。

---

## 3. DSH **不会**从 schema 自动生成设置表单

**现象**

`schema` 写好了、`installSection` 也注册了，插件页右侧还是只有 README，没有表单。

**原因**

这是最容易误解的一点：**`installSection` 只注册数据层（schema + 读写），UI 必须自己写**。
`dsh-aiwatch`、`dsh-grok-kit`、`dsh-qqbot` 都有自己的 `client.js`。

**正确做法**

写一个 `client.js`，用「懒 CJS 协议」注册卡片到插槽：

```js
window.__ModuleLoader__.load({
  id: '@zaofan/dsh-deepseek-tools',        // ← 必须等于 npm 包名
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    function apply(ctx) {
      ctx.inject(['remote', 'remote.settings'], (rscope) => {
        var rpc = rscope.remote.settings          // describe() / mutate()
        ctx.inject(['slots'], (scope) => {
          var react = require('react')
          var Card = makeCard(react, rpc)
          scope.slots.inject('plugins.bundle.config', function* () {
            yield scope.slots.register(
              { name: 'plugins.bundle.config', key: '@zaofan/dsh-deepseek-tools' },
              Card,
            )
          })
        })
      })
    }
    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
```

并且在 `package.json` 里：

```json
{
  "exports": { "./client": "./client.js" },
  "dsh": { "client": { "inject": [], "platform": "web", "immediately": true } }
}
```

**读写走 RPC**：

```js
rpc.describe()                              // → { namespaces: [{ ns, value, revision }] }
rpc.mutate(ns, [{ op: 'set', path: ['apiKey'], value: '' }], revision)
```

返回信封是 `{ ok: true, value }` / `{ ok: false, error: { message } }`，**要先拆包**再读。

---

## 4. 显示名 + 描述用 `locale/*.json`，不是 `displayName`

**现象**

`package.json` 里加了 `displayName: "ds全家桶"`，插件列表里还是显示 `@zaofan/dsh-deepseek-tools`。

**原因**

DSH 读的是 **locale 文件里的 `meta`**，不是 `package.json` 的私有字段。

**正确做法**

`locale/zh.json`：

```json
{
  "meta": {
    "title": "ds全家桶",
    "description": "DeepSeek 全家桶五件套：联网搜索 / 读链接 / OCR / ASR / TTS。"
  }
}
```

`locale/en.json` 同理。并在 `exports` 里暴露：

```json
"exports": { "./locale/*.json": "./locale/*.json" }
```

`files` 也要带上 `locale/*.json`，否则发布时丢了。

---

## 5. 插件列表图标 = `package.json` 顶层 `icon` 字段

**现象**

试过 `dsh-plugin.json`、`dsh.client`、client 里注册图标组件 —— 插件列表里的图标始终是默认的蓝色方块。

**原因**

DSH 只看 `package.json` 的**顶层 `icon`** 字段。参考 `dsh-whale-widget`：

```json
{ "icon": "./icon.png" }
```

**正确做法**

```json
{
  "icon": "./icon.png"
}
```

· 建议 **256×256 PNG**（SVG 不一定认）
· 路径相对包根目录
· 记得加进 `files`

**不要用的东西**：

· `dsh-plugin.json` —— 那是**第三方插件市场**的清单格式，DSH 本体不读
· `dsh.client.icon` —— 不存在这个字段
· 插槽 `plugins.item` / `plugins.bundle.config` 的注册对象 —— 它们的 owner
  `PluginConfigViewProps` **没有 icon 字段**

---

## 6. `plugins.bundle.config` 的 key 必须是 npm 包名

**现象**

卡片注册了，但插件页不显示。

**原因**

`dsh-client-ui-plugin-manager` 用包名派发插槽：

```tsx
renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name })
```

`key` 写错（比如写成插件 id `deepseek-tools`）就匹配不上。

**正确做法**

```js
scope.slots.register({ name: 'plugins.bundle.config', key: '@zaofan/dsh-deepseek-tools' }, Card)
```

（`settings.plugin.item` 那套是按 **namespace** 派发，key 用 schema 注册的 ns。）

---

## 7. 在 profile 目录里跑 `pnpm add` 会重装整棵依赖树

**现象**

给 profile 装一个新插件（`pnpm add file:...`），结果已有的插件被换回 `package.json` 里声明的旧版本，
设置页接口全部 404。

**原因**

pnpm 会按 `package.json` 的声明**重新解析并安装**整个依赖树。如果之前是手动把新版覆盖进
`node_modules`（而 `package.json` 里还写着旧版本号），一跑 pnpm 就全被打回原样。

**正确做法**

· 插件一律走 `pnpm add <包名>@<版本>` 从 npm 装，保证「声明 == 实际」
· **不要**在 profile 目录里手动覆盖 `node_modules`
· 想测本地开发版，用 `file:` 依赖 + 明确的版本号，别混着来

---

## 8. `file:` 依赖是符号链接，编译时缺工具链

**现象**

插件用 `file:` 装到 profile，改完代码要编译，但项目自己没有 `typescript` / `@deepseek-ai/dsh-tools`。

**原因**

这些包是 `peerDependencies`，由宿主提供，不在插件自己的 `node_modules` 里。

**变通做法**

临时软链宿主或别的插件目录拿 `tsc`：

```powershell
New-Item -ItemType Junction -Path node_modules -Target <有 typescript 的目录>\node_modules
node node_modules\typescript\bin\tsc
(Get-Item node_modules).Delete()   # 编完删掉，别提交
```

⚠️ 注意 `@deepseek-ai/schemastery` 的版本差异：**旧版没有 `.volatile()`**。
如果软链到旧版环境会编译失败，需要指向宿主实际使用的那个版本。

---

## 9. `dist/` 不进 git，但 npm 包需要它

**现象**

从 GitHub 直接 `git clone` 装插件，报 `failed to import` / 找不到 `dist/index.js`。

**原因**

仓库不提交编译产物，而 pnpm 对 git 依赖默认**不执行** `prepare` 脚本。

**做法**

· 用 **Release 里的 `.tgz`**（自带 `dist/`，装上即用）
· 或者 clone 后手动 `npm install && npm run build`

`package.json` 里加 `prepublishOnly: "npm run build"`，`npm pack` 前会自动编译。

---

## 附：排查顺序（省时间）

1. **看启动日志**的 `warning: N entry did not activate` —— 插件加载失败都在这
2. `inject` 声明够不够
3. schema 字段有没有 `.volatile()`（且用返回值）
4. `package.json` 的 `exports` / `dsh.client` 齐不齐
5. `client.js` 的插槽 key 是不是 npm 包名
6. 最后才怀疑宿主版本
