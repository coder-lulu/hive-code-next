# Paperclip 任务服务

本入口复用固定 Paperclip `a027f76a726e8a556674eded807c2de0e55f5cc0` 的 PostgreSQL schema 和迁移，业务任务仍存于 `companies`、`agents`、`issues`、`heartbeat_runs`。外部执行生命周期复用 manifest 固定摘要的纯核心模块；没有加载上游 heartbeat/server、Provider adapter、SkillStudio、CompanySkills 或其他执行管线。所有未列出的 HTTP 路径均在执行前拒绝。

当前用户选择的执行器是 HiveCode 管理的 **Codex 结构化会话**。Paperclip 唯一 adapter 仍是 `hive_runtime`；公共命令的 `agent: hivecode` 表示交给 Hive 宿主，可信 profile `codex / codex:1` 决定实际执行器。Provider 登录由已有 Codex 链管理。HiveCloud 登录和本机 Runtime 归属授权仍是任务权限前提。

## 构建与启动

1. 在项目 `logs/paperclip-p1/paperclip` 检出上述固定 SHA。默认构建使用该数据库源码和本仓库固定摘要的外部执行核心模块。设置 `HIVE_PAPERCLIP_SOURCE` 时，指定检出还须包含 manifest 所列、摘要一致的外部执行模块；缺少模块或摘要不符会拒绝构建。
2. 在该 Paperclip 检出目录执行 `pnpm --filter '@paperclipai/db...' install --ignore-scripts --frozen-lockfile`，仅准备已有固定数据库依赖。
3. 在 HiveCode 项目执行 `pnpm run build:paperclip-service`。构建会同时验证 SHA 和 DB/shared/迁移源码摘要，生成 `out/paperclip-service`、许可证及 `logs/p1-closeout/service-build.json`。迁移产物固定 LF，原源码不变；启动时仅将已记录、可证明等价的 CRLF 校验和规范化到同一 Paperclip 迁移日志，保留记录 ID/时间与业务数据。无法证明的历史校验和会在迁移前拒绝。Provider 包或上游执行源码进入 bundle 时构建失败。
4. 准备独立 PostgreSQL 数据库。当前本机验证使用 PostgreSQL 18，Docker 端口只发布到 `127.0.0.1`。禁止复用 HiveCloud 或 New API 的数据库。
5. 按 [environment.example](environment.example) 设置服务环境，在启动 HiveCode 开发客户端后运行 `node out/paperclip-service/server.mjs`。三个环境变量只属于旁侧服务，不进入 Agent 环境或 Prompt。
6. 运行 `pnpm run check:paperclip-service`。退出码 `0` 表示旁侧数据库和已授权 Runtime 均可用；`2` 表示旁侧服务已就绪但 Runtime 尚未授权；`1` 表示旁侧服务未就绪。检查只输出去敏元数据。

Windows 开发服务在宿主 Node 中运行，以使用与原生 Runtime 相同的 loopback；HiveCode 默认从其 userData 的 `hive-tasks/paperclip.json` 读取私有描述符。开发版 userData 通常为 `%APPDATA%/orca-dev`。服务每次启动生成新的受限凭据和随机本机端口，描述符不得提交或交给 Renderer、Agent。

[Dockerfile](Dockerfile) 只打包同一份 `out/paperclip-service`。构建示例：`docker build --pull=false -f integration/paperclip/service/Dockerfile -t hive-paperclip-p1:a027f76a out/paperclip-service`。镜像内没有 HiveCode/Agent。容器运行要求受支持的 host network 和私有描述符目录挂载；镜像构建通过不等于 Windows 上已完成该网络部署。当前实际开发验收使用上述宿主 Node 服务。

## 默认开放与拒绝

开放 `GET /hive/health`、`/hive/tasks` 下的创建、列表、读取、绑定、派发和取消，以及 `/hive/workbench` 公司、项目、员工配置和流程定义操作。全部要求专用服务凭据、精确 loopback Host，拒绝浏览器 Origin/Sec-Fetch；业务请求还要求由受信 Hive Facade 提供当前账户。Renderer 无法提交绑定或服务凭据。

核心观察控制另使用 `POST /hive/external-execution/{companyId}/{runId}`，只接受 `recover`、`cancel`、`drain` action，不接受账户 header、binding、命令或执行参数。服务从真实数据库绑定解析账户及任务；受理回执仅表示保留执行，不能据此声明重连、完成或停止。取消和交接先保存意图；无法联系 Runtime 时返回不可用并保留活动槽。Paperclip fork 的两处 heartbeat 装配通过 `HIVE_PAPERCLIP_EXTERNAL_EXECUTION_DESCRIPTOR` 读取同一私有服务描述符，该变量不进入 Agent。详见[恢复切点和当前验收缺口](../patches/failure-matrix.md)。

