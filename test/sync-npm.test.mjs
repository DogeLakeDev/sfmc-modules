import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryUrl, resolveNpmModules, syncNpm } from '../tools/sync-npm.mjs';
import { root } from '../tools/verify.mjs';

const sample = {
  id: 'sample', name: '人工名称', description: '人工介绍', version: '1.0.0',
  npm: '@example/module-sample', sdk: '>=0.2.0', license: 'ISC', official: false,
  repo: 'https://github.com/example/old', category: 'utility', requires: [],
  tags: ['example'], authors: ['Maintainer'],
};
const published = {
  name: sample.npm, version: '1.1.0', license: 'MIT',
  peerDependencies: { '@sfmc-bds/sdk': '^0.3.0' },
  repository: { type: 'git', url: 'git+https://github.com/example/new.git' },
  description: 'Package description', official: true, requires: ['unreviewed'],
};
const response = (patch = {}) => Response.json({ ...published, ...patch });

async function fixture(t, modules = { sample }) {
  const directory = await mkdtemp(path.join(root, '.registry-test-sync-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'modules'));
  for (const [id, entry] of Object.entries(modules))
    await writeFile(path.join(directory, 'modules', `${id}.json`), JSON.stringify(entry));
  return {
    directory,
    file: id => path.join(directory, 'modules', `${id}.json`),
    run: options => syncNpm({ directory, summaryPath: null, fetchImpl: async () => response(), ...options }),
  };
}

test('只同步发布元数据，保留所有人工字段及输入对象', async () => {
  const modules = { sample: structuredClone(sample) };
  const updated = await resolveNpmModules(modules, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/%40example%2Fmodule-sample/latest');
    assert.ok(options.signal instanceof AbortSignal);
    return response();
  } });
  assert.deepEqual(updated.sample, {
    ...sample, version: '1.1.0', sdk: '^0.3.0', license: 'MIT', repo: 'https://github.com/example/new',
  });
  assert.deepEqual(modules, { sample });
});

test('源码地址支持 npm 常见格式，缺少时保留人工地址', async () => {
  for (const value of [
    'git+https://github.com/example/repo.git', 'git://github.com/example/repo.git',
    'git@github.com:example/repo.git', 'ssh://git@github.com/example/repo.git',
    { url: 'https://github.com/example/repo.git#main' },
  ]) assert.equal(repositoryUrl(value), 'https://github.com/example/repo');
  for (const value of ['http://example.com/repo', 'https://user:pass@example.com/repo', 'file:///tmp/repo'])
    assert.throws(() => repositoryUrl(value));
  const updated = await resolveNpmModules({ sample }, { fetchImpl: async () => response({ repository: undefined }) });
  assert.equal(updated.sample.repo, sample.repo);
});

test('拒绝无效发布数据和网络失败', async t => {
  for (const [label, fetchImpl, pattern] of [
    ['404', async () => new Response('', { status: 404 }), /HTTP 404/],
    ['超时', async () => { throw new DOMException('Timed out', 'TimeoutError'); }, /Timed out/],
    ['非法 JSON', async () => new Response('invalid'), /sample:/],
    ['包名', async () => response({ name: 'wrong' }), /name mismatch/],
    ['无版本', async () => response({ version: undefined }), /exact SemVer/],
    ['非严格版本', async () => response({ version: 'v1.1.0' }), /exact SemVer/],
    ['预发布', async () => response({ version: '1.1.0-beta.1' }), /prerelease/],
    ['已弃用', async () => response({ deprecated: 'retired' }), /deprecated/],
    ['SDK 缺失', async () => response({ peerDependencies: {} }), /SDK|sdk/],
    ['SDK 非法', async () => response({ peerDependencies: { '@sfmc-bds/sdk': 'invalid' } }), /SDK|sdk/],
    ['许可证缺失', async () => response({ license: undefined }), /license/],
    ['源码地址非法', async () => response({ repository: 'file:///tmp/repo' }), /HTTPS/],
  ]) await t.test(label, async () => {
    await assert.rejects(resolveNpmModules({ sample }, { fetchImpl }), pattern);
  });
});

