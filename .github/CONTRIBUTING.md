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

## Pull Requests

Describe the user-visible outcome, compatibility impact, and verification you
ran. Include screenshots for UI changes and call out any platform-specific or
SSH-specific behavior.

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
