# HiveCode upstream 同步机制

`vendor-integration` 是唯一的上游吸收分支，禁止直接把 `upstream/main` 合并到产品分支。同步顺序固定为：

1. `git fetch upstream main`；
2. `audit-fork-delta.mjs`；
3. `track-upstream-changes.mjs`；
4. `upstream-intake.mjs`（parent dependency closure、patch-id、ledger 与报告）；
5. `run-upstream-sync-gates.mjs` 及平台回归矩阵。

BUG/安全修复进入 backport lane；新功能、UI 和美化进入 product decision lane。冲突时保留 HiveCode 产品边界、品牌和现有 UI，再手工提取上游行为修复。ledger 位于 `config/upstream-change-ledger.json`，矩阵位于 `config/upstream-regression-matrix.json`。
