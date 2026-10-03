# 工程团队与成果交接契约 v1

状态：2026-10-03 冻结首期契约和校验代码；P2/P3 的存储、Facade、页面与调度消费者仍待接入。通过契约测试不表示团队执行、部署或多人权限已开放。

TypeScript 唯一来源为 [src/shared/task-workflow](../../../src/shared/task-workflow/)。[task-workflow.schema.json](task-workflow.schema.json) 由该来源生成；[test-vectors.json](test-vectors.json) 给出固定示例和成果/批准失效向量。它是业务对象与证据绑定合同，不替代 [P0 execution v1](../v1/README.md)，不新增启动器、运行账本或业务调度器。

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

当前 P1 成果索引提供固定字节和摘要，但还未生成上述完整代码快照、独立测试工作区或业务 review。工程团队运行必须使用 enforced_autonomous；即使公司的 ownerScope 仍是 personalTenant，也不能发行 trusted_personal_preview 绕过隔离。当前 TaskExecutionHost 仍拒绝该范围；无完整宿主强隔离证据时保持能力不可用。

从项目根生成和核对：

```sh
node config/scripts/generate-task-workflow-contract.mjs
node config/scripts/generate-task-workflow-contract.mjs --check
pnpm exec vitest run --config config/vitest.config.ts src/shared/task-workflow src/shared/task-execution src/main/tasks/task-execution-host.test.ts
```

生成器使用 logs 下独立临时目录，原子发布完整文件；--check 只核对，不改写 schema。修改契约时同步固定示例、语义向量和同源校验，后端/前端不得各造一份宽松 JSON。
