# Contributing to HiveCode

HiveCode is a product fork of [Orca](https://github.com/stablyai/orca). Changes
in this repository should improve the HiveCode product while preserving the
compatibility surfaces required by existing Orca clients.

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

Upstream synchronization is maintainer-managed and must use the protected
vendor-integration workflow. Do not edit release tags, upstream casks, or
upstream publication settings as part of an ordinary product change. Resolve
product-versus-upstream conflicts deliberately, then run the boundary and test
checks again on the promoted checkout.

## Compatibility Contract

Do not rename or remove these without an explicit migration plan: `orca` and
`orca-ide` CLI aliases, `orca://`, `ORCA_*` variables, `X-Orca-Agent-Hook-Token`,
`.orca` paths, `engines.orca`, `stablyai.orca-*` plugin IDs, and legacy bundle or
provider identifiers. They are retained for interoperability even though the
product is branded HiveCode.
