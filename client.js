// ds全家桶 的浏览器端：插件详情页里的「DeepSeek 设置」卡片
//
// 为什么需要这个文件：**dsh 不会从 settings schema 自动生成表单**（dsh-aiwatch / modsearch 的注释里都写了）。
// 插件要在「插件列表 → 某个插件」详情页里出现配置区，必须自己注册一个组件到插槽
// `plugins.bundle.config`（`dsh-client-ui-plugin-manager` 用
//   renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name })
// 渲染它，**key 必须等于 npm 包名**）。
//
// 配置读写走 dsh 官方给客户端的设置 RPC：ctx.remote.settings.describe() / mutate(ns, ops, revision)。
// 主机端（dist/index.js）已经把 Config 字段都标了 `.volatile()`，所以这些字段**可写**；
// 没标就会报 `Plugin entry "<ns>" has no volatile fields`。
//
// 写法照抄 dsh-aiwatch 的「懒 CJS 协议」：window.__ModuleLoader__.load({ id, factory })，
// factory 返回 cordis 插件的 exports —— 不需要构建、不 import 任何 dsh 客户端包。
window.__ModuleLoader__.load({
  id: '@zaofan/dsh-deepseek-tools',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // 插件详情页按 npm 包名派发插槽
    var PKG = '@zaofan/dsh-deepseek-tools';
    // 设置命名空间 = cordis.patch.yml 里那条插件的 id（写的是 deepseek-tools）；两个都试
    var NS_CANDIDATES = ['deepseek-tools', '@zaofan/dsh-deepseek-tools'];

    // 字段表：顺序即显示顺序。
    // ⚠️ def = 主机端 schema 里的默认值。**必须有**：配置文件里没写这个键时 describe() 给的
    //   value 是 undefined，不兜默认值就会显示成空，而且一保存就会把错值写进配置。
    var FIELDS = [
      { key: 'apiKey', label: 'API Key', hint: 'sk- 开头的 DeepSeek 开放平台 Key；留空则五个工具调用时提示"还没配 Key"', type: 'text', def: '' },
      { key: 'baseUrl', label: 'API 基址', hint: '一般不用改；走代理 / 私有网关时才需要', type: 'text', def: 'https://api.deepseek.com' },
      { key: 'model', label: '模型', hint: '联网搜索 / 读链接用的模型', type: 'text', def: 'deepseek-flash' },
      { key: 'timeoutMs', label: '请求超时（毫秒）', hint: '单个请求超时；OCR / TTS 内部另有更长的固定超时', type: 'number', def: 180000 },
      { key: 'ocrPurpose', label: 'OCR 模式', hint: 'text_recognition=纯文字；rich_layout_recognition=带版面结构', type: 'enum', def: 'text_recognition', options: ['text_recognition', 'rich_layout_recognition'] },
      { key: 'ttsVoice', label: '语音音色', hint: 'stella=女声 / tide=男声', type: 'text', def: 'stella' },
      { key: 'ttsFormat', label: '语音格式', hint: 'wav=带文件头 / pcm=裸流', type: 'enum', def: 'wav', options: ['wav', 'pcm'] },
    ];

    var S = {
      box: { padding: '4px 0 12px' },
      title: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 600, margin: '0 0 4px' },
      sub: { fontSize: '12px', opacity: 0.6, margin: '0 0 12px' },
      row: { display: 'flex', alignItems: 'flex-start', gap: '12px', margin: '0 0 10px' },
      label: { width: '190px', flex: '0 0 auto', fontSize: '13px', paddingTop: '6px' },
      hint: { fontSize: '11px', opacity: 0.55, marginTop: '4px' },
      col: { flex: '1 1 auto', minWidth: 0 },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '13px',
        color: 'inherit', background: 'transparent', border: '1px solid rgba(128,128,128,.45)',
        borderRadius: '6px', outline: 'none',
      },
      bar: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' },
      btn: {
        padding: '6px 14px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer',
        border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit',
      },
      note: { fontSize: '12px', opacity: 0.7 },
      err: { fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' },
    };

    /** 设置里这个字段的有效值：没写就用 schema 默认值，别当成空/false */
    function effective(key, value) {
      var field = FIELDS.filter(function (f) { return f.key === key; })[0];
      if (value === undefined || value === null) return field ? field.def : value;
      return value;
    }

    /** 设置值 → 卡片草稿（数字转字符串，便于受控输入） */
    function toDraft(key, value) {
      var field = FIELDS.filter(function (f) { return f.key === key; })[0];
      var v = effective(key, value);
      if (!field) return v;
      if (v === null || v === undefined) return '';
      return String(v);
    }

    /** 草稿 → 真正写进配置的值 */
    function fromDraft(key, draft) {
      var field = FIELDS.filter(function (f) { return f.key === key; })[0];
      if (!field) return draft;
      if (field.type === 'number') {
        var n = Number(String(draft == null ? '' : draft).trim());
        return isFinite(n) ? n : field.def;
      }
      return String(draft == null ? '' : draft);
    }

    function sameValue(a, b) {
      return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    }

    /** 解开 dsh 远程调用的信封：成功 { ok: true, value }，失败 { ok: false, error } */
    function unwrap(response) {
      if (response && typeof response === 'object' && 'ok' in response) {
        if (response.ok === false) {
          throw new Error(response.error && response.error.message ? response.error.message : '远程调用失败');
        }
        return response.value;
      }
      return response;
    }

    function makeCard(react, rpc) {
      var h = react.createElement;

      // 官方图标集（@deepseek-ai/dsh-client-ui-primitives）；拿不到就退化成纯文字标题
      var primitives = null;
      try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch (e) { primitives = null; }
      var IconSearch = primitives && primitives.IconSearchOutline16;

      return function DsToolsSettingsCard() {
        var stateStore = react.useState({ phase: 'loading' });
        var state = stateStore[0];
        var setState = stateStore[1];
        var noteStore = react.useState('');
        var note = noteStore[0];
        var setNote = noteStore[1];

        var load = react.useCallback(function () {
          setNote('');
          setState({ phase: 'loading' });
          Promise.resolve(rpc.describe()).then(unwrap).then(function (view) {
            var list = (view && view.namespaces) || [];
            var hit = null;
            for (var i = 0; i < list.length; i++) {
              var ns = String((list[i] && list[i].ns) || '');
              if (NS_CANDIDATES.indexOf(ns) >= 0) { hit = list[i]; break; }
              if (!hit && ns.indexOf('deepseek-tools') >= 0) hit = list[i];
            }
            if (!hit) {
              setState({
                phase: 'error',
                message: '没找到本插件的配置入口。当前可见的命名空间：'
                  + (list.map(function (n) { return n.ns; }).join(', ') || '(空)'),
              });
              return;
            }
            var value = hit.value || {};
            var draft = {};
            FIELDS.forEach(function (f) { draft[f.key] = toDraft(f.key, value[f.key]); });
            setState({ phase: 'ready', ns: String(hit.ns), revision: hit.revision, value: value, draft: draft });
          }).catch(function (error) {
            setState({ phase: 'error', message: '读取配置失败：' + (error && error.message ? error.message : String(error)) });
          });
        }, []);

        react.useEffect(function () { load(); }, [load]);

        function setField(key, next) {
          setState(function (prev) {
            if (prev.phase !== 'ready') return prev;
            var draft = Object.assign({}, prev.draft);
            draft[key] = next;
            return Object.assign({}, prev, { draft: draft });
          });
        }

        function save() {
          if (state.phase !== 'ready') return;
          var ops = [];
          FIELDS.forEach(function (f) {
            var before = effective(f.key, state.value[f.key]);
            var after = fromDraft(f.key, state.draft[f.key]);
            if (!sameValue(before, after)) ops.push({ op: 'set', path: [f.key], value: after });
          });
          if (!ops.length) { setNote('没有改动'); return; }
          setNote('保存中…');
          Promise.resolve(rpc.mutate(state.ns, ops, state.revision)).then(unwrap).then(function () {
            setNote('已保存（' + ops.length + ' 项）');
            load();
          }).catch(function (error) {
            setNote('');
            setState(function (prev) {
              return Object.assign({}, prev, {
                message: '保存失败：' + (error && error.message ? error.message : String(error)),
              });
            });
          });
        }

        function discard() { load(); }

        if (state.phase === 'loading') {
          return h('div', { style: S.box }, h('div', { style: S.note }, '读取配置中…'));
        }
        if (state.phase === 'error') {
          return h('div', { style: S.box },
            h('div', { style: S.title }, IconSearch ? h(IconSearch, { size: 16 }) : null, 'DeepSeek 设置'),
            h('div', { style: S.err }, state.message || '读取失败'),
            h('div', { style: S.bar }, h('button', { type: 'button', style: S.btn, onClick: load }, '重试')));
        }

        var children = [
          h('div', { key: 'title', style: S.title }, IconSearch ? h(IconSearch, { size: 16 }) : null, 'DeepSeek 设置'),
          h('div', { key: 'sub', style: S.sub },
            '改完点保存即时生效（不用重启）。没填 API Key 时五个工具仍然存在，只是调用会提示还没配 Key。'),
        ];

        FIELDS.forEach(function (f) {
          var value = state.draft[f.key];
          var control;
          if (f.type === 'enum') {
            control = h('select', {
              key: 'c', style: S.input, value: value,
              onChange: function (e) { setField(f.key, e.target.value); },
            }, (f.options || []).map(function (op) {
              return h('option', { key: op, value: op }, op);
            }));
          } else if (f.type === 'number') {
            control = h('input', {
              key: 'c', style: S.input, type: 'number', value: value,
              onChange: function (e) { setField(f.key, e.target.value); },
            });
          } else {
            control = h('input', {
              key: 'c', style: S.input, type: 'text', value: value,
              placeholder: f.key === 'apiKey' ? 'sk-...' : '',
              onChange: function (e) { setField(f.key, e.target.value); },
            });
          }
          children.push(h('div', { key: f.key, style: S.row },
            h('div', { style: S.label }, f.label),
            h('div', { style: S.col }, control, h('div', { style: S.hint }, f.hint))));
        });

        children.push(h('div', { key: 'bar', style: S.bar },
          h('button', { type: 'button', style: S.btn, onClick: save }, '保存'),
          h('button', { type: 'button', style: S.btn, onClick: discard }, '放弃修改'),
          h('span', { style: S.note }, note || (state.message || ''))));

        return h('div', { style: S.box }, children);
      };
    }

    function apply(ctx) {
      if (typeof ctx.inject !== 'function') return;
      // remote.settings 是可选的：没有它（非 web 环境）就静静不注册卡片
      ctx.inject(['remote', 'remote.settings'], function (rscope) {
        var rpc = rscope.remote.settings;
        ctx.inject(['slots'], function (scope) {
          var react;
          try {
            react = require('react');
          } catch (error) {
            console.error('[ds全家桶] 设置卡片跳过：' + error);
            return;
          }
          var Card = makeCard(react, rpc);
          // 插件详情页（dsh 0.1.6-alpha.2 起）；旧版宿主用 settings.plugin.item，这里也补一份
          scope.slots.inject('plugins.bundle.config', function* () {
            yield scope.slots.register({ name: 'plugins.bundle.config', key: PKG }, Card);
          });
          scope.slots.inject('settings.plugin.item', function* () {
            yield scope.slots.register({ name: 'settings.plugin.item', id: 'deepseek-tools', key: 'deepseek-tools', order: 31 }, Card);
          });
        });
      });
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
