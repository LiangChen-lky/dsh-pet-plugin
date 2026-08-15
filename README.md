# dsh-pet-plugin

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 web GUI 里复刻 Codex 桌面宠物的插件组合包：**host 侧扫描宠物目录并提供资源，client 侧在 shell 浮层上渲染可交互宠物**。

## 特性

- 序列帧宠物动画（Codex 契约：`pet.json` + spritesheet），逐帧渲染
- 状态联动当前会话：空闲、处理中、活跃，含通知气泡
- 悬停跳跃、拖拽奔跑（视口钳制）、注视光标、抛掷物理
- 点击宠物打开选择器，选择与位置持久化
- 目录默认 `$DSH_HOME/pets`（未设置为 `~/.dsh/pets`），回退 `$CODEX_HOME/pets`（未设置为 `~/.codex/pets`）

> 宠物资源（序列帧图片）版权归原作者，**不进本仓库**——用户自行把宠物目录放在上面的默认路径。

## 仓库结构

```
dsh-pet-plugin/
├── package.json              # 组合包（bundle）：dsh.bundle.patch 声明 + 两个子包依赖
├── cordis.patch.yml          # 把 pet-assets / ui-pet 两行插进 web profile 组合
├── prepare.mjs               # 安装时的依赖校验钩子（allowBuilds 白名单入口）
├── tsconfig.base(+.client).json / tsdown.client.ts / platform.modules.ts
├── vitest.config.ts
└── packages/
    ├── host-pet-assets/      # host 插件：扫描/校验/HTTP 提供（@liangchen-lky/dsh-pet-assets）
    └── client-pet-ui/        # client 插件：浏览器半区动画与交互（@liangchen-lky/dsh-client-pet-ui）
```

## 包名

三个包使用 `@liangchen-lky/*` scope（与 npm 账号一致，可直接发布）：

- `@liangchen-lky/dsh-pet-plugin`（组合包）
- `@liangchen-lky/dsh-pet-assets`（host 插件）
- `@liangchen-lky/dsh-client-pet-ui`（client 插件）

npm 只在发布时校验 scope 归属；**安装不受限制，任何人都能装**。

## 本地开发

```sh
pnpm install        # 需要 pnpm ≥ 9；依赖从 npm 官方源安装（含 @deepseek-ai/* 运行时包）
pnpm test           # vitest：host 49 测试 + client 测试（jsdom）
pnpm build          # tsc 出 lib/types，tsdown 出 lib 产物（含 client bundle）
```

## 发布

先发布两个子包，再发布组合包（bundle 的依赖走 npm 版本）：

```sh
pnpm --filter @liangchen-lky/dsh-pet-assets publish
pnpm --filter @liangchen-lky/dsh-client-pet-ui publish
pnpm publish        # 根组合包
```

## 安装到 dsh

```sh
# npm 发布后（推荐，无需白名单）
dsh plugin --profile web add @liangchen-lky/dsh-pet-plugin

# git 直装（pnpm ≥ 10 需在 dsh home 的 pnpm-workspace.yaml 里 allowBuilds 白名单放行本包，否则 prepare 不执行）
dsh plugin --profile web add github:LiangChen-lky/dsh-pet-plugin#<commit>
```

安装后启动 dsh web，点击右下角宠物即可交互；宠物选择器里出现的宠物来自上述默认目录扫描结果。

## 目录配置

host 插件支持显式 `petsDir`（`cordis.patch.yml` 里给 pet-assets 行加 `config`）：目录缺失或不是目录会**响亮失败**；不配置时走默认链（`$DSH_HOME/pets` → `$CODEX_HOME/pets`），全缺按空目录提供（选择器为空）。

## 许可

MIT。宠物资源版权归原作者，本仓库不附带任何宠物素材。
