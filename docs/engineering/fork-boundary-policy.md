# HiveCode Fork Boundary Policy

Status: active for repository-owner review

This policy keeps the HiveCode product overlay small, auditable, and removable while
allowing the repository to follow upstream Orca. It applies to `hivecode/main-next`,
`vendor-integration`, and any product or plugin branch derived from them.

## Review ownership

Changes covered by this policy require approval from both roles below:

1. **HiveCode maintainer** — owns product identity, release configuration, and the
   decision to introduce a new product integration seam.
2. **Upstream compatibility reviewer** — verifies that protocol, Runtime, Relay,
   persistence, and mobile transport changes remain compatible with upstream.

`@coder-lulu` is the verified CODEOWNERS owner for this convergence work. Required
CODEOWNERS reviews and branch protection still depend on the repository's GitHub
plan and settings; no upstream account is used as a substitute for HiveCode
approval.

A pull request touching an upstream-core path must include:

- the user-visible or compatibility reason for the change;
- the expected impact on the next `upstream/main` synchronization;
- focused tests or a documented reason why a test is not applicable; and
- the output of the fork-delta and relevant boundary checks.

Self-approval is not sufficient for changes that cross an upstream-core boundary.

## Three maintained synchronization lists

The machine-readable source of truth is
[`config/upstream-sync-boundary.json`](../../config/upstream-sync-boundary.json).
Every upstream change is classified before it is promoted:

| Class                            | Paths (repository-relative prefixes)                                                                                                                                                                                                                                           | Synchronization rule                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HiveCode product boundary**    | `config/product/`, `config/hivecode-brand-allowlist.json`, `config/electron-builder.config.cjs`, `src/main/product/`, `src/main/hive-account/`, `src/main/hive-runtime-cloud/`, generated product config, `.github/workflows/`, `resources/`                                   | HiveCode-owned. Never overwrite with an upstream version; port intentionally and preserve product brand, manifest, endpoints, release, packaging, account, and HiveCloud behavior. |
| **Upstream directly absorbable** | `src/shared/`, `src/relay/`, `src/main/providers/`, `src/main/daemon/`, `src/main/network/`, `tests/`, `config/scripts/`                                                                                                                                                       | Directly absorb only when no product or manual-review path is involved. Run compatibility tests and retain protocol/persistence compatibility.                                     |
| **Manual review required**       | Runtime RPC, PTY, Git/SSH, mobile workspace creation, window lifecycle, updater (`src/main/runtime/rpc/`, `src/main/pty/`, `src/main/ipc/pty/`, `src/main/git/`, `src/main/source-control/`, `src/main/ssh/`, `mobile/src/worktree/`, `src/main/window/`, `src/main/updater/`) | Resolve conflicts only on `vendor-integration`; require both product and upstream reviewers before promotion.                                                                      |

When a new file does not match a list, classify it explicitly in the manifest before
syncing. More-specific lists win over broad prefixes (for example, a test under a
manual-review directory remains manual review). The manifest and this policy are
updated together so the boundary remains auditable over time.

## Large-module migration boundary

The manifest's `moduleSplitTargets` list is the long-lived migration ledger for the six
HiveCode-owned files that are too behavior-dense to replace wholesale during an upstream
sync. Each target keeps its current import path as a facade while implementation moves
behind smaller modules. A migration must add or update behavior-contract tests before
moving code, then run the target's existing compatibility suite before promotion.

The current first wave extracts pure Web Runtime protocol helpers and introduces a
transport seam behind `WebRuntimeClient`; it intentionally keeps pairing, Cloud-managed
credentials, reconnect, and file-watch behavior in the same public facade. PTY, preload,
window, SSH/Git, and remaining Runtime transport moves stay manual-review work until
their contracts are green. Never resolve these files directly on a product branch: sync
on `vendor-integration`, port product behavior into the facade, and promote only after
the contract tests and boundary checks pass.

## Upstream-core allowlist

The following directories are upstream contracts. HiveCode changes are allowed only
when they are required for compatibility, a product adapter seam, or a security fix:

- `src/main/runtime/`
- `src/shared/`
- `src/relay/`
- `src/main/orca-profiles/`
- `mobile/src/transport/`

An allowed change must preserve existing wire names, RPC shapes, persistence formats,
provider identifiers, and upstream environment-variable compatibility unless an
explicit migration plan and review approval are included.

## Product-owned areas

New product behavior should be implemented in these areas first:

- `config/product/`
- `config/scripts/` for generators and read-only audits;
- `src/main/product/` for narrow product adapters;
- `src/shared/generated/` for generated product configuration;
- `mobile/src/generated/` for generated mobile configuration;
- release/build configuration and explicit user-facing legal/about screens;
- independently installable plugin packages and their own storage.

Product-owned code must not import private `src/main/*` implementation details from a
plugin. Plugins must use versioned Plugin API capabilities and contributions.

## Product-brand literal allowlist

Product-brand literals are restricted by `config/hivecode-brand-allowlist.json`.
The allowlist contains exact repository-relative files rather than broad source-tree
patterns, so a new literal-bearing file requires an explicit, reviewable policy change.
The check is case-insensitive and covers both file contents and file names. It also
fails on stale allowlist entries, making removal of a product literal a ratchet rather
than leaving permanent exceptions behind.

