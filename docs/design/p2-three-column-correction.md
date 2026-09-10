# P2 三栏会话修正

## Requirements Summary
2026-09-10 用户截图与指示取代旧 D02 的“终端会话进入工作台”要求。左侧项目范围、中间会话列表、右侧会话 Tab；普通点击直接显示真实内容。复用现有会话和执行 owner，不创建第二个 PTY。

## Acceptance Criteria
- 最近会话与中间列表点击后 activeView 为 sessions，activeWorktreeId 不变。
- 右侧提供当前会话 Tab、消息/终端内容；移除 Open workspace 主流程。
- 项目选择进入对应会话范围，不激活工作区；宽屏三栏，窄屏在列表和会话间切换且恢复搜索/滚动。
- 同一终端往返后 PTY ID、xterm 节点不变，浏览器 guest 不受影响；结构化会话草稿和审批保持。
- 无效/断联 owner 在右侧显示状态，不回退本地主机。

## Implementation Steps
1. 更新 DESIGN.md 和 D02 规范。
2. SessionNavigationSection.tsx:70 改为选择会话；SessionProjectsMenu.tsx 展开为可见项目导航。
3. SessionDetail.tsx:111 用现有 terminal portal 替代跳转占位；复用 session-navigation.ts:75 的精确归属校验。
4. TerminalOverlaySlot.tsx 保持稳定 portal 根节点，按右侧锚点展示选中的原终端；use-terminal-workspace-store-bindings.ts:66 为 sessions 启用现有 parking 豁免链。
5. 更新 ui-p2-sessions.spec.ts 的旧跳转断言，保留身份连续性检查；运行 structured E2E、定向单元测试、类型、质量和构建，采集宽窄浅深截图。

## Risks / Mitigations
Portal 换目标会重新挂载 xterm：使用稳定 body portal 与 CSS anchor。主机串用：复用精确 owner 解析，失败在当前会话显示。旧 activity 与新 sessions 共享发布器：页面卸载清空，按 activeView 订阅，验证往返。

## Verification
测试必须验证右侧真实内容和不跳页，不再以“返回工作台成功”作为会话打开验收。真实远程与三平台原生窗口未运行时明确记录。
