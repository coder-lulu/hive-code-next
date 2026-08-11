# HiveCode

HiveCode is a product fork of [Orca](https://github.com/stablyai/orca), focused on
parallel agentic development across local and remote worktrees. The desktop and
mobile clients keep the upstream protocols and compatibility aliases while using
HiveCode branding and product identity.

## Status

This repository is an engineering fork, not an independent public distribution
yet. HiveCode's product manifest currently has no configured website, download,
cloud, update, support, or community endpoints. Do not use upstream release links
as HiveCode installation instructions.

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```

Build the desktop application with `pnpm run build:desktop`. Native builds are
platform-specific; see the scripts under `config/scripts/` for the supported
targets.

## Compatibility

Existing Orca integrations remain supported where changing them would break
installed clients or persisted data. This includes the `orca` and `orca-ide` CLI
aliases, the `orca://` scheme, `ORCA_*` environment variables, legacy `.orca`
directories, and upstream plugin identifiers. These are compatibility surfaces,
not HiveCode marketing names.

## Attribution

HiveCode is based on the open-source Orca project by Stably AI. Upstream-only
release and synchronization workflows remain explicitly scoped to the upstream
repository; product-facing copy in this fork uses HiveCode terminology.

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for contribution and
upstream synchronization boundaries.