创建请求按账户和 requestId 幂等。业务任务先提交，再发行独立目录和 durable binding，最后派发。绑定只允许当前个人受信 Codex profile，不接受团队、不可信任务、新增资源快照或其他 executor。成果/取消使用 Runtime 完整终态回执，在 PostgreSQL 事务中检查 task revision、run checkout、execution identity 和指纹；重复回执只结算一次。未知结果与仅收到取消请求时仍保留 checkout。

原始工作区不会被 stash/reset 或覆盖。P1 复制当前文件至独立受管 folder，包含 dirty/untracked 文件，排除 `.git`、`node_modules`、`logs`，拒绝链接；上限为 20,000 项、单文件 8 MiB、总计 256 MiB。这里是目录分离，执行仍使用用户本机 Codex 权限，未提供团队/不可信任务的操作系统沙箱。

Codex 在任务中写入带 execution ID/指纹的结果 manifest。宿主还检查对应 Prompt 的提交记录、真实 Provider turn verdict、无运行中的 turn/tool，并取得实际退出证据后才结算。最多保存 32 个、每个 8 MiB 的不可变成果副本。页面预览支持不超过 1 MiB 的 UTF-8 文本；二进制或更大的预览明确不可用，不从任意路径读取。

## 工程流程定义

流程配置复用固定上游的 `pipelines`、`pipeline_stages` 和 `pipeline_transitions`，同一 Paperclip 数据库保存不可变定义版本。每次保存对应独立的上游 Pipeline，已有版本的阶段 ID 和定义保持不变；后续运行必须固定所消费的版本。读取时核对真实上游图，发现配置、阶段、转换或归属漂移即拒绝，不静默重建。

受限业务路径均使用 `POST`：

| 路径                             | 操作与边界                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `/hive/workbench/workflows/list` | 按当前账户所属项目读取；UUID 游标分页，单页最多 50 项和约 384 KiB                      |
| `/hive/workbench/workflows/read` | 读取指定流程的最新或指定历史版本，拒绝其他账户、项目或不存在的版本                     |
| `/hive/workbench/workflows/save` | 保存完整定义；要求 `requestId`、预期流程版本和项目绑定版本，拒绝并发版本冲突及未知字段 |

每个定义包含 4～32 个阶段、四种工程职责、非空验收条件、显式依赖和测试失败退回目标；最大尝试次数为 3、并发为 4、时长为 24 小时。服务校验依赖图、返回目标和职责输出，拒绝循环、空白验收条件及超大定义。保存事务同时写入上游图、定义版本、幂等回执和 `activity_log`，同一请求重放不会新增版本或审计事件。

Hive Facade 从既有认证通道和真实项目映射取得公司范围，保存前后复核账户与宿主工作区证明。浏览器使用同一严格 schema 和已有便携 SHA-256 校验定义摘要；不持有服务凭据，也不能从客户端指定执行命令、环境或权限。

这些接口只编辑业务定义。流程派发、独立测试交接、失败退回执行和部署审批仍须完成相应宿主与业务实现；配置保存不代表任务已开始、团队隔离已通过或成果已测试。

## 功能需求与阶段任务

用户从「任务」页的团队工作台选择公司和项目，配置产品、开发、独立测试、发布准备四个成员，保存工程交付流程后点击「提交功能需求」。提交会保存真实 Pipeline Case、一个需求 Issue 和各阶段的工作 Issue，固定提交时的流程版本及团队绑定。流程后续修改不改变已有需求的定义；重载页面后可以重新选择需求并查看原版本和阶段任务。

| 路径 | 行为 |
| --- | --- |
| `/hive/workbench/cases/create` | 以当前账户、项目及 `requestId` 幂等创建需求，校验固定流程摘要和项目版本 |
| `/hive/workbench/cases/list` | 当前项目的需求摘要；可按流程过滤，UUID 游标分页 |
| `/hive/workbench/cases/read` | 原定义、原团队、需求正文和真实阶段 Issue 状态；再次校验归属 |

创建 HTTP 响应为 `{ admission, view }`。回执包含请求 ID、案例 ID、原输入指纹和是否重放；Main 校验回执后向界面返回案例详情。已提交请求的重试恢复原案例，并读取当前业务标题、正文和状态；更改原请求内容会拒绝。工作流保存也先恢复已提交回执，再对新请求执行版本检查，避免团队配置更新遮蔽已保存结果。

