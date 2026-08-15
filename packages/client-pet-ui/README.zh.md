# @liangchen-lky/dsh-client-pet-ui

[English](README.md) | 中文

桌面宠物特性属主：一个 `shell.overlay` 条目，渲染一只悬浮于壳层之上、联动当前会话活跃度的 Codex 契约动画宠物。精灵图资源经 [`dsh-pet-assets`](../host-pet-assets/README.md) 的 HTTP 路由到达；叠加层自身不发 RPC，只经对象层读会话（列表选择 + 登台会话的快照，以 inject hooks 隔间的 `petActivity` 投影出来）。

## 行为

- **活跃度状态** —— 等待输入（审批 / 计划评审 / 提问）优先于留存错误，错误优先于运行中的回合；空闲回合是环境眨眼循环。回合从 running 落定到 idle 时闪一遍 review 轨道；宠物首次出现时挥手一遍。轨道遵循 Codex 播放契约：逐帧时长、主序列连播三遍沉入减速 idle 循环、一次性轨道播完交接 fallback。
- **交互** —— 悬停跳跃；水平拖拽时左右奔跑；带速度松手会把宠物抛出去，带摩擦衰减与视口边缘反弹；停稳后的位置会持久化。无位移的点击开合宠物选择器；右键菜单同样。v2 精灵图上，宠物在 idle / running / waving 时会注视指针（16 向帧环）。
- **气泡** —— 等待与出错状态在宠物上方弹出可关闭的通知条（按事实记忆关闭状态；新事实会重新弹出）；review 闪显时短暂展示完成条。
- **减弱动效** —— `prefers-reduced-motion` 下只渲染首帧，不做任何排帧。

样式只用 token；文案走本包自己的 `pet` locale 命名空间。host 行未挂载、拉取失败或目录为空时，该条目整体不渲染。

## Model Experience

无：本包把会话状态渲染给人看，不接触任何 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；本包从不组装或发送模型请求。

## Known Limitations and Deferred Work

- **目录每次挂载只拉一次** —— host 侧的宠物变更在下一次重载后生效；叠加层不轮询。
- **注视环需要 v2 精灵图** —— 本机 Codex 宠物全是 v1，注视行为由契约测试覆盖而非出厂样例。
