/**
 * 扫描一个目录树，找出「包含文档的文件夹」，输出索引。
 *
 * 判据：文件夹内（**递归**）存在任何教程类文件（.md / .mdx / .txt / .rst / README* / CHANGELOG* 等），
 * 就收录这个文件夹，并记下它包含的文档文件名（相对该文件夹的路径）。
 *
 * 用法：
 *   node scan-docs.cjs <根目录> <输出目录>
 * 默认：
 *   根目录   = D:\newwenjianjia\deepseek-harness
 *   输出目录 = D:\newwenjianjia\aiwork\鲸鱼娘\参考文档
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.argv[2] || 'D:\\newwenjianjia\\deepseek-harness';
const OUT = process.argv[3] || 'D:\\newwenjianjia\\aiwork\\鲸鱼娘\\参考文档';

/** 扫描时直接跳过的目录名（第三方依赖、构建产物、版本库内部） */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv', 'venv',
]);

/** 认定为「文档」的文件名/扩展名判据 */
const DOC_EXT_DOT = ['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc'];
const DOC_NAME_RE = /^(readme|changelog|install|contributing|architecture|design|guide|howto|handbook|spec)([.\-_].*)?$/i;

/** 是否为文档文件 */
function isDoc(fileName) {
  const lower = fileName.toLowerCase();
  const ext = path.extname(lower);
  if (DOC_EXT_DOT.includes(ext)) return true;
  // 无扩展名的 README / CHANGELOG 等
  if (!ext && DOC_NAME_RE.test(lower)) return true;
  return false;
}

/** 递归收集某目录下所有文档（相对 entryDir 的路径） */
function collectDocs(dir, entryDir, acc, skipSet) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipSet.has(e.name)) continue;
      collectDocs(full, entryDir, acc, skipSet);
    } else if (e.isFile() && isDoc(e.name)) {
      acc.push(path.relative(entryDir, full).replace(/\\/g, '/'));
    }
  }
}

/**
 * 第一层：遍历根目录下的所有文件夹（任意深度），
 * 对每个文件夹判断「它自己直接包含文档」还是「它的子目录才是文档所在的文件夹」。
 *
 * 规则按需求：**只要这个文件夹（含其子目录）里有文档，就收录这个文件夹**。
 * 但同时把「文档直接在这一层」与「在更深层」区分开，方便主人挑。
 */
function walk(dir, relFromRoot, results, skipSet) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // 本层直接有的文档
  const ownDocs = entries.filter((e) => e.isFile() && isDoc(e.name)).map((e) => e.name);

  // 子目录（跳过黑名单）
  const subDirs = entries.filter((e) => e.isDirectory() && !skipSet.has(e.name));

  // 先递归子目录
  for (const d of subDirs) {
    walk(path.join(dir, d.name), relFromRoot ? `${relFromRoot}/${d.name}` : d.name, results, skipSet);
  }

  // 本层（含所有后代）的文档总数
  const allDocs = [];
  collectDocs(dir, dir, allDocs, skipSet);

  if (allDocs.length === 0) return; // 整棵子树没文档 → 不收

  results.push({
    name: path.basename(dir),
    relPath: relFromRoot || '.',
    depth: relFromRoot ? relFromRoot.split('/').length : 0,
    ownDocs, // 直接放在这个文件夹里的文档
    docsCount: allDocs.length, // 含子目录
    docs: allDocs.slice(0, 200), // 防止超大目录把索引撑爆
    docsTruncated: allDocs.length > 200,
  });
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error('根目录不存在: ' + ROOT);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const results = [];
  walk(ROOT, '', results, SKIP_DIRS);

  // 排序：有「自己的文档」的优先，再按文档数降序
  results.sort((a, b) => {
    const ao = a.ownDocs.length > 0 ? 1 : 0;
    const bo = b.ownDocs.length > 0 ? 1 : 0;
    if (ao !== bo) return bo - ao;
    if (b.docsCount !== a.docsCount) return b.docsCount - a.docsCount;
    return a.relPath.localeCompare(b.relPath);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    skipDirs: [...SKIP_DIRS],
    totalFolders: results.length,
    foldersWithOwnDocs: results.filter((r) => r.ownDocs.length > 0).length,
    folders: results,
  };

  fs.writeFileSync(path.join(OUT, '索引.json'), JSON.stringify(payload, null, 2), 'utf8');

  // 人可读版：按相对路径分组列出
  const lines = [];
  lines.push('# deepseek-harness 文档地图书');
  lines.push('');
  lines.push(`- 生成时间：${payload.generatedAt}`);
  lines.push(`- 根目录：\`${ROOT}\``);
  lines.push(`- 收录文件夹：**${payload.totalFolders}** 个（其中 ${payload.foldersWithOwnDocs} 个「自己这一层就有文档」）`);
  lines.push(`- 判据：文件夹内（含子目录）存在 .md / .mdx / .markdown / .txt / .rst / .adoc 或 README / CHANGELOG / INSTALL / DESIGN / GUIDE 等文件`);
  lines.push(`- 跳过：${[...SKIP_DIRS].join(', ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 一、自己这一层就有文档的文件夹（先看这些）');
  lines.push('');
  for (const r of results.filter((x) => x.ownDocs.length > 0)) {
    lines.push(`### \`${r.relPath}\``);
    lines.push(`- 文档 ${r.ownDocs.length} 个（含子目录共 ${r.docsCount} 个）`);
    for (const d of r.ownDocs.slice(0, 30)) lines.push(`  - ${d}`);
    if (r.ownDocs.length > 30) lines.push(`  - …另有 ${r.ownDocs.length - 30} 个`);
    lines.push('');
  }
  lines.push('## 二、文档在子目录里的文件夹');
  lines.push('');
  for (const r of results.filter((x) => x.ownDocs.length === 0)) {
    lines.push(`- \`${r.relPath}\` —— ${r.docsCount} 个文档，例：${r.docs.slice(0, 3).join(' / ')}`);
  }
  lines.push('');

  fs.writeFileSync(path.join(OUT, '索引.md'), lines.join('\n'), 'utf8');

  console.log(`扫描完成：${payload.totalFolders} 个文件夹有文档（${payload.foldersWithOwnDocs} 个自己这层就有）`);
  console.log(`输出：\n  ${path.join(OUT, '索引.json')}\n  ${path.join(OUT, '索引.md')}`);
}

main();