需求正文最多 48,000 个 UTF-16 字符。只有需求创建的请求体上限为 320 KiB，以容纳中文及 JSON 转义；其它接口保持 64 KiB。超限请求在业务写入前拒绝。界面同账号的凭据或元数据刷新保留未提交草稿，真实账号或会话边界变更会清空草稿并拒绝迟到响应。

当前需求提交只保存和分配阶段任务，未派发成员执行。缺少团队宿主隔离证明时明确显示执行不可用；真实成员交接、独立验收、失败退回和发布准备仍待接通。需求协议、容量和持久化回归分别见 `paperclip-workflow-cases-http.test.mjs`、`paperclip-workflow-cases-capacity-postgres.test.mjs`、`paperclip-workflow-cases-postgres.test.mjs`；合成账户验收不代表真实 Codex 团队执行通过。

## 验收

工程流程与功能需求从「任务」页的团队工作台发起：

1. 选择公司和本机项目，配置四个成员，保存工程交付流程。
2. 选择已保存流程，填写尚未提交的需求和流程草稿，再点击工作台「刷新」。同一项目及团队版本下，选择、草稿和重试请求应保留；切换账号或项目后应清空。
3. 点击「提交功能需求」，确认需求正文、固定流程版本和四个阶段任务可查看。最大合法中文需求应能提交；超过字符上限应保留草稿并拒绝提交。
4. 修改并保存新流程版本，重载页面后重新选择原需求。原需求仍显示原流程和团队绑定，新流程继续用于后续提交。
5. 缺少团队隔离能力时，页面应明确显示团队执行不可用。保存成功和任务分配不代表成员已执行或交付完成。

在 HiveCode「任务」页点击「Codex 任务」，选择已有本机工作区。使用要求生成 `report.md` 的无敏感输入，验证只出现一个任务、成果可查看、原工作区未被修改。另建持续工作任务并取消，确认状态在实际停止证明到达后才变为「已取消」。重复创建请求、重复 start、错账户、错工作区和未知状态不得产生第二次执行。

2026-10-02 已在 Windows 真实登录与已授权 Runtime 上通过 Codex 文件成果、并发请求幂等、运行 writer 取消和客户端文本预览。取消验证包含原生进程身份退出、文件停止写入及 checkout 释放；页面未知结果继续只读刷新至终态。暂停旁侧服务后普通编程终端仍可运行，恢复服务后授权预检通过。基础闭环已验收，范围和矩阵对应见 [P1 第 8.4 节](../../../docs/Hive-paperclip/P1-本机任务执行闭环开发计划.md#84-已授权-runtime-的真实-codex-验收2026-10-02)。

自动化回归：设置 `ORCA_BACKGROUND_LAUNCH=1` 后直接运行 `pnpm exec vitest run --config config/vitest.config.ts config/scripts/paperclip-task-service.test.mjs`。默认只运行无外部副作用的并发检查。真实数据库回归要求 `HIVE_PAPERCLIP_TEST_CONFIG` 指向 `logs/` 下的私有 JSON，字段为 `containerName`、`databaseUrl`、`serviceDescriptor`；测试仅接受 `hive-paperclip-p1-` 容器和 loopback `hive_tasks` 独立库。测试用合成账户只验证业务协议，不能替代真实 Hive/Codex 验收。

当前恢复实现重读持久绑定和原始工作区目录身份，观察同一 execution；缺少原始证明、目录被替换或启动结果未知时保留占用，不自动重铸或重跑。实际 Runtime/Codex 故障恢复、团队强隔离和长期自治仍有阶段验收缺口，见恢复矩阵。缺少真实登录、进程证据或 UI 截图时，阶段记录必须保留对应缺口。

流程数据库验证使用同一专用 PostgreSQL 配置，运行 `config/scripts/paperclip-workflow-postgres.test.mjs`；受限 HTTP 与重启读取验证见 `config/scripts/paperclip-external-execution-http.test.mjs`。浏览器打包与实际 schema 执行验证见 `config/scripts/hive-workflow-browser.test.mjs`。这些合成身份测试证明对应协议和数据行为，不替代真实成员执行或整个阶段验收。

打包许可证来自固定版本的 [Drizzle ORM LICENSE](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.2/LICENSE) 和 [Postgres.js UNLICENSE](https://raw.githubusercontent.com/porsager/postgres/v3.4.9/UNLICENSE)，以及已安装 Zod 包的 LICENSE；构建按实际 bundled dependencies 生成第三方声明。
