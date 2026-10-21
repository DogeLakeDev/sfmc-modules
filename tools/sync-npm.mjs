import { appendFile, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { checkIndex, loadModules, root } from './verify.mjs';

const managedFields = ['version', 'sdk', 'license', 'repo'];

// npm 的发布元数据是可安装版本的来源；不读取或执行模块源码。
export function repositoryUrl(repository) {
  let value = typeof repository === 'string' ? repository : repository?.url;
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('invalid published repository');
  value = value.trim().replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search)
    throw new Error('published repository must be a public HTTPS URL');
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
  return url.toString().replace(/\/$/, '');
}

export async function resolveNpmModules(modules, { fetchImpl = globalThis.fetch } = {}) {
  const updated = structuredClone(modules);
  const queue = Object.values(updated);
  const errors = [];
  async function getPackage(module, version) {
    return fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(module.npm)}/${encodeURIComponent(version)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  }
  async function resolve(module) {
    try {
      const response = await getPackage(module, 'latest');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const published = await response.json();
      if (published.name !== module.npm) throw new Error('published package name mismatch');
      if (typeof published.version !== 'string' || semver.valid(published.version) !== published.version)
        throw new Error('latest must be an exact SemVer');
      if (semver.prerelease(published.version)) throw new Error('latest points to a prerelease; use a separate dist-tag');
      if (published.deprecated) throw new Error('latest version is deprecated');
      if (semver.lt(published.version, module.version)) {
        const current = await getPackage(module, module.version);
        // 只有明确的 404 才允许纠正提前登记、尚未发布的版本。
        if (current.status !== 404) {
          if (!current.ok) throw new Error(`current version check: HTTP ${current.status}`);
          throw new Error(`refusing downgrade ${module.version} -> ${published.version}`);
        }
        console.warn(`${module.id}: correcting unpublished version ${module.version} -> ${published.version}`);
      }
      const sdk = published.peerDependencies?.['@sfmc-bds/sdk'];
      if (typeof sdk !== 'string' || !sdk.trim() || semver.validRange(sdk) === null)
        throw new Error('latest has no valid @sfmc-bds/sdk peer dependency');
      if (typeof published.license !== 'string' || !published.license.trim())
        throw new Error('latest has no license');
      module.version = published.version;
      module.sdk = sdk.trim();
      module.license = published.license.trim();
      const repo = repositoryUrl(published.repository);
      if (repo) module.repo = repo;
    } catch (error) {
      errors.push(`${module.id}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await resolve(queue.shift());
  }));
  if (errors.length) throw new Error(errors.sort().join('\n'));
  checkIndex({ version: 2, generatedAt: new Date().toISOString(), modules: updated });
  return updated;
}

export async function syncNpm({ dryRun = false, directory = root, fetchImpl = globalThis.fetch, summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
  const modules = await loadModules(directory);
  const updated = await resolveNpmModules(modules, { fetchImpl });
  const changed = Object.keys(updated).filter(id => JSON.stringify(updated[id]) !== JSON.stringify(modules[id]));
  const changes = changed.map(id => ({
    id,
    fields: managedFields.filter(field => updated[id][field] !== modules[id][field])
      .map(field => `${field}: ${modules[id][field] ?? '—'} -> ${updated[id][field]}`),
  }));
  for (const change of changes) console.log(`${change.id}: ${change.fields.join('; ')}`);

  // 先验证全部响应并准备全部文件，再逐文件原子替换；错误时 CI 不提交结果。
  if (!dryRun) {
    const prepared = [];
    try {
      for (const id of changed) {
        const target = path.join(directory, 'modules', `${id}.json`);
        const original = await readFile(target, 'utf8');
        if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(modules[id]))
          throw new Error(`${id}: manifest changed during sync; retry from the latest files`);
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(updated[id], null, 2)}\n`, { flag: 'wx' });
        prepared.push({ target, temporary });
      }
      for (const { target, temporary } of prepared) await rename(temporary, target);
    } finally {
      await Promise.all(prepared.map(({ temporary }) => rm(temporary, { force: true })));
    }
  }
  const message = `${dryRun ? 'Previewed' : 'Synced'} npm latest: ${changed.length} changed, ${Object.keys(updated).length} checked`;
  console.log(message);
  if (summaryPath) {
    const cell = value => value.replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|');
    const rows = changes.map(change => `| ${cell(change.id)} | ${cell(change.fields.join('; '))} |`);
    await appendFile(summaryPath, `### Module metadata${dryRun ? ' (dry run)' : ''}\n\n${message}\n\n${rows.length ? '| Module | Changes |\n| --- | --- |\n' + rows.join('\n') + '\n' : ''}`);
  }
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
