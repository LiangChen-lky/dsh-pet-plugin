# @kkkey/dsh-pet-assets

[English](README.md) | 中文

Codex 格式宠物资源提供者：激活时扫描宠物目录，按 Codex 宠物契约（与 `codex-rs/tui/src/pets/model.rs` 相同的规则）校验每份清单，并通过两条 [`dsh-host-webserver`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/webserver/README.md) 命名路由提供解析后的目录与精灵图字节。浏览器侧的 [`dsh-client-pet-ui`](../client-pet-ui/README.md) 是唯一出厂消费者。宠物目录始终是仓库之外的用户数据——不做任何拷贝入库。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `petsDir` | `$DSH_HOME/pets`（变量未设置时为 `~/.dsh/pets`），缺失时回退 `$CODEX_HOME/pets`（变量未设置时为 `~/.codex/pets`） | 宠物根目录。开头的 `~` 展开为用户主目录。显式配置的目录不存在（或不是目录）会让组合失败；默认链全部缺失则只提供空目录。 |

`routePrefix` 刻意不开放配置：固定前缀 `/pet-assets` 是本包与浏览器插件之间的线协议常量，两侧必须一致。

## 线协议面

- `GET /pet-assets/catalog.json` —— 解析后的目录：每只宠物的 id、展示名、描述、路由相对精灵图 URL、精灵图契约代际（1 = 1536×1872 网格，2 = 多出两行注视环）、帧格几何、解析后的动画表，以及作为客户端缓存破坏键的精灵图修改时间。
- `GET /pet-assets/sprites/<id>/<file>` —— 精灵图字节流，带图像 content-type。只服务清单声明的那一个文件；相对路径相等性检查同时就是目录穿越防线。两条路由只回答 GET/HEAD，其余方法一律 405。

## 清单与动画语义

一只宠物就是一个目录：`pet.json`（或遗留的 `avatar.json`）加一张精灵图。清单可带可选的 `id`/`displayName`/`description`/`spritesheetPath`、可选的 `frame` 网格覆盖与可选的自定义 `animations`。校验对齐 Codex 契约：精灵图尺寸必须是两种契约尺寸之一；帧格必须精确铺满整图；帧数上限 256；自定义动画默认 8 fps、默认循环、默认回退 idle；精灵索引不得越界；fallback 必须指向真实轨道。清单未给动画表时解析为默认表（idle、running、running-left/right、waving、jumping、failed、waiting、review，以及 TUI 别名 move_*/wave/bounce/sad）；默认表中的状态轨道把主序列连播三遍后沉入减速 idle 循环。

## Model Experience

无：本包只为面向用户的 UI 提供 HTTP 资源，不接触任何 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；本包从不组装或发送模型请求。

## Known Limitations and Deferred Work

- **扫描是激活时快照** —— 新增、替换或修复宠物在下一次组合（重启或 HMR 重载）时生效，不会在请求间热更新。
- **一只坏宠物会让整个组合失败** —— 校验按设计响亮失败（坏清单即配置错误），目前目录里没有逐只宠物的错误面。