The allowlist has a `protectedFileHashes` section that holds the normalized (LF-only)
SHA-256 of files that do not contain the brand literal themselves but whose
modification could hide a literal-bearing file from the scanner (e.g. `.gitignore`).
When a protected file's hash no longer matches, the boundary check fails, and the
change requires explicit policy review and a coordinated hash update in the
allowlist.

Run the boundary locally with:

```bash
pnpm run check:brand-boundary
```

The PR static-analysis job runs the same command. Adding an exception merely to make
CI green is not sufficient: the file must be a product-owned boundary, a packaging or
compatibility entry point, generated product configuration, or a focused identity
test. Runtime/RPC methods, persistence schemas, provider identifiers, and unrelated
upstream internals are not acceptable new exception locations.

## Frozen areas during convergence

The following changes are frozen in the upstream core until the convergence gates
are complete:

- global brand replacement or mass literal substitution;
- Blueprint implementation and its experimental domain model;
- desktop Pet implementation and window-management hooks;
- commercial control-plane, billing, order, or tenant features;
- new Runtime/RPC/Relay schema fields introduced only for an experimental feature;
- new core database migrations introduced only for an experimental feature;
- new provider identifiers or upstream service fallbacks for HiveCode defaults.

Blueprint and Pet work must remain on independent branches or plugin workspaces until
their migration gates are satisfied. Their archive branches are not substitutes for
reviewed product integration.

## Explicit denylist

The following actions are prohibited during convergence:

- cherry-picking the historical Blueprint, Pet, or global-brand commits as a whole;
- changing `src/main/runtime/`, `src/relay/`, or persistence schemas merely to avoid
  adapting a plugin to the stable API;
- changing upstream protocol field names or internal identifiers for branding;
- making HiveCode production defaults fall back to `login.onorca.dev`,
  `relay.onorca.dev`, `orca-desktop`, or other unapproved upstream services;
- adding secrets, signing material, or endpoint credentials to product configuration;
- merging `upstream/main` directly into `hivecode/main-next` or the final `main`;
- resetting or cleaning the archived legacy worktree before its recovery evidence is
  independently verified.

## Branch and synchronization rules

The supported flow is:

```text
upstream/main
  -> vendor-integration
  -> compatibility and boundary gates
  -> reviewed change
  -> hivecode/main-next
  -> Phase 7 acceptance
  -> main
```

Conflicts are resolved only on `vendor-integration`. Product branches start from a
validated `hivecode/main-next`; Blueprint and Pet branches are not upstream-sync
inputs. The legacy `main` and `origin/main` remain protected until Phase 7 acceptance.

Before each upstream merge, `vendor-integration` first incorporates the selected
product target (`hivecode/main-next` during convergence, then `main` after Phase 7).
The resulting vendor commit therefore contains both the current product overlay and
the new upstream history. Compatibility gates run against that exact commit. The
workflow refuses to propose it if either the vendor branch or product target moves
while the gates are running.

## Upstream change intake order

The machine-readable priority policy is
[`config/upstream-change-priority.json`](../../config/upstream-change-priority.json).
The synchronizer tracks commits reachable from the new upstream head but not from
the previous vendor base and writes an ordered intake report to the sync artifact:

```bash
pnpm run audit:upstream-changes -- \
  --base <previous-vendor-sha> \
  --head <new-upstream-sha> \
  --output upstream-change-intake.md
```

Changes are reviewed in this order:

1. Security and data consistency fixes.
2. PTY, WSL, SSH, and Relay stability fixes.
3. Agent recovery and Runtime fixes.
4. Performance optimizations.
5. Modular refactoring.
6. Pure upstream Orca interaction or branding changes.

The tracker chooses the highest priority when a commit matches multiple rules.
Unmatched changes fall into priority 6 and remain explicitly marked for manual
review; they are never silently treated as safe direct absorption.

## Required checks

At minimum, a core-boundary change runs:

```bash
node config/scripts/audit-fork-delta.mjs --base upstream/main --head HEAD
pnpm run check:brand-boundary
pnpm run typecheck
pnpm run lint
pnpm run test
```

The affected desktop, CLI, web, and mobile gates must also be run when the change
crosses their corresponding boundary. A failed upstream baseline is recorded as a
baseline fact; it must not be hidden by weakening or deleting tests.

Every upstream vendor merge runs the fixed gate manifest in
[`config/upstream-sync-gates.json`](../../config/upstream-sync-gates.json):

```bash
pnpm run verify:upstream-sync-gates
node config/scripts/run-upstream-sync-gates.mjs --suite=platform
```

The common suite scans product-brand literals, exercises HiveCloud account and
endpoint flows, updater source/signature policy, mobile pairing/Relay/workspace
contracts, Runtime RPC cloud close/reconnect behavior, generated artifacts, and
both root and mobile lockfiles. The platform suite is required on the Windows,
macOS, and Linux runners and covers PTY, WSL, and SSH contracts. The
`upstream-sync.yml` workflow runs both suites against the exact immutable
`vendor-integration` commit before it can open a product-branch PR.

## Change record

Every accepted exception to this policy records:

- the exact path and reason;
- the approving roles;
- the compatibility contract being preserved;
- the tests and static scans run; and
- the planned removal or upstream-sync strategy, if the exception is temporary.
