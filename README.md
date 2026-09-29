# SFMC 模块中心索引库

[English](README.en.md) · [贡献指南](CONTRIBUTING.md)

本仓库是 ScriptsForMinecraftServer（SFMC）的纯元数据索引中心（Pure Registry Index Hub）。模块业务代码在各自独立仓维护，安装包通过 npm 分发；本仓库只维护发现、版本与兼容性元数据，以及索引构建工具。

采用 Homebrew-core 式的独立条目贡献与 Cargo Index 式的集中发现思路：`modules/<id>.json` 是唯一编辑来源，根目录 `index.json` 是供现行 CLI 获取的聚合产物。不同模块的 PR 可独立修改分片，合并后由 Actions 更新聚合文件。

## 搜索与安装

在已安装 SFMC CLI 的环境中执行：

```bash
sfmc mod search
sfmc mod install afk
sfmc mod install <id>
```

CLI 从 [main/index.json](https://raw.githubusercontent.com/Tanya7z/sfmc-modules/main/index.json) 发现模块，读取 `npm`、`version`、`sdk` 并优先使用 npm 安装。依赖和启用行为由现行 CLI 与模块运行时契约负责，索引本身不执行模块代码。

**正式发布前状态（2026-09-27）：** 以下清单仍是候选索引，公共 registry 的精确版本联网校验目前全部返回 404，不能据此宣称模块可安装。其中 `activity-log`、`data-backup` 的清单版本曾与模块仓 `package.json` 不一致。维护者须先发布各模块，再逐项对齐已发布的精确版本、运行 `pnpm run verify --network` 并更新此说明。未能核实的仓库 URL 与作者字段暂不填写。

`qq-link` 已收编进平台仓库 `ScriptsForMinecraftServer/modules/packages/qq-link`，并从本索引归档，不再单独安装。

## 官方模块（18）

所有官方包名均为 `@sfmc-bds/module-<id>`。

| ID / 清单 | 名称 | 分类 | 功能概览 | requires |
| --- | --- | --- | --- | --- |
| [activity-log](modules/activity-log.json) | 行为日志 | system | 全服原生事件监听与审计日志摄入/多维检索插槽 | — |
| [afk](modules/afk.json) | 挂机检测 | utility | 纯内存位移挂机判定与原版 Tag 豁免 | — |
| [area](modules/area.json) | 空间微内核 | system | 空间微内核与 AABB 区域特性调度引擎 | — |
| [chat-sounds](modules/chat-sounds.json) | 聊天关键字音效 | social | 聊天关键词全服原声音效与冷却防刷 | chat |
| [chat](modules/chat.json) | 聊天管道 | social | 独占原生聊天流管道，提供拦截器与广播/私聊服务 | economy |
| [clean](modules/clean.json) | 掉落物清理 | utility | 区域与全服掉落物预警、倒计时广播与物理回收箱清理 | area |
| [coop](modules/coop.json) | 合作社 | social | 合作社组织治理与公账划转托管 | economy, activity-log |
| [data-backup](modules/data-backup.json) | 数据灾备 | system | 世界种子/规则与全服计分板快照灾备（排除 sfmc_money） | — |
| [economy](modules/economy.json) | 经济系统 | economy | 计分板权威余额 + DB 流水留档 + 两阶段转账中枢 | — |
| [fly-area](modules/fly-area.json) | 区域飞行 | gameplay | 空间进出自动飞行能力赋权与剥离缓降 | area |
| [gamemode-area](modules/gamemode-area.json) | 区域游戏模式 | gameplay | 区域游戏模式切换与背包隔离置换 | area, inventory-switcher |
| [inventory-switcher](modules/inventory-switcher.json) | 背包切换 | system | 通用背包多槽位快照持久化与原子置换服务 | — |
| [land](modules/land.json) | 领地庄园 | gameplay | 现代地产租赁契约（只租不卖）+ 原版三维高亮线框 + 商业门票造血 | economy, activity-log |
| [monitor](modules/monitor.json) | 运行时监控 | system | TPS 逐刻采样环与全服综合负载宏观时序监控 | — |
| [online-time](modules/online-time.json) | 在线时长统计 | utility | 进服打点与心跳增量结转在线统计与多维排行榜 | — |
| [peace-area](modules/peace-area.json) | 和平区域 | gameplay | 区域怪物生成拦截与和平空间保护（友好生物豁免） | area |
| [qa](modules/qa.json) | 知识竞答 | gameplay | 知识竞答加权出题、聊天快捷作答与经济奖惩结算 | economy, chat |
| [spawn-protect](modules/spawn-protect.json) | 出生保护 | utility | 玩家进服与重生 60 ticks 高阶抗性保护 | — |

旧版 `tps` 与 `scoreboard-sync` 已整合或废弃，不纳入索引；`daily-task` 保持 deferred，暂不收录。`qq-link` 已收编为平台内置包并归档。

## 仓库结构与本地命令

```text
modules/<id>.json                    单模块元数据（PR 编辑入口）
schemas/registry-module.schema.json  严格的单模块契约
schemas/registry-index.schema.json   v2 聚合契约
tools/verify.mjs                    Schema、依赖与可选 npm 校验
tools/build-index.mjs               排序聚合与原子写入
index.json                         自动生成、随仓库发布的 CLI 入口
test/registry.test.mjs              隔离目录中的工具回归测试
.github/workflows/                  PR 门禁与主分支自动发布
```

需要 Node.js >= 22.13.0。只安装 Ajv、日期格式与 semver 校验工具，无 workspace 或本地 SDK 依赖。

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm test
pnpm run verify --network
pnpm run build
node --test
```

`verify` 验证分片和待生成的索引，允许 PR 中已发布的 `index.json` 暂时落后。`--network` 额外检查公共 npm 上包名与精确版本；每个请求超时 15 秒，最多并发 4 个，不下载或执行模块。

构建先校验再按 ID 排序，格式化后原子替换 `index.json`；失败不会破坏已发布索引。元数据无变化时保留 `generatedAt`，重复构建得到相同字节。聚合格式为：

```json
{
  "version": 2,
  "generatedAt": "2026-09-05T00:00:00.000Z",
  "modules": {
    "afk": {
      "id": "afk",
      "name": "挂机检测",
      "description": "纯内存位移挂机判定与原版 Tag 豁免",
      "version": "0.2.0",
      "npm": "@sfmc-bds/module-afk",
      "sdk": ">=0.2.0",
      "license": "ISC",
      "official": true,
      "category": "utility",
      "requires": []
    }
  }
}
```

## 自动化维护

面向 main 的 PR 运行离线规则校验、工具回归测试和构建；不要求贡献者手改聚合文件。main 上分片、Schema、工具、依赖或发布工作流变化后，串行发布任务从最新 main 构建，只提交变化的 `index.json`。推送遇到竞争会最多重新构建三次，无强制推送；索引提交不匹配路径触发条件，不会形成循环。也可在 main 手动运行 Publish registry index。

维护者需允许 Actions 写入仓库，并确保主分支规则允许该机器人提交；若分支规则禁止直接推送，发布任务会失败，须先调整机器人权限或改用符合规则的发布流程。实现参考 [GitHub Actions 并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。

本仓库保留现有 [AGPL-3.0-only 许可证](LICENSE)；各模块的许可证以清单及模块自身许可证为准。
