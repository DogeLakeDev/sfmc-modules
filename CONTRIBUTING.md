# 贡献指南

本仓库接受 SFMC 官方与第三方模块的元数据收录。业务实现、构建与 npm 发布都在模块作者自己的仓库中完成。

## 1. 先发布模块

1. 准备符合 SFMC 模块契约的 npm 包，在独立仓中完成测试和打包。
2. 先将所收录的精确版本公开发布到 `registry.npmjs.org`。Scoped 包首次发布时通常使用 `pnpm publish --access public`。
3. 检查发布结果，例如 `pnpm view @your-scope/module-example@1.0.0 name version --registry=https://registry.npmjs.org`。
4. 核实许可证、SDK 兼容范围、模块 ID 和真实依赖，不要使用本地 `file:`、workspace 路径、未发布版本或 npm dist-tag 代替版本号。

初始化的 19 个官方模块在 2026-09-05 的公共源检查中均返回 404；其本地元数据已经收录，公共发布仍待完成。这是迁移状态说明，第三方新增收录仍须先完成公开发布。

## 2. 创建一个分片

选择未被占用的 kebab-case ID，例如 `example-module`。在 `modules/example-module.json` 中创建一个 JSON 对象。下面是模板，提交前替换所有示例信息为已发布包的真实信息：

```json
{
  "id": "example-module",
  "name": "示例模块",
  "description": "简明说明该模块对服主提供的能力",
  "version": "1.0.0",
  "npm": "@your-scope/module-example",
  "sdk": ">=0.2.0",
  "license": "MIT",
  "official": false,
  "repo": "https://github.com/your-account/example-module",
  "category": "utility",
  "tags": ["example"],
  "requires": [],
  "authors": ["你的公开署名"]
}
```

第三方模块必须填写 `official: false`；只有平台维护者确认的官方模块才能标记为 `true`。这一身份需要人工审查，Schema 的 boolean 校验不代表官方认证。

## 3. Schema 与规则

权威规范为 [单模块 Schema](schemas/registry-module.schema.json) 和 [聚合 Schema](schemas/registry-index.schema.json)。两个对象均禁止未知字段（`additionalProperties: false`）；不要在模块 JSON 中添加 `$schema`，编辑器通过 `.vscode/settings.json` 自动关联规范。

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `id` | 是 | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，文件名严格等于 `<id>.json` |
| `name` | 是 | 非空、不能只有空白的展示名称 |
| `description` | 是 | 非空的真实功能说明 |
| `version` | 是 | 严格 SemVer，支持 prerelease/build metadata，例如 `1.0.0-beta.1`；不接受 `v1.0.0`、`latest` 或范围 |
| `npm` | 是 | 合法包名，支持 `@scope/name`；最大 214 字符，无 URL、版本后缀或本地路径 |
| `sdk` | 是 | 非空的 npm semver 范围，例如 `>=0.2.0`、`^0.2.0`；工具向 Ajv 注册 `semver-range` 格式 |
| `license` | 是 | 非空字符串，填写与模块一致的 SPDX 标识或表达式；真实性由维护者核对 |
| `official` | 是 | boolean；第三方填写 `false` |
| `repo` | 否 | 模块的真实源码仓地址，无法核实时省略 |
| `category` | 否 | `gameplay`、`utility`、`system`、`economy`、`social` 之一 |
| `tags` | 否 | 不重复的非空字符串数组 |
| `requires` | 否 | 不重复的模块 ID 数组；须已收录或随同一个 PR 收录，不能依赖自身或形成环 |
| `authors` | 否 | 非空、不重复的字符串数组，填写公开署名 |

`requires` 表示模块间依赖，不是 npm 依赖或 SDK 内部功能名。无依赖时使用 `[]` 或省略。`modules/` 只存放平铺的 `<id>.json` 常规文件，不放子目录、链接、说明文件或构建产物。重复 ID、错误文件名、空注册表、未知依赖和循环依赖均会使门禁失败。

## 4. 本地验证与提交 PR

使用 Node.js >= 22.13.0，在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run verify --network
pnpm test
```

CI 使用锁文件驱动的 `pnpm install --frozen-lockfile` 保证依赖一致性。`pnpm test` 按标准脚本调用 `pnpm run verify`。

默认校验离线执行，检查每个分片、文件名、ID 唯一性、依赖及待生成索引的 Schema。`--network` 检查全部清单对应的精确 npm 版本，验证响应的包名与版本；404、超时、服务端错误、非法响应或包名/版本不符均返回非零退出码。请求固定发送到公共 npm 源，最多并发 4 个，每个超时 15 秒。

向 `main` 提交 PR：通常只添加或更新你自己的 `modules/<id>.json`。PR 说明提供模块源码地址、npm 包和版本、许可证、SDK 兼容性及校验结果。更新已有模块同样须先发布新版本，再更新清单。

**不要把生成的 `index.json` 加入常规模块 PR。** 如需本地预览，可运行 `pnpm run build`，但只暂存自己的分片。验证不会要求现有聚合索引与分片相等，因此多个作者无需争抢同一聚合文件。PR 门禁还运行 `node --test` 和一次实际构建。

## 5. 合并后发布与维护

合并后，Actions 从最新 main 自动生成 `{ "version": 2, "generatedAt": "<ISO-8601>", "modules": { "<id>": { ... } } }`。条目按 ID 排序，完整保留经验证的元数据；现行 CLI 读取其中的 `npm`、`version`、`sdk`，忽略展示字段。

构建通过临时文件原子替换索引。分片无变化时保留时间戳；有变化才生成新的时间戳。发布任务串行执行，仅暂存 `index.json`，遇到并发推送会从最新 main 重新构建，最多尝试三次。禁止强制推送。修改 Schema、构建工具或工具依赖也会触发发布。

维护者应将 **Verify registry PR / verify** 配置为必需检查；允许发布机器人写入 main，并检查分支保护规则。工作流的 `contents: write` 不能覆盖禁止直接推送的规则。首次发布后检查 Actions 日志与根目录索引，必要时在 main 手动运行 **Publish registry index**。当前工作流不会发布 npm 包。

工具变更需额外运行 `node --test`，覆盖非法输入、失败不覆盖原索引、重复构建稳定性与网络错误等场景。Schema 若改变了 CLI 读取字段，必须同时验证现行 CLI 解析器兼容性。
