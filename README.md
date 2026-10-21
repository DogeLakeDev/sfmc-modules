# SFMC 模块索引

收录 SFMC 官方与第三方模块的 npm 包、已发布版本和 SDK 兼容信息。模块源码在各自仓库维护，本仓库不构建或发布模块。

```text
modules/    每个模块一份 <id>.json，新增与人工维护的入口
index.json  自动生成的 v2 聚合索引，供 SFMC CLI 读取
schemas/    模块与索引的 JSON Schema
tools/      同步、校验、构建及 Issue 收录工具
test/       索引与同步测试
.github/    收录表单、PR 校验和自动同步 workflow
```

## 使用与维护

```bash
sfmc mod search
sfmc mod install afk

# 维护本仓库：Node.js >= 22.13.0，pnpm 10.8.0
pnpm install --frozen-lockfile
pnpm test                    # 离线校验及测试
pnpm run sync:npm --dry-run   # 预览公共 npm 元数据变化
pnpm run sync:npm             # 更新模块分片
pnpm run build                # 重建 index.json
pnpm run verify --network     # 核对分片中的精确 npm 版本
```

`modules/<id>.json` 是唯一输入；不要直接维护 `index.json`。聚合索引保持现有 v2 格式与 ID 排序，无变化时保留 `generatedAt`，重复运行不产生无意义提交。已并入平台的模块应删除分片，不在构建工具内维护排除名单。

## 自动同步

[Sync module metadata](.github/workflows/sync-modules.yml) 每小时第 17 分钟运行；main 上相关文件变更、手动运行或 `repository_dispatch: module-published` 也会触发。手动运行可选择 `dry_run`，只输出预览。

同步以公共 npm 的 `latest` 为准，读取每个已收录包的：

| 自动同步字段 | 来源 |
| --- | --- |
| `version` | 已发布包的 `version` |
| `sdk` | `peerDependencies["@sfmc-bds/sdk"]` |
| `license` | `license` |
| `repo` | `repository`，转换为 HTTPS 源码地址；发布包省略时保留原值 |

`npm` 与 `id` 是关联键；名称、说明、分类、依赖、标签、作者和 `official` 由维护者审核。同步不会把源码分支中尚未发布的版本写入索引，也不会执行模块代码。

请求仅发送到 `registry.npmjs.org`，每次超时 15 秒、最多并发 4 个。任一请求失败、包名不符、版本/SDK/许可证无效、latest 为预发布或已弃用版本，整次同步都失败，保留原分片。禁止降低已发布版本；只有旧版本明确返回 404 时才纠正提前登记的版本。

所有响应验证成功后再写分片，随后校验、构建并提交 `modules/` 和 `index.json`；没有变化时不提交。并发推送冲突会基于最新默认分支重新同步，最多三次，不强制推送。Actions 摘要列出字段变化。

普通自动同步仅使用本仓库的 `GITHUB_TOKEN`，无需额外 secret。仓库需允许 Actions 写入 Contents，并允许机器人向默认分支推送；分支保护若禁止此操作，需由维护者配置规则。workflow 合并到默认分支后，定时与外部事件触发才会生效。

## 收录模块

先将模块发布到公共 npm，再创建 `modules/<id>.json` 并提交 PR：

```json
{
  "id": "example",
  "name": "示例模块",
  "description": "模块提供的功能",
  "version": "1.0.0",
  "npm": "@your-scope/module-example",
  "sdk": ">=0.2.0",
  "license": "MIT",
  "official": false,
  "repo": "https://github.com/your-account/module-example",
  "category": "utility",
  "requires": []
}
```

文件名必须与 `id` 一致，版本必须是严格 SemVer。`requires` 仅填写已收录的模块 ID，不允许自依赖、未知依赖或循环依赖。可选 `category` 为 `gameplay`、`utility`、`system`、`economy`、`social`；可选 `tags` 与 `authors` 是不重复的非空字符串数组。第三方模块使用 `official: false`，官方身份须人工确认。完整规则见 [模块 Schema](schemas/registry-module.schema.json) 与 [索引 Schema](schemas/registry-index.schema.json)。

也可在模块仓运行 `sfmc mod submit --dry-run` / `sfmc mod submit`，或使用仓库的“申请收录或更新模块”Issue 表单。表单机器人保留独立的 [Submit module request](.github/workflows/submit-issue.yml) 流程；维护者需配置本仓 Contents / Pull requests / Issues 写权限的 `REGISTRY_SUBMIT_TOKEN`，用于创建可触发 PR 校验的收录 PR。工具接入见 [发布指南](https://github.com/DogeLakeDev/ScriptsForMinecraftServer/blob/main/docs/zh/dev/publish.md)。

模块 PR 通常只提交分片；合并后由同步 workflow 更新聚合索引。工具变更应通过 `pnpm test` 和 `pnpm run build`。本仓库沿用 [AGPL-3.0-only](LICENSE)，模块许可证以各自发布包为准。