test('只在旧版本明确 404 时修正，拒绝已发布版本降版和权限错误', async t => {
  for (const status of [200, 403, 500, 404]) await t.test(String(status), async () => {
    const requests = [];
    const resolve = () => resolveNpmModules({ sample: { ...sample, version: '2.0.0' } }, {
      fetchImpl: async url => {
        requests.push(url);
        return url.endsWith('/latest') ? response() : new Response('', { status });
      },
    });
    if (status === 404) assert.equal((await resolve()).sample.version, '1.1.0');
    else await assert.rejects(resolve(), status === 200 ? /refusing downgrade/ : /current version check/);
    assert.equal(requests[1], 'https://registry.npmjs.org/%40example%2Fmodule-sample/2.0.0');
  });
});

test('请求最多并发四个，失败时报告所有模块错误', async () => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  const modules = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`sample${i}`, { ...sample, id: `sample${i}` }]));
  await assert.rejects(resolveNpmModules(modules, { fetchImpl: async () => {
    requests++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response('', { status: 503 });
  } }), error => error.message.split('\n').length === 9);
  assert.equal(requests, 9);
  assert.equal(peak, 4);
});

test('dry-run 不改文件，实际同步可重复执行，并输出字段摘要', async t => {
  const f = await fixture(t);
  const before = await readFile(f.file('sample'), 'utf8');
  const summaryPath = path.join(f.directory, 'summary.md');
  assert.deepEqual(await f.run({ dryRun: true, summaryPath }), ['sample']);
  assert.equal(await readFile(f.file('sample'), 'utf8'), before);
  assert.match(await readFile(summaryPath, 'utf8'), /dry run/);
  assert.match(await readFile(summaryPath, 'utf8'), /license: ISC -> MIT/);
  assert.deepEqual(await f.run(), ['sample']);
  const after = await readFile(f.file('sample'), 'utf8');
  assert.equal(JSON.parse(after).repo, 'https://github.com/example/new');
  assert.deepEqual(await f.run(), []);
  assert.equal(await readFile(f.file('sample'), 'utf8'), after);
  assert.deepEqual((await readdir(path.join(f.directory, 'modules'))).filter(name => name.endsWith('.tmp')), []);
});

test('任一模块失败时，所有分片字节保持不变', async t => {
  const f = await fixture(t, { sample, other: { ...sample, id: 'other', npm: '@example/module-other' } });
  const before = await readFile(f.file('sample'), 'utf8');
  const otherBefore = await readFile(f.file('other'), 'utf8');
  await assert.rejects(f.run({ fetchImpl: async url => url.includes('module-other')
    ? new Response('', { status: 500 }) : response() }), /other: HTTP 500/);
  assert.equal(await readFile(f.file('sample'), 'utf8'), before);
  assert.equal(await readFile(f.file('other'), 'utf8'), otherBefore);
});

test('同步期间文件被编辑时保留现场，清理已准备的临时文件', async t => {
  const f = await fixture(t, { sample, zebra: { ...sample, id: 'zebra' } });
  const before = await readFile(f.file('sample'), 'utf8');
  const edited = { ...sample, id: 'zebra', description: 'New local edit' };
  await assert.rejects(f.run({ fetchImpl: async () => {
    await writeFile(f.file('zebra'), JSON.stringify(edited));
    return response();
  } }), /manifest changed during sync/);
  assert.equal(await readFile(f.file('sample'), 'utf8'), before);
  assert.deepEqual(JSON.parse(await readFile(f.file('zebra'), 'utf8')), edited);
  assert.deepEqual((await readdir(path.join(f.directory, 'modules'))).filter(name => name.endsWith('.tmp')), []);
});
