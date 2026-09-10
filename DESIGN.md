# Design

## Source of truth

Active · 2026-09-10 · P2 桌面会话三栏修正。依据用户 Multica 截图、ChatPage/ChatThreadList 上游源码、本地 sessions 与 terminal overlay 实现。详细方案：`docs/design/p2-three-column-correction.md`。用户最新指示取代旧 D02 的工作台跳转流程。

## Brand

HiveCode；安静、紧凑、可读。沿用桌面主题，不复制 Multica 品牌或增加无关业务菜单。

## Product goals

从项目范围和会话列表直接继续会话。成功标准是会话可操作、列表上下文保留、执行身份不变。本次按用户补充支持会话置顶与归档分组，不扩展项目管理。

## Personas and jobs

同时处理多个项目与本地/远程智能体会话的开发者，需要快速切换并继续工作。

## Information architecture

侧栏不再展示“最近会话”或临时会话列表，统一使用中间会话列表浏览、置顶及归档；项目与空间导航保留。
左侧项目与功能导航；中间会话列表；右侧当前会话 Tab。选择会话更新右侧内容，不导航工作台。单击替换当前面板会话；拖入中央添加标签，拖到边缘分屏。归档仅移入归档分组。关闭可见标签仅移除展示，不终止会话。

## Design principles

导航身份和执行 owner 分离。复用真实内容和运行实例。直接操作优先，无详情占位中转。

## Visual language

遵循 docs/STYLEGUIDE.md、main.css 语义 token；sessions.css 使用局部变量。紧凑行、细分隔、浅深主题、已有 Lucide 图标。

## Components

复用 SessionsPage/ListPane、SessionStatus、NativeChatView、TerminalPane 与现有 portal。项目导航展开显示项目行。右侧复用 TabGroupSplitLayout 的分屏布局、缩放手柄与既有真实终端/聊天实例；不同 runtime 会话只改变展示位置，不迁移执行 owner。

## Accessibility

语义按钮、Tab/tabpanel 关联、键盘选中与返回、可见焦点；不以颜色作为唯一状态信号。

## Responsive behavior

宽屏保持左中右；沿用 sessions 容器 640px 阈值切换列表/内容，返回保留筛选与滚动。长标题省略但保留完整 title。

## Interaction states

无选择显示选择提示；挂载中在右侧显示加载；无效或断联 owner 就地反馈。禁止静默切到本地主机。

## Content voice

使用会话、项目、主机等用户概念；移除“进入工作台继续”的必经步骤。

## Implementation constraints

不新增依赖。会话/PTY 生命周期继续由既有 owner 管理。终端投射保持稳定 DOM 根和 PTY，结构化聊天复用单实例。Electron 仅后台 CDP 测试。

## Open questions

无阻断问题。用户 2026-09-10 补充要求已扩展为拖入多个会话并支持 split，替代之前单一会话展示限制。

## 项目与创建入口（2026-09-11）

项目会话与项目管理合并，左侧仅保留“项目管理”入口。点击后中间复用 Orca 分组 → 项目 → worktree 树；没有分组时直接显示项目。点击 worktree 沿用原工作区激活流程；项目树保留在中间，右侧直接复用应用已有的完整工作区面板（Terminal 工作区、多 Tab、分屏、浏览器/编辑器和右侧文件面板）。不再为项目管理建立会话集合面板；原工作区面板保持单一挂载，切换遵循原 owner、恢复和快捷键逻辑。

原分组数据、项目/worktree 右键管理与创建流程保留。中间的新建入口携带选中的项目、工作区和执行设备，项目管理中创建 worktree 或会话后继续显示原工作区面板；全局会话列表的创建仍返回会话视图。全局“会话”入口仍用于跨项目会话列表。
