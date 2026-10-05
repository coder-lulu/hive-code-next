# Contributing to HiveCode

HiveCode is a product fork of [Orca](https://github.com/stablyai/orca). Changes
in this repository should improve the HiveCode product while preserving the
compatibility surfaces required by existing Orca clients.

Engineering references are maintained in the [private documentation repository](https://github.com/coder-lulu/hive-code-docs); access requires repository authorization.

## Before You Start

- Keep changes scoped to a clear user-facing improvement, bug fix, or refactor.
- HiveCode targets macOS, Linux, and Windows. Guard platform-specific behavior
  explicitly and keep local, remote, and SSH paths covered.
- Reuse existing architecture and utilities. Avoid new dependencies unless the
  change requires one.
- User-visible copy, legal identity, and release identity use HiveCode. Preserve
  upstream names only for protocols, environment variables, persisted formats,
  plugin identities, and other documented compatibility contracts.

## Local Setup

```bash
pnpm install
pnpm dev
```

Ordinary installs include native dependencies for the current OS and CPU. Before cross-architecture packaging, including the dual-architecture macOS build, run `pnpm install:release`; see [the install policy](https://github.com/coder-lulu/hive-code-docs/blob/main/reference/pnpm-install-policy.md).

Before opening a change, run the checks relevant to its scope. The normal
baseline is:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Add high-quality tests for behavior changes and bug fixes. Prefer tests that would actually catch a regression, not shallow coverage that only exercises the happy path.

If your change affects UI or interaction behavior, verify it on the platforms it could impact.

## Type Declarations: Prefer `.ts` Over `.d.ts`

Project-owned type declarations belong in `.ts` files. `.d.ts` is reserved for ambient shims (e.g., `env.d.ts`, `vite/client.d.ts`). TypeScript's `skipLibCheck: true` setting applies globally, including to our own `.d.ts` files, which means any unresolved type reference in a `.d.ts` silently becomes `any` at its call sites. Write your types in `.ts` files so the compiler actually checks them.

CI enforces this for `src/preload/` and `src/shared/`.

## Pull Requests

Each pull request should follow [`.github/pull_request_template.md`](./pull_request_template.md). In particular:

- open with an ELI5 of the change (plain language paragraph; the PR title is the one-liner)
- explain what changed and why, and stay focused on a single topic when possible
- for any UI or interaction change, attach **before and after** screenshots (or short videos); if there is no visual change, say `No visual change` and why
- include high-quality tests when behavior changes or bug fixes warrant them
- include a brief code review summary from your AI coding agent that explicitly checks cross-platform compatibility, SSH/remote/local compatibility, supported agent and integration compatibility, performance risk, UI quality when applicable, and basic security risk
- mention any platform-specific, remote/SSH-specific, agent-specific, integration-specific, or git-provider-specific behavior and testing notes

## Upstream Synchronization

Upstream synchronization runs directly on `hivecode/main-next` or `main`, based
on the frozen remote product tip. No vendor branch or mandatory vendor PR is used. Do not edit release tags, upstream casks, or
upstream publication settings as part of an ordinary product change. Resolve
product-versus-upstream conflicts deliberately, then run the boundary and test
checks on the final candidate before publication. CI transports that candidate
as a Git bundle and separates its execution from publication credentials.
Do not re-enable disabled Actions as part of synchronization.

The public product history starts from its reviewed source snapshot. Future
synchronizations use a real three-way content merge against the frozen reviewed
upstream checkpoint, including when the public trees have no common ancestor.
CI requires Git 2.38 or newer for `merge-tree --write-tree`; this maintenance
requirement does not change the product's supported Git versions. A clean merge
becomes a single-parent product commit rather than importing upstream commits.
`config/upstream-tree-sync-receipt.json` records the frozen inputs and resulting
tree. Trusted gate and publication code recomputes that tree and verifies the
receipt; any following checkpoint commit may change only the synchronization
state. A merge conflict requires individual review and cannot be resolved by
automatically choosing either side.

For a conflicting interval, review base/product/upstream file versions and run
the relevant behavior checks in an isolated working tree. Record the exact
input and reviewed result blob identities, reasons and regression obligations
in `config/upstream-tree-review.json`. Commit this maintenance metadata and any
required control changes before freezing the product target for content
preparation. The verifier reads the review from that frozen target; a candidate
cannot grant itself permission to replace files. Missing conflict decisions,
different inputs, changed results or control-file overrides fail verification.
The ledger may be part of the content commit, but its original ownership and
nonpending historical evidence must remain unchanged.

Reviewed result objects must be available from the local review or its Git
bundle. An automatic preparation job that has only metadata and cannot obtain
those objects fails explicitly. It never invents resolutions or treats a hash
as proof that a missing file was reviewed. Candidate execution remains in
read-only jobs; publication uses the frozen control code.

When independently published product branches have different public roots,
every root must carry the same immutable baseline provenance, original ledger
blob, reviewed upstream cursor and pending decisions. The frozen product state
must pass that verification before tree absorption can supply inclusion evidence.
An unreviewed root cannot inherit another root's provenance. Preserve the original
historical product SHAs; import reviewed code changes without adding private
pre-open-source history to the public branch.

Keep `docs/` pinned to the private documentation gitlink. Any upstream change to
`docs/` or `.gitmodules`, including a change later reverted in the same interval,
blocks automatic synchronization until authenticated private absorption and its
reviewed checkpoint are recorded. Never copy upstream or private documentation
bodies into the public tree to bypass this boundary.

Publish the reviewed documentation changes to the authorized private repository
first. `upstream-private-docs-review.mjs` checks its authenticated private status,
write access, published commit and exact source/private blob coverage. Freeze
that proof with the updated gitlink in the maintenance metadata. Public records
contain identities and review decisions, while documentation bodies stay private.

The synchronization boundary is mandatory for both historical and current
upstream changes: all upstream BUG, security, stability, and data-consistency
fixes must be absorbed or documented as already equivalent, and all upstream
features that do not cross a product boundary must be absorbed. Product
decision is required only for an explicit product-boundary or compatibility
conflict. Where an upstream feature overlaps HiveCode UI, preserve HiveCode
branding and existing UI capabilities while adopting upstream behavior.

The first synchronization performs one complete historical review. Later runs
start at the reviewed upstream SHA in the frozen product target's
`config/upstream-sync-state.json` and also revisit unresolved boundary feature
decisions. Candidate checkpoint changes become effective only after boundary
review, exact-candidate gates and a normal fast-forward push to the product
branch. Re-check the remote product tip immediately before publication; if it
moved, repeat preflight and validation. Failed gates and unpublished candidates
therefore cannot cause skipped updates. A malformed checkpoint or rewritten
upstream history requires explicit repair before continuing.

See [the private upstream review guide](https://github.com/coder-lulu/hive-code-docs/blob/main/reference/upstream-sync-review.md)
for inclusion evidence, required decisions, retry behavior, and focused platform
verification. Neither Git ancestry nor a passing merge replaces behavior review.

## Compatibility Contract

Do not rename or remove these without an explicit migration plan: `orca` and
`orca-ide` CLI aliases, `orca://`, `ORCA_*` variables, `X-Orca-Agent-Hook-Token`,
`.orca` paths, `engines.orca`, `stablyai.orca-*` plugin IDs, and legacy bundle or
provider identifiers. They are retained for interoperability even though the
product is branded HiveCode.
