# 工程团队与成果交接契约 v1

状态：2026-10-11。首条四角色工程链、Product 草稿及幂等采纳已验收。有限已采纳任务图已通过受控 Docker 真实执行、独立审核、原运行取消恢复、原生报告/界面及服务重启留存验证，相关自动化和构建通过；三轮源码复核通过，提交前实现与验收验证完成；文档交付复核和实际 Git 发布回执待补齐。计划替换、任务工具、资源/知识加载及硬预算仍待接入；本切片不代表部署、远程或完整持续自治验收。

TypeScript 的流程与提案来源为 [src/shared/task-workflow](../../../src/shared/task-workflow/)，采纳 API 来源为 [hive-workflow-plan-application.ts](../../../src/shared/hive-workflow-plan-application.ts)，图控制与运行视图来源为 [hive-workflow-plan-runs.ts](../../../src/shared/hive-workflow-plan-runs.ts)。[task-workflow.schema.json](task-workflow.schema.json) 由同源生成；[test-vectors.json](test-vectors.json) 给出固定示例和成果/批准失效向量。它是业务对象与证据绑定合同，不替代 [P0 execution v1](../v1/README.md)，不新增启动器、运行账本或独立业务调度平面。

| 对象                            | 固定约束                                                                                                                         | 权威与接入位置                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| CompanyBinding / ProjectBinding | 当前 Hive 拥有者、Paperclip company/project、Hive workspace 显式 ID 映射；保持 PERSONAL/OWNER 不变量                             | P2 的 P3-T02/T03/T04，A2 消费同一映射                                     |
| EmployeeBinding / TeamBinding   | 首期产品、开发、独立测试、运维四个不同员工；只引用受管 Codex profile/revision，adapter 固定 hive_runtime                         | P2 的 P5-T01/P3-T05；职责不授予登录、文件或设备权限                       |
| WorkflowDefinition              | 固定 workflowRef/revision；4～32 个阶段；显式依赖、outputKind、验收标准与 returnToStageRef；1～3 次尝试、1～4 并发与最长 24 小时 | P3 的 P5-T02/T03/T11；Paperclip 保存业务定义及不可变版本                  |
| Handoff                         | 固定原工作流运行、生产者执行、成果 ref/revision/digest、依赖成果版本与有限共享摘要                                               | P3 的 P5-T03/T04；成果字节与来源须由 Runtime 原成果索引验证               |
| CodeVersion                     | Git base commit + 固定补丁成果 + treeDigest，或固定快照成果 + treeDigest；脏/非 Git 工作区使用快照                               | 固定代码输入；不能把报告文件或当前工作区当作已封存源码                    |
| Review                          | tester 的独立 task/execution/session/executionWorkspace/claim；固定被测成果与代码版本，独立测试报告                              | P3-T09 / P5-T07；版本改变使旧测试失效                                     |
| DeploymentApproval              | 固定成果、代码版本、review、目标、deploy/rollback 动作、actor、授权 revision 和截止时间                                          | P3-T09；运维准备材料不自动取得部署权限                                    |
| SharedEvent                     | 稳定 sharedEventId/causationId、项目和指定员工范围、有限摘要及成果引用                                                           | P2-T03 / P3-T07；完整私有上下文、transcript、密钥和工具配置不进入共享载荷 |

所有对象严格拒绝未知字段。引用、SHA-256 摘要、时间与业务 TaskRef 复用 P0 校验；集合在解析元素前检查上限。上面的限制是首条工程流程的固定能力边界，后续提高限制需先变更同一契约并验证消费者。传输层仍须在 JSON 解析前落实请求字节上限，单靠对象 schema 不能替代它。

JSON Schema 描述字段、枚举和集合限制；跨对象/图语义还必须执行同源检查：

- WorkflowDefinition 拒绝重复阶段/依赖、未知依赖、循环；开发依赖产品，测试依赖开发，运维依赖测试，可经过中间阶段。输出分别为 requirements/code/test_report/release_plan；测试失败必须指向其开发祖先阶段退回，受 maxAttempts 约束。
- `workflowHandoffBindingRefusal` 核对受理时封存的流程版本、团队映射、阶段分配、受众和依赖版本数量。依赖成果的具体 revision/digest 还须和授权存储中的 Handoff 核对。
- `workflowReviewBindingRefusal` 核对固定成果及代码版本，拒绝开发者使用同一员工、task、execution、session、实际执行工作区或 claim 自测。`executionWorkspaceRef` 必须由 Runtime 根据实际隔离目录形成；它不是所有员工共用的原项目 workspaceRef。
- `workflowDeploymentBindingRefusal` 核对独立通过的 review、成果版本、准确目标/动作/actor/授权版本和时效；到期时刻即拒绝。
- `workflowCompletionBindingRefusal` 要求每个必需编码交接有唯一匹配且通过的独立 review。必需集合须从授权存储中的已采纳计划取得，不能由模型自选漏报。子任务 cancelled、仅已终态、缺测试或重复决策不能形成工程通过。

