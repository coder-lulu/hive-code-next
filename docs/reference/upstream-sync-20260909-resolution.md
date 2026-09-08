# Upstream integration: 2026-09-09

Scope: upstream `12f53da542d03473367e48a63b85a49eae7c5f8b` through `6b60c23e07de7b2602b796176db94d6430d725f9`, plus the three existing pending product decisions. Frozen product: `308d4da18ab7038227816842bc3cfdc52fabce58`. Vendor publication lease: `b471648085824cc49813e3885866fde0ad7f01eb`.

The user authorized cleanup of merged branches, pointer updates, preservation of upstream fixes, direct review by this agent, and product promotion after review. GitHub Actions remains disabled; all checks are local. No independent-role approval is claimed.

## Per-commit decisions

| Commit | Decision and functional review |
| --- | --- |
| `bba68b1bdd` | Absorb Pi prompt completion across titlebar and managed hooks, including nested dialogs, failed painters, lost runner and OMP detection. Keep Hive hook identity. The added esbuild development dependency is used to test the emitted extension source. |
| `6108ce617c` | Absorb activity menu filter/view grouping. Existing host/project ownership, unread state, clear actions and theme primitives remain intact. |
| `e829bb523a` | Keep the deleted Orca download-count badge absent. Carry this display-only product-boundary decision forward; it is not a deferred BUG/security fix. |
| `2ba2c90cb6` | Absorb terminal custody at creation, before the worker boot wait. The host/pane/process identity is recorded transactionally while the Dispatch is still starting; the worker capability is not granted early. User takeover must survive start success/failure and fence release. |
| `8f78c28248` | Absorb mobile takeover reports after accepted sends. Reports use the owning client and handle, throttle per client/terminal, retry boundedly, and enter through the authenticated mobile RPC allowlist. Raw byte lanes do not perform orchestration SQL. Hive account RPC methods remain present. |
| `4f0e3806a9` | Absorb effort-picker ordering after the model picker without changing option payloads. |

| `d7d21b2c55` | Absorb picker-selected skill pills using the existing Tiptap dependency and theme primitives. Text transport retains exact invocation tokens; clipboard input stays literal; document caching remains bounded and pane-scoped. This composer presentation does not copy the retired skill-installer implementation. |
| `6b60c23e07` | Absorb keyboard focus-visible reveal and visible touch message actions, retaining timestamp and copy behavior. |

All eight decisions are recorded in `config/upstream-change-ledger.json`. The upstream main branch, rather than arbitrary upstream development branches, defines the ongoing sync boundary.

## Conflict resolutions

Two paths conflicted. `docs/assets/readme-downloads.svg` remains deleted under the product download/identity boundary. `mobile/src/session/mobile-session-route-parity.test.ts` retains the Hive route baseline; only callback-body and nested-function fingerprints changed after reviewing the accepted-send takeover additions. Hook counts, callback identities, effects, listeners, timers, identity payloads, navigation, capability gates, runtime strings, styles and JSX fingerprints are unchanged. Dedicated behavior tests cover accepted/rejected sends and owning-client targeting.

## Verification and limits

- Initial desktop/Runtime/Pi/UI focused regression: 10 files, 161 tests passed.
- Expanded native-chat regression initially passed 1202 tests with two stale Orca Browser label assertions. Both positive and negative assertions now use the actual HiveCode Browser product label, retaining the destination and modifier behavior checks. Final rerun evidence is recorded in the PR.
- Mobile full suite: 4411 passed, 6 failed, 3 skipped. The six failures are the previously reproduced product-baseline failures in workspace-creation-graphite, notification-route-coordination and future-settings-graphite; they are not marked passed. Mobile route parity and takeover send-site tests pass in this run.
- Broader Worker/Pi regression: 407 tests passed, 6 skipped; the unchanged agent-status-producer-census suite could not load because its Electron binary download failed. The suite-load failure is not counted as a passing test.
- Root and mobile typechecks, root/mobile lint and Web build passed for the initial six changes; root typecheck also passed after the two chat updates. Final lint/build, generated-file checks and immutable-candidate gates are recorded in the integration PR and local `E:/projects/hive-platform/upstream-0909-*` artifacts. Do not infer their status from this pre-publication document.
- No desktop installer build, live cross-Cell deployment, macOS or Linux execution is claimed. This scoped review does not turn the existing full-root-suite baseline failures into passes.

## Branch housekeeping

The stale local vendor pointer was updated and the previous sync branch was renamed for this integration. 5476 cached upstream development refs were removed after recording their names/SHAs; upstream fetch now follows only main. Three old verification worktrees had no unique commits and were unregistered. Windows deletion left residual files; snapshots/NUL files were archived and the remaining directories were moved intact under `E:/projects/hive-platform/branch-cleanup-20260909/`. No remote upstream branches, release tags or runtime-state ownership records were modified.
