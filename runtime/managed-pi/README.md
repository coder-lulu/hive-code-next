# HiveCode managed Pi runtime seed

P0 uses the real pinned Pi packages with a synthetic stream; this is not yet a
desktop adapter, production Pack or inference endpoint. `agent.mjs` requires an
explicit model/stream and starts with empty tools/context. Keep Hive persistence,
authorization and billing outside Pi.

This private package has one independent lockfile for the supervised runtime,
not a second application implementation. Node comes from `../../package.json`
(`engines.node`); do not add a separate Node pin. Run the following from the
`hive-code-next` root, using its declared pnpm via Corepack:

```powershell
corepack pnpm --dir runtime/managed-pi install --frozen-lockfile --ignore-scripts
$env:ORCA_BACKGROUND_LAUNCH='1'
corepack pnpm exec vitest run --config config/vitest.config.ts config/scripts/managed-pi-p0.test.ts
```

The test uses the existing safe spawn wrapper and the environment allowlist in
`src/main/runtime/managed-pi-environment.ts`. Fixtures use temporary fake homes,
credentials, project resources and an external stand-in process. Only owned
children and temporary fixtures are cleaned up. No global Pi/Node installation,
upstream source import or live model call is needed.

The fixture instruments common Node file/network APIs before importing Pi. Its
zero-attempt result is a smoke observation, not an OS sandbox or a guarantee for
all possible dependency behavior. Real user Pi versions, abnormal shutdown,
updates/uninstall, packaging and provider authentication remain P4/P3 work.

Source tag/commit are recorded in `package.json`; all resolved integrity values
are in `pnpm-lock.yaml`. Package updates require review and affected tests, not
automatic adoption of the source mirror. Registry license metadata and audit
are preliminary checks; distributed artifacts still need their actual NOTICE
and dependency/license review.