这些函数返回 null 仅表示绑定一致，**不授予权限，也不证明文件、执行、测试或隔离真实存在**。消费者必须读取认证存储中的原记录，核对 Runtime 成果索引和终态/停止证明，并对当前账号、对象、动作、范围、撤销与有效期重新授权。不得把请求体或模型自报 JSON 当成这些可信记录。

流程编辑生成新 revision；在途运行继续引用原版本。employee/profile/配置变更仅影响新受理，旧执行仍需当前授权检查。Paperclip case.version 是个案乐观锁，不是流程定义版本；不得混用。不可变定义版本应保存在同一 Paperclip 业务域的受控增量表/记录中，而非另建 Hive 调度平面。

本机四角色链已有固定成果、代码快照、独立测试工作区及业务 review 消费者。工程团队运行必须使用 enforced_autonomous；即使公司的 ownerScope 仍是 personalTenant，也不能发行 trusted_personal_preview 绕过隔离。缺少当前宿主强隔离和授权证据时仍保持能力不可用。

## 结构化计划提案基础

`PlanProposal` 是严格的 `workflow.plan-proposal` 数据对象，绑定准确的 company/project、workflow/run/revision、definitionDigest、goalRef 和 planRevision。`goalRef` 表示调用方认证存储中的原业务目标；`planRevision` 是提案草稿版本，不能用 Case 乐观锁或流程定义版本替代。

每个任务有提案内唯一 taskRef、非空标题、requestedRole、outputKind、验收标准、前置依赖及 1～3 次尝试。最多 32 个任务，每项最多 32 个前置依赖和 16 条验收标准；依赖路径最多 8 个节点。引用只在该提案内解析，不是已创建的业务 taskId。允许单角色研究计划；不要求所有提案包含四角色。解析拒绝重复/缺失依赖、自环、循环、超深图和角色输出不匹配。通过图校验不证明独立测试或工程完成。

requestedLimits 限制最多 4 并发、最长 24 小时；可选预算只接受正整数 costMicros 和三个大写字母的 currency，复用既有用量的百万分之一精度。它是需求，不代表已预留额度、可计费金额或已覆盖硬预算。

可选 resourceSelectionRefs 和 requiredCoverage 必须同时完整出现；最多 16 个唯一 opaque 选择器。可选 knowledgeRequirements 最多 16 个唯一 sourceRef，明确 required。选择器不是 URL、路径、命令或授权，消费者仍须准确解析与重新验权。普通无资源/知识计划可以省略它们；已声明的需求不可静默丢弃。

`inspectWorkflowPlanProposalJson` 在 JSON.parse 前检查 128 KiB UTF-8 上限，保留 Unicode 字节语义。`inspectWorkflowPlanProposal` 对照调用方从认证存储取得的固定目标、允许角色与更窄策略上限，返回具体拒绝原因或保留原提案的 validated 投影。validated 仅表示这些数据检查通过，不是授权或采纳；草稿 inspection 保留采集时的一般业务 DAG 派发缺口，不能用作当前图执行资格。资源加载和硬预算需求有阻断缺口；必需知识有阻断缺口，可选知识缺失明确披露。

`WorkflowPlanIntent` 由服务端在新 Product 受理事务中封存，包含原 TaskRef、员工、固定目标与校验策略；planRevision 按原 Case 的实际意图记录独立分配。启动命令要求意图中的 spaceId、taskId、runId、attempt、taskRevision 与原命令一致。规划提示词沿用原 Product 运行，要求在原成果清单中提交 requirements.md 和 plan-proposal.json。

`WorkflowPlanDraft` 复用认证后的原成果与终态结算链，在 outcome_consumed 事务中保存 validated、rejected 或 unavailable/plan_artifact_missing 投影，以及原意图、生产者、输入摘要和成果版本。来源校验先于内容解析；内容拒绝保留原成果身份，来源不匹配拒绝业务变更。原生 Case 详情提供只读版本、来源及缺口预览。历史运行没有规划意图时不补造草稿；重复结算与取消仍遵循原执行边界。

草稿检查通过不表示计划已采纳，也不触发一般业务任务图派发。用户从原需求详情查看差异并采纳，服务在同一事务创建真实 Paperclip issues、父子引用和 blocks 依赖，返回含 planRevision、原 requestId 及 createdTaskRefs 的固定回执。相同请求或相同计划的其他请求返回原回执；修改同一请求内容拒绝。每个 Case 当前只允许一个不可变采纳，替换已有任务明确不可用。

