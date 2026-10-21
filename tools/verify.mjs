import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import semver from 'semver';

export const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addFormat('semver-range', (value) => value.trim().length > 0 && semver.validRange(value) !== null);
const moduleSchema = await readJson(path.join(root, 'schemas/registry-module.schema.json'));
const indexSchema = await readJson(path.join(root, 'schemas/registry-index.schema.json'));
ajv.addSchema(moduleSchema);
const validateModule = ajv.getSchema(moduleSchema.$id);
const validateIndex = ajv.compile(indexSchema);

export function checkIndex(index) {
  if (!validateIndex(index)) throw new Error(`index.json: ${ajv.errorsText(validateIndex.errors)}`);
  for (const [id, entry] of Object.entries(index.modules)) {
    if (id !== entry.id) throw new Error(`index.json: key ${id} does not match id ${entry.id}`);
  }
}

export async function loadModules(directory = root) {
  const entries = await readdir(path.join(directory, 'modules'), { withFileTypes: true });
  const errors = [];
  const modules = new Map();
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const label = `modules/${entry.name}`;
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      errors.push(`${label}: expected a regular <id>.json file`);
      continue;
    }
    try {
      const module = await readJson(path.join(directory, label));
      if (!validateModule(module)) errors.push(`${label}: ${ajv.errorsText(validateModule.errors)}`);
      if (module && typeof module.id === 'string') {
        if (entry.name !== `${module.id}.json`) errors.push(`${label}: filename must be ${module.id}.json`);
        if (modules.has(module.id)) errors.push(`${label}: duplicate id ${module.id}`);
        else modules.set(module.id, module);
      }
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }
  if (!entries.length) errors.push('modules/: registry must not be empty');
  if (errors.length) throw new Error(errors.join('\n'));
  for (const [id, module] of modules) {
    for (const dependency of module.requires ?? []) {
      if (dependency === id || !modules.has(dependency)) errors.push(`${id}: invalid dependency ${dependency}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  // 循环依赖不能形成可靠的模块安装顺序。
  const visited = new Set();
  const visiting = new Set();
  function visit(id, chain) {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${[...chain, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of modules.get(id).requires ?? []) visit(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of modules.keys()) visit(id, []);
  return Object.fromEntries([...modules].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export async function checkNetwork(modules) {
  const errors = [];
  // 最多同时请求四个包；只访问固定公共源，超时与网络失败均使门禁失败。
  const queue = Object.values(modules);
  async function checkPackage(module) {
    try {
      const url = `https://registry.npmjs.org/${encodeURIComponent(module.npm)}/${encodeURIComponent(module.version)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const published = await response.json();
      if (published.name !== module.npm || published.version !== module.version) throw new Error('published name/version mismatch');
      console.log(`✓ ${module.npm}@${module.version}`);
    } catch (error) {
      errors.push(`${module.id}: ${module.npm}@${module.version}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await checkPackage(queue.shift());
  }));
  if (errors.length) throw new Error(errors.join('\n'));
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--network')) throw new Error('Usage: node tools/verify.mjs [--network]');
  const modules = await loadModules();
  // PR 只修改分片；验证待构建索引，允许已发布的 index.json 暂时落后。
  checkIndex({ version: 2, generatedAt: new Date().toISOString(), modules });
  if (process.argv.includes('--network')) await checkNetwork(modules);
  console.log(`✓ Verified ${Object.keys(modules).length} modules and candidate index schema`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
