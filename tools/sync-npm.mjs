import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { checkIndex, loadModules, root } from './verify.mjs';

/** 只读取公共 npm 的 latest，不执行模块代码；展示信息由索引仓维护。 */
export async function resolveNpmModules(modules) {
  const updated = structuredClone(modules);
  const queue = Object.values(updated);
  const errors = [];
  async function resolve(module) {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(module.npm)}/latest`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const published = await response.json();
      if (published.name !== module.npm) throw new Error('published package name mismatch');
      if (typeof published.version !== 'string' || !semver.valid(published.version))
        throw new Error('latest must be an exact SemVer');
      if (semver.prerelease(published.version)) throw new Error('latest points to a prerelease; publish it under beta instead');
      if (semver.lt(published.version, module.version)) {
        const current = await fetch(`https://registry.npmjs.org/${encodeURIComponent(module.npm)}/${encodeURIComponent(module.version)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        // 旧索引可能提前登记了未发布版本。仅在 npm 明确返回 404 时修正。
        if (current.status !== 404) {
          if (!current.ok) throw new Error(`current version check: HTTP ${current.status}`);
          throw new Error(`refusing downgrade ${module.version} -> ${published.version}`);
        }
        console.warn(`${module.id}: correcting unpublished index version ${module.version} -> ${published.version}`);
      }
      if (published.deprecated) throw new Error('latest version is deprecated');
      const sdk = published.peerDependencies?.['@sfmc-bds/sdk'];
      if (typeof sdk !== 'string' || !sdk.trim() || semver.validRange(sdk) === null)
        throw new Error('latest has no valid @sfmc-bds/sdk peer dependency');
      module.version = published.version;
      module.sdk = sdk;
    } catch (error) {
      errors.push(`${module.id}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await resolve(queue.shift());
  }));
  // 任一请求或契约失败都不写文件，避免发布一半成功的同步结果。
  if (errors.length) throw new Error(errors.sort().join('\n'));
  checkIndex({ version: 2, generatedAt: new Date().toISOString(), modules: updated });
  return updated;
}

export async function syncNpm({ dryRun = false } = {}) {
  const modules = await loadModules();
  const updated = await resolveNpmModules(modules);
  const changed = Object.keys(updated).filter(id => JSON.stringify(updated[id]) !== JSON.stringify(modules[id]));
  for (const id of changed) {
    console.log(`${id}: ${modules[id].version} -> ${updated[id].version}; sdk ${modules[id].sdk} -> ${updated[id].sdk}`);
  }
  if (!dryRun) {
    for (const id of changed) {
      const target = path.join(root, 'modules', `${id}.json`);
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        // 保留原始排版与字段顺序，只替换 npm 管理的两个字段。
        const original = await readFile(target, 'utf8');
        const content = original
          .replace(/("version"\s*:\s*)"[^"\\]*"/, (_, prefix) => `${prefix}${JSON.stringify(updated[id].version)}`)
          .replace(/("sdk"\s*:\s*)"[^"\\]*"/, (_, prefix) => `${prefix}${JSON.stringify(updated[id].sdk)}`);
        if (JSON.stringify(JSON.parse(content)) !== JSON.stringify(updated[id]))
          throw new Error(`${id}: could not safely replace version/sdk`);
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }
  console.log(`${dryRun ? 'Previewed' : 'Synced'} npm latest: ${changed.length} changed, ${Object.keys(updated).length} checked`);
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) {
    console.error('Usage: node tools/sync-npm.mjs [--dry-run]');
    process.exitCode = 1;
  } else {
    syncNpm({ dryRun: args.includes('--dry-run') }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
