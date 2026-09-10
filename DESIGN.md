# Design
## Source of truth
Active · 2026-09-10 · P2 桌面会话三栏修正。依据用户 Multica 截图、ChatPage/ChatThreadList 上游源码、本地 sessions 与 terminal overlay 实现。详细方案：`docs/design/p2-three-column-correction.md`。用户最新指示取代旧 D02 的工作台跳转流程。
## Brand
HiveCode；安静、紧凑、可读。沿用桌面主题，不复制 Multica 品牌或增加无关业务菜单。
## Product goals
从项目范围和会话列表直接继续会话。成功标准是会话可操作、列表上下文保留、执行身份不变。本次不扩展 P3 组织操作、P4 项目管理。
## Personas and jobs
同时处理多个项目与本地/远程智能体会话的开发者，需要快速切换并继续工作。
## Information architecture
左侧项目与功能导航；中间会话列表；右侧当前会话 Tab。选择会话更新右侧内容，不导航工作台。采用 Multica 当前 Chat Tab 内切换模式；关闭可见会话仅取消选择，不终止会话。
## Design principles
导航身份和执行 owner 分离。复用真实内容和运行实例。直接操作优先，无详情占位中转。
## Visual language
遵循 docs/STYLEGUIDE.md、main.css 语义 token；sessions.css 使用局部变量。紧凑行、细分隔、浅深主题、已有 Lucide 图标。
## Components
复用 SessionsPage/ListPane、SessionStatus、NativeChatView、TerminalPane 与现有 portal。项目导航展开显示项目行。右侧标题以当前会话 Tab 呈现。
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
无阻断问题。多独立会话 Tab 同时铺开的扩展不在此次要求中；本次落实截图中的当前会话 Tab 内直接切换。
