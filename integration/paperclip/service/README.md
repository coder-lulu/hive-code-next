# P1 Paperclip 任务服务

本入口复用固定 Paperclip `a027f76a726e8a556674eded807c2de0e55f5cc0` 的 PostgreSQL schema 和迁移，业务任务仍存于 `companies`、`agents`、`issues`、`heartbeat_runs`。没有 Hive 影子任务数据库，也没有加载上游 `server/src`、Provider adapter、SkillStudio、CompanySkills 或其他执行管线。所有未列出的 HTTP 路径均在执行前拒绝。

当前用户选择的执行器是 HiveCode 管理的 **Codex 结构化会话**。Paperclip 唯一 adapter 仍是 `hive_runtime`；公共命令的 `agent: hivecode` 表示交给 Hive 宿主，可信 profile `codex / codex:1` 决定实际执行器。Provider 登录由已有 Codex 链管理。HiveCloud 登录和本机 Runtime 归属授权仍是任务权限前提。

## 构建与启动

1. 在项目 `logs/paperclip-p1/paperclip` 检出上述固定 SHA。也可设置 `HIVE_PAPERCLIP_SOURCE` 指向相同版本的独立检出目录。
2. 在该 Paperclip 检出目录执行 `pnpm --filter '@paperclipai/db...' install --ignore-scripts --frozen-lockfile`，仅准备已有固定数据库依赖。
3. 在 HiveCode 项目执行 `pnpm run build:paperclip-service`。构建会同时验证 SHA 和 DB/shared/迁移源码摘要，生成 `out/paperclip-service`、许可证及 `logs/p1-closeout/service-build.json`。迁移产物固定 LF，原源码不变；启动时仅将已记录、可证明等价的 CRLF 校验和规范化到同一 Paperclip 迁移日志，保留记录 ID/时间与业务数据。无法证明的历史校验和会在迁移前拒绝。Provider 包或上游执行源码进入 bundle 时构建失败。
4. 准备独立 PostgreSQL 数据库。当前本机验证使用 PostgreSQL 18，Docker 端口只发布到 `127.0.0.1`。禁止复用 HiveCloud 或 New API 的数据库。
5. 按 [environment.example](environment.example) 设置服务环境，在启动 HiveCode 开发客户端后运行 `node out/paperclip-service/server.mjs`。三个环境变量只属于旁侧服务，不进入 Agent 环境或 Prompt。
6. 运行 `pnpm run check:paperclip-service`。退出码 `0` 表示旁侧数据库和已授权 Runtime 均可用；`2` 表示旁侧服务已就绪但 Runtime 尚未授权；`1` 表示旁侧服务未就绪。检查只输出去敏元数据。

Windows 开发服务在宿主 Node 中运行，以使用与原生 Runtime 相同的 loopback；HiveCode 默认从其 userData 的 `hive-tasks/paperclip.json` 读取私有描述符。开发版 userData 通常为 `%APPDATA%/orca-dev`。服务每次启动生成新的受限凭据和随机本机端口，描述符不得提交或交给 Renderer、Agent。

[Dockerfile](Dockerfile) 只打包同一份 `out/paperclip-service`。构建示例：`docker build --pull=false -f integration/paperclip/service/Dockerfile -t hive-paperclip-p1:a027f76a out/paperclip-service`。镜像内没有 HiveCode/Agent。容器运行要求受支持的 host network 和私有描述符目录挂载；镜像构建通过不等于 Windows 上已完成该网络部署。当前实际开发验收使用上述宿主 Node 服务。

## 默认开放与拒绝

开放 `GET /hive/health`，以及 `/hive/tasks` 下的创建、列表、读取、绑定、派发和取消。全部要求专用服务凭据、精确 loopback Host，拒绝浏览器 Origin/Sec-Fetch；业务请求还要求由受信 Hive Facade 提供当前账户。Renderer 无法提交绑定或服务凭据。

创建请求按账户和 requestId 幂等。业务任务先提交，再发行独立目录和 durable binding，最后派发。绑定只允许当前个人受信 Codex profile，不接受团队、不可信任务、新增资源快照或其他 executor。成果/取消使用 Runtime 完整终态回执，在 PostgreSQL 事务中检查 task revision、run checkout、execution identity 和指纹；重复回执只结算一次。未知结果与仅收到取消请求时仍保留 checkout。

原始工作区不会被 stash/reset 或覆盖。P1 复制当前文件至独立受管 folder，包含 dirty/untracked 文件，排除 `.git`、`node_modules`、`logs`，拒绝链接；上限为 20,000 项、单文件 8 MiB、总计 256 MiB。这里是目录分离，执行仍使用用户本机 Codex 权限，未提供团队/不可信任务的操作系统沙箱。

Codex 在任务中写入带 execution ID/指纹的结果 manifest。宿主还检查对应 Prompt 的提交记录、真实 Provider turn verdict、无运行中的 turn/tool，并取得实际退出证据后才结算。最多保存 32 个、每个 8 MiB 的不可变成果副本。页面预览支持不超过 1 MiB 的 UTF-8 文本；二进制或更大的预览明确不可用，不从任意路径读取。

## 验收

在 HiveCode「任务」页点击「Codex 任务」，选择已有本机工作区。使用要求生成 `report.md` 的无敏感输入，验证只出现一个任务、成果可查看、原工作区未被修改。另建持续工作任务并取消，确认状态在实际停止证明到达后才变为「已取消」。重复创建请求、重复 start、错账户、错工作区和未知状态不得产生第二次执行。

2026-10-02 已在 Windows 真实登录与已授权 Runtime 上通过 Codex 文件成果、并发请求幂等、运行 writer 取消和客户端文本预览。取消验证包含原生进程身份退出、文件停止写入及 checkout 释放；页面未知结果继续只读刷新至终态。暂停旁侧服务后普通编程终端仍可运行，恢复服务后授权预检通过。基础闭环已验收，范围和矩阵对应见 [P1 第 8.4 节](../../../docs/Hive-paperclip/P1-本机任务执行闭环开发计划.md#84-已授权-runtime-的真实-codex-验收2026-10-02)。

自动化回归：设置 `ORCA_BACKGROUND_LAUNCH=1` 后直接运行 `pnpm exec vitest run --config config/vitest.config.ts config/scripts/paperclip-task-service.test.mjs`。默认只运行无外部副作用的并发检查。真实数据库回归要求 `HIVE_PAPERCLIP_TEST_CONFIG` 指向 `logs/` 下的私有 JSON，字段为 `containerName`、`databaseUrl`、`serviceDescriptor`；测试仅接受 `hive-paperclip-p1-` 容器和 loopback `hive_tasks` 独立库。测试用合成账户只验证业务协议，不能替代真实 Hive/Codex 验收。

P2 才处理重启后的绑定恢复、孤立副本清理和长期自治。P1 重启后发现已有发行 intent 时明确返回 unknown，保留占用，不自动重铸或重跑。缺少真实登录、进程证据或 UI 截图时，阶段记录必须保留验收缺口。

打包许可证来自固定版本的 [Drizzle ORM LICENSE](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.2/LICENSE) 和 [Postgres.js UNLICENSE](https://raw.githubusercontent.com/porsager/postgres/v3.4.9/UNLICENSE)，以及已安装 Zod 包的 LICENSE；构建按实际 bundled dependencies 生成第三方声明。
