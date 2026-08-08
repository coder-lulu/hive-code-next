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

## Change record

Every accepted exception to this policy records:

- the exact path and reason;
- the approving roles;
- the compatibility contract being preserved;
- the tests and static scans run; and
- the planned removal or upstream-sync strategy, if the exception is temporary.
