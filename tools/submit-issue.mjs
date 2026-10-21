/** 仅解析表单字段和公共 npm 数据，不运行 issue 中的代码或作者仓脚本。 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export function parseSubmissionForm(body) {
  if (typeof body !== "string" || body.length > 20000)
    throw new Error("表单为空或过长");
  const allowed = new Set([
    "npm 包名",
    "精确版本",
    "模块 ID",
    "展示名称",
    "功能介绍",
    "分类",
    "依赖模块 ID",
    "标签",
    "公开作者署名",
  ]);
  const fields = new Map();
  const matches = [...body.matchAll(/^### (.+)\r?\n/gm)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1].trim();
    if (!allowed.has(key) || fields.has(key))
      throw new Error(`未知或重复表单字段：${key}`);
    const value = body
      .slice(
        match.index + match[0].length,
        matches[i + 1]?.index ?? body.length,
      )
      .trim();
    fields.set(key, value === "_No response_" ? "" : value);
  }
  const required = (key) => {
    const value = fields.get(key);
    if (!value) throw new Error(`缺少 ${key}`);
    return value;
  };
  const list = (key) =>
    (fields.get(key) || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const npm = required("npm 包名");
  const version = required("精确版本");
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(npm) ||
    npm.length > 214
  )
    throw new Error("非法 npm 包名");
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  )
    throw new Error("须填写精确版本");
  const authors = list("公开作者署名");
  return {
    npm,
    version,
    manifest: {
      schemaVersion: 2,
      id: required("模块 ID"),
      requires: list("依赖模块 ID"),
    },
    metadata: {
      name: required("展示名称"),
      description: required("功能介绍"),
      category: required("分类"),
      tags: list("标签"),
      ...(authors.length ? { authors } : {}),
    },
  };
}

async function main() {
  const event = JSON.parse(
    await fs.readFile(
      process.env.SUBMISSION_EVENT_PATH || process.env.GITHUB_EVENT_PATH,
      "utf8",
    ),
  );
  if (
    !event.issue ||
    event.issue.pull_request ||
    !event.issue.title.startsWith("[模块收录]")
  )
    return;
  const requireTool = createRequire(
    path.resolve(process.env.SFMC_TOOL_ROOT, "package.json"),
  );
  const { createRegistryEntry, submitModuleToRegistry } = await import(
    requireTool.resolve("@sfmc-bds/devkit")
  );
  const form = parseSubmissionForm(event.issue.body);
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(form.npm)}/${encodeURIComponent(form.version)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(`公共 npm 精确版本不可用（HTTP ${response.status}）`);
  const pkg = await response.json();
  if (pkg.name !== form.npm || pkg.version !== form.version)
    throw new Error("公共 npm 名称或版本不匹配");
  const entry = createRegistryEntry(pkg, form.manifest, form.metadata);
  if (!entry.repo)
    throw new Error("请在已发布包的 repository 中提供 HTTPS 源码地址");
  const result = await submitModuleToRegistry({
    entry,
    registryRepo: process.env.GITHUB_REPOSITORY,
    noFork: true,
  });
  console.log(result.prUrl ?? "索引内容相同，无需提交");
  if (!process.env.GH_TOKEN) throw new Error("缺少表单机器人 GH_TOKEN");
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const endpoint = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues/${event.issue.number}/comments`;
  const marker = "<!-- sfmc-module-request -->";
  const body = `${marker}\n${result.prUrl ? `已生成索引审核 PR：${result.prUrl}` : "公共 npm 和索引校验通过；内容相同，无需重复提交。"}\n\n合并后由 Actions 更新聚合索引。`;
  const comments = await fetch(`${endpoint}?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!comments.ok)
    throw new Error(
      `索引 PR 已处理，但无法读取申请回复（HTTP ${comments.status}；需要 Issues 写权限）`,
    );
  const existing = (await comments.json()).some((item) => item.body === body);
  if (!existing) {
    const responseComment = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(15000),
    });
    if (!responseComment.ok)
      throw new Error(
        `索引 PR 已处理，但无法回复申请（HTTP ${responseComment.status}；需要 Issues 写权限）`,
      );
  }
  await fs.appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `模块申请 #${event.issue.number}：${result.prUrl ?? "索引内容相同，无需提交"}\n`,
  );
}

if (process.env.GITHUB_EVENT_PATH && process.env.SFMC_TOOL_ROOT) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