采纳要求原 Product 成功、草案仍为当前规划意图、原始摘要一致，且当前拥有者、项目和职责绑定有效；源 Case 取消、未知、未结算或仍有执行占用时拒绝新采纳。原固定流程终态与历史不会被重新执行或改写。采纳创建的任务初始状态为 blocked，不自动派发；资源、知识和硬预算需求完整保留，显式图启动仍须独立通过能力与授权门槛。读取旧采纳时会对照其准确原草案核对版本、完整任务映射与依赖，不能用当前查看的另一版本替代来源。

`PlanDiff` 按提案内 taskRef 比较新增、删除、字段和计划要求变化，不把顺序调整当作依赖变化。窄 API 为 `/hive/workbench/plans/read` 和 `/hive/workbench/plans/apply`；请求携带目标、预期 Case/项目版本、planRevision 与完整 draftDigest，不接受模型自选任务 ID 或执行参数。公开 schema 提供查询、采纳请求/回执/视图/回复字段，跨对象语义仍必须运行同源校验。[plan-proposal-test-vectors.json](plan-proposal-test-vectors.json) 固定纯合成提案向量。

## 已采纳有限任务图

图按已认证 application 映射真实业务任务，使用独立的 plan runScope 和原 Runtime 执行链。每个 application 只有一个控制记录；来源、开始时间、申请时长及截止时间固定，状态与 revision 可更新。显式启动重新核对当前账号、项目/职责绑定、源 Case 完成、占用和能力；要求资源、必需知识或硬预算时在排队前拒绝。封存的草稿 inspection、采纳回执 dispatch 与当前图 availability 分别表达各自事实。

最多 32 任务、8 层依赖、4 并发和每任务 3 次尝试。申请时长不超过提案限制及 24 小时；所有运行、重试和恢复共用原图截止时间。每个 Developer 必须恰有一个直接独立 Tester；Tester 固定唯一 Developer，Ops 直接依赖唯一通过审核的 Tester 及其对应代码快照。支持 Product 研究图；不支持返工边、递归提案或自动创建 Developer 返工。审核拒绝暂停图，完成必须核对所有任务最新成功、业务 done、准确快照及唯一独立审核。

查询、启动、取消、重试和恢复分别使用 `/hive/workbench/plans/graph-read`、`graph-start`、`graph-cancel`、`graph-retry`、`graph-resume`，均绑定当前账号及原 application；变更核对 revision 与请求幂等。私有 run-read/prepare 不暴露给 renderer，renderer 不读取原始 prompt。原生成果报告固定 task/run/outcome/artifact/digest；最新尝试变化或退出账号后清除旧报告。角色成果从完整认证 manifest 选择唯一规范 leaf，拒绝不安全路径、多匹配及不完整清单子集，保留原完整 name/version/digest；不创建别名或读取 latest。计划提案仍严格匹配 `plan-proposal.json`。图执行复用原 Case 的角色完成合同，Tester 必须提交有效 review 和独立测试命令证据。已绑定运行核对原冻结输入摘要、完整命令指纹及原执行范围，不用更新后的 prompt 模板替换原输入；未绑定受理仍严格校验当前构造结果。

未知和取消待证据的运行持续占用槽位，不用 TTL 或 PID 缺失推定停止。取消精确对应原 native run 集合。绑定运行恢复取消须使用持久化原请求、准确 binding、原 stopping snapshot 与执行宿主正向停止证明；冷启动复用已验证的原停止/释放证据，保持幂等。连接中断不能替代停止证明，cancel_requested 不显示为 cancelled。人工重试要求最新失败已结算且有 stopped/not_started 证明、至少 1000 ms 退避、剩余次数和有效原截止时间。成功父成果后的依赖受理整批使用 savepoint；拒绝回滚该批 checkout/排队并保留父成果。仅带可信 admission_unavailable 原因的暂停可显式恢复，重新验权与检查期限/依赖/占用，拒绝失败、未知、取消或审核拒绝的最新状态，不重放生产者。

容量边界见 [hive-workflow-plan-response-budget.ts](../../../src/shared/hive-workflow-plan-response-budget.ts) 和 [task-native-transport-limits.ts](../../../src/shared/task-execution/task-native-transport-limits.ts)：图响应 4 MiB/65,536 structural tokens，私有运行输入最多 1,500,000 字符、run-read 12 MiB/8,192 tokens；workflow start/binding/outcome 为 1 MiB/65,536 tokens，普通命令保留 64 KiB，嵌套深度仍为 16。容量回归不代表真实规模性能验证。proposePlan、TaskToolFacade、计划替换、资源/知识消费者和硬预算仍未接入。

从项目根生成和核对：

```sh
node config/scripts/generate-task-workflow-contract.mjs
node config/scripts/generate-task-workflow-contract.mjs --check
pnpm exec vitest run --config config/vitest.config.ts src/shared/task-workflow src/shared/task-execution src/main/tasks/task-execution-host.test.ts
```

生成器使用 logs 下独立临时目录，原子发布完整文件；--check 只核对，不改写 schema。修改契约时同步固定示例、语义向量和同源校验，后端/前端不得各造一份宽松 JSON。
