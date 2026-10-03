import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkIndex, checkNetwork, root } from '../tools/verify.mjs';

const sample = {
  id: 'sample', name: '示例', description: '测试模块', version: '1.0.0',
  npm: '@example/module-sample', sdk: '>=0.2.0', license: 'ISC', official: false,
};

async function fixture(t) {
  // 放在仓库下以复用工具依赖；只复制测试输入，不更改真实分片。
  const directory = await mkdtemp(path.join(root, '.registry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(root, 'tools'), path.join(directory, 'tools'), { recursive: true });
  await cp(path.join(root, 'schemas'), path.join(directory, 'schemas'), { recursive: true });
  await mkdir(path.join(directory, 'modules'));
  return {
    directory,
    put: (name, value) => writeFile(path.join(directory, 'modules', name), JSON.stringify(value)),
    run: (tool, ...args) => spawnSync(process.execPath, [path.join(directory, 'tools', tool), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 10000,
    }),
  };
}

test('从任意工作目录构建、按 ID 排序，重复构建字节稳定', async (t) => {
  const f = await fixture(t);
  await f.put('zebra.json', { ...sample, id: 'zebra' });
  await f.put('alpha.json', { ...sample, id: 'alpha' });
  const built = f.run('build-index.mjs');
  assert.equal(built.status, 0, built.stderr);
  const before = await readFile(path.join(f.directory, 'index.json'), 'utf8');
  const index = JSON.parse(before);
  assert.deepEqual(Object.keys(index.modules), ['alpha', 'zebra']);
  assert.equal(index.version, 2);
  assert.equal(new Date(index.generatedAt).toISOString(), index.generatedAt);
  const again = f.run('build-index.mjs');
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(path.join(f.directory, 'index.json'), 'utf8'), before);
  await f.put('alpha.json', { ...sample, id: 'alpha', version: '1.1.0' });
  const verify = f.run('verify.mjs');
  assert.equal(verify.status, 0, verify.stderr); // 已发布的聚合索引可以落后。
  const updated = f.run('build-index.mjs');
  assert.equal(updated.status, 0, updated.stderr);
  const after = JSON.parse(await readFile(path.join(f.directory, 'index.json'), 'utf8'));
  assert.equal(after.modules.alpha.version, '1.1.0');
  assert.notEqual(after.generatedAt, index.generatedAt);
});

test('非法输入使构建失败且保留旧索引，无临时文件残留', async (t) => {
  const f = await fixture(t);
  await f.put('sample.json', sample);
  assert.equal(f.run('build-index.mjs').status, 0);
  const before = await readFile(path.join(f.directory, 'index.json'), 'utf8');
  await writeFile(path.join(f.directory, 'modules/sample.json'), '{invalid');
  const result = f.run('build-index.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modules\/sample.json/);
  assert.equal(await readFile(path.join(f.directory, 'index.json'), 'utf8'), before);
  assert.deepEqual((await readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
});

for (const [label, patch] of [
  ['未知字段', { unexpected: true }],
  ['非法 ID', { id: 'Bad_ID' }],
  ['非严格版本', { version: 'v1.0.0' }],
  ['带前导零的预发布版本', { version: '1.0.0-01' }],
  ['错误 SDK 范围', { sdk: 'not-a-range' }],
  ['错误 npm 包名', { npm: 'https://example.com/package' }],
  ['缺少必填字段', { name: undefined }],
  ['非字符串描述', { description: 123 }],
  ['错误分类', { category: 'other' }],
  ['错误官方标记类型', { official: 'true' }],
  ['重复标签', { tags: ['test', 'test'] }],
  ['不存在的依赖', { requires: ['missing'] }],
  ['自依赖', { requires: ['sample'] }],
]) {
  test(`拒绝${label}`, async (t) => {
    const f = await fixture(t);
    await f.put('sample.json', { ...sample, ...patch });
    const result = f.run('verify.mjs');
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /sample/);
  });
}

test('报告文件名不匹配和重复 ID', async (t) => {
  const f = await fixture(t);
  await f.put('sample.json', sample);
  await f.put('duplicate.json', sample);
  const result = f.run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /filename must be sample.json/);
  assert.match(result.stderr, /duplicate id sample/);
});

test('拒绝依赖环', async (t) => {
  const f = await fixture(t);
  await f.put('sample.json', { ...sample, requires: ['other'] });
  await f.put('other.json', { ...sample, id: 'other', requires: ['sample'] });
  const result = f.run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency cycle/);
});

test('拒绝空目录、子目录、非 JSON 文件和未知命令参数', async (t) => {
  const f = await fixture(t);
  assert.match(f.run('verify.mjs').stderr, /must not be empty/);
  await mkdir(path.join(f.directory, 'modules/nested'));
  await f.put('notes.txt', sample);
  const result = f.run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modules\/nested/);
  assert.match(result.stderr, /modules\/notes.txt/);
  assert.match(f.run('verify.mjs', '--netwrok').stderr, /Usage:/);
});

test('索引 Schema 拒绝非法日期、版本、额外字段和键值不一致', () => {
  const valid = { version: 2, generatedAt: '2026-09-05T00:00:00.000Z', modules: { sample } };
  assert.doesNotThrow(() => checkIndex(valid));
  for (const patch of [
    { version: 1 }, { generatedAt: 'yesterday' }, { extra: true },
    { modules: {} }, { modules: { wrong: sample } },
  ]) assert.throws(() => checkIndex({ ...valid, ...patch }));
});

test('联网检查请求固定源的精确版本，并限制并发', async (t) => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/%40example%2Fmodule-sample/1.0.0');
    assert.ok(options.signal instanceof AbortSignal);
    peak = Math.max(peak, ++active);
    requests++;
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return Response.json({ name: sample.npm, version: sample.version });
  });
  await checkNetwork(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, sample])));
  assert.equal(requests, 9);
  assert.equal(peak, 4);
});

test('联网错误、404、非法响应及包名或版本不符均拒绝', async (t) => {
  for (const [label, response] of [
    ['404', () => new Response('', { status: 404 })],
    ['超时', () => { throw new DOMException('Timed out', 'TimeoutError'); }],
    ['非 JSON', () => new Response('not json')],
    ['包名', () => Response.json({ name: 'wrong', version: sample.version })],
    ['版本', () => Response.json({ name: sample.npm, version: '2.0.0' })],
  ]) {
    await t.test(label, async (st) => {
      st.mock.method(globalThis, 'fetch', response);
      await assert.rejects(checkNetwork({ sample }), /sample:/);
    });
  }
});

test('允许空描述，仍要求 description 字段为字符串', async (t) => {
  const f = await fixture(t);
  await f.put('sample.json', { ...sample, description: '' });
  const result = f.run('verify.mjs');
  assert.equal(result.status, 0, result.stderr);
  await f.put('sample.json', { ...sample, description: undefined });
  assert.equal(f.run('verify.mjs').status, 1);
});
