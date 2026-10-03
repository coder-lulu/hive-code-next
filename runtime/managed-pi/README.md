# HiveCode managed Pi text Pack

P0 uses the real pinned Pi packages with a synthetic stream. The product build now
generates a verified Pack. The single-turn Pi kernel, P2 adapter and local persistent
process driver/supervisor now exist. The execution-host factory reuses the existing
record store, reservation CAS and lease renewer, proves the exact child, acquires a
fence before P2 journal writes and releases only after actual close. The desktop main
process now installs a trusted local principal producer, binding server-verified
account/device identity to current local ownership and a resolved native project.
Its short proof is revoked on account/ownership changes, project removal or shutdown;
folder guards recheck inherited group/repository connections. Once invalidation is
observed, that binding cannot revive after project restoration or a clock rollback;
an eligible project requires a fresh verified binding.
It supplies no inference Grant or tool permission. Production boot assembly and the
Grant-authorized inference endpoint remain pending. The integration tests supply a
local inference port; actual Pi tests also verify transaction-time principal revocation.
The execution-host release port refuses live/unverifiable leases without its own
driver handle, including deletion recovery. Actual child exit stops renewal, and
repeated close calls preserve a failed cleanup outcome.
The external Claude/Codex runtime renewer excludes managed Pi records; Pi renewal
requires its own fresh private IPC and authorization proof.
`agent.mjs` requires an
explicit model/stream and starts with empty tools/context. Keep Hive persistence,
authorization and billing outside Pi.

The W02 loader core now lives in `src/main/runtime/managed-pi-pack-loader.ts`.
Its internal input is an absolute installed root and an index SHA-256 from the
trusted product build. The loader must never obtain that expected digest from the
same mutable install, a renderer request, PATH or an external Pi installation.
The strict `pack-index.json` includes schemaVersion 1, the current text manifest
without packRevision, and SHA-256/size pairs for exactly seven artifact roles:

| Role    | Installed filename                  |
| ------- | ----------------------------------- |
| node    | node.exe on Windows, node elsewhere |
| runner  | agent.cjs                           |
| package | package.json                        |
| lock    | pnpm-lock.yaml                      |
| sbom    | sbom.json                           |
| license | LICENSE                             |
| notice  | NOTICE                              |

The verified index digest becomes packRevision. The loader hashes regular
single-link files asynchronously with bounded reads, checks the exact inventory,
then probes only the verified bundled Node with the managed environment and safe
process wrapper. The existing resolver checks declared pins/platform/profile;
the probe checks actual Node/platform/architecture. It never executes the runner.
Its readPack port reuses P2 admission, and its guarded launch-file accessor and
dispose operation retain permanent revocation after observed file/root changes.
Synchronous guards compare precise file/root identities instead of repeatedly
hashing the Node binary. This is not an OS sandbox or protection against every
hostile same-user filesystem race; launcher/supervisor validation remains required.

`config/build-plugins/managed-pi-pack-producer.ts` creates
`out/managed-pi/<platform>-<arch>` during main builds and dev startup. It bundles
`agent.mjs` without external npm imports and emits the exact inventory above plus
the index. `managed-pi-pack-product.ts` receives the fresh index digest at compile
time. Existing Electron-builder resources copy the matching Pack and reuse the
loader before/after signing; signing exclusions preserve only Pack Node bytes.
All Pack build slices are excluded from app.asar, including stale foreign targets;
the existing extraResources mapping alone copies the selected target.
Runtime input/pin changes require restarting the dev build. Unsupported or missing
target Packs fail explicitly; cross-target release assembly is still pending.

`getManagedPiRuntimeIdentity` reports actual bundled package/Node versions. The main
`managed-pi-runtime-identity.ts` preflight imports only this trusted bundle using its
verified Node and the existing safe wrapper/environment allowlist. It compares the
Pack before/after and retains revocation. A short-lived import is not a long-lived
child identity/lease handshake.

`runManagedTextGeneration` fixes one empty-tools/empty-transcript turn and requires
the supervisor's explicit Hive stream. It emits only sequenced plain text and a normal
completion after Pi is idle, with a one-event owned handoff and 1 MiB/1,000-event cap.
The raw stream is checked before Pi can discard terminal reasons or pre-start updates;
one normal done terminal is required. Present text blocks must contain strings.
Unsupported content, truncation, missing/inconsistent terminals or runtime errors remain UNKNOWN.
Final-only and valid empty text/content responses work; cancellation/return abort and await
Pi. The handoff cap does not bound the SDK provider queue. The local supervisor bounds
the turn and stops its owned child when the stream cannot finish normally.

The main `managed-pi-text-adapter.ts` validates/fixes the existing P2 input, reuses
Pack admission and guards, and forwards verified launch files through an internal
execution-host driver port. Completion is held until that driver has ended. No Pi SDK
is imported into production main/renderer, no second journal or retry path is added,
and no production host is assembled yet. Confirmed journal context, model/Grant
budget narrowing and authoritative settlement remain pending.

`startManagedTextProcess` is the persistent private-IPC entry. The main
`managed-pi-process-supervisor.ts` uses the verified bundled Node, safe spawn wrapper
and environment allowlist. Its mandatory execution-host port supplies the session,
record/fence, reserved spawn token, current-ownership guard and identity/exit callbacks;
this module does not grant durable leases or add a session/status store. A fresh private
epoch/challenge verifies the exact spawned PID, parent PID, token and actual runtime
metadata before admission and each turn. OS creation time is compared when available;
the child's uptime-derived time is not substituted for a missing OS timestamp. This
local Alpha driver rejects remote ownership and does not adopt surviving processes.

`managed-pi-text-driver.ts` requires an explicit parent inference port. Only bounded
owned text/final events cross IPC, with strict session/generation scope and awaited
acknowledgements. No endpoint, API key, Grant or administrator credentials enter the
child. Normal completion requires the kernel's valid final evidence, its generation
idle acknowledgement and the parent inference iterator's EOF; the persistent child
can then handle the next turn. P2 still waits for the driver iterator to end. Cancellation,
consumer return, timeout, protocol failure and ownership/source revocation retire the
driver and stop only its owned process using existing termination helpers. Disposal
and transport failure abort the active parent inference even if its consumer is paused.
A generation deadline continues after parent EOF until kernel idle/final evidence;
external abort also stops the child while final-only text awaits consumer acknowledgement.
Per-exchange/event failure listeners, timers and abort listeners are removed after
settlement, rather than accumulating reactions on the persistent failure Promise. Identity
commit precedes the exit callback, and the latter requires actual child close. A parent
callback that ignores abort is not proof that a remote HTTP request was cancelled.
Concrete HTTP cleanup, production lease/host assembly and confirmed context remain pending.

`legal/` retains the pinned upstream Pi LICENSE and matching Node LICENSE with
source URLs/hashes. The actual runner closure's package licenses and Node's full
vendored terms enter NOTICE; missing non-Pi licenses stop the build. The SBOM
records the runner closure and Node, not a complete vendored Node binary inventory.
Node comes from the controlled build executable and must match the unified pin;
official distribution checksum/signature attestation is not claimed. Signed installer,
macOS/Linux execution, production persistent-child lease and update/rollback acceptance remain
pending. The build smoke imports the actual standalone module with copied Node, but
does not prompt Pi or attest a real conversation. Separate kernel tests prompt real Pi
with controlled streams in owned bundled-Node children, including actual persistent IPC
through the P2 adapter. Current local identity and ownership are bound in main;
next connect real text Grant/HTTP/proxy, production host, confirmed context and settlement.
Missing dependencies
remain explicitly unavailable; no production fixture fallback or opt-in flag is added.

This private package has one independent lockfile for the supervised runtime,
not a second application implementation. Node comes from `../../package.json`
(`engines.node`); do not add a separate Node pin. Root dev/main-build scripts and CI
prepare these fixed dependencies with `prepare:managed-pi` before building or testing.
Preparation uses the frozen lock with dependency scripts disabled and fails closed.
A direct standalone test after a root-only install must also run that preparation.
Run the following from the `hive-code-next` root, using its declared pnpm via Corepack:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
corepack pnpm run build:electron-vite
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

Source tag/commit are recorded in `package.json`; resolved integrity values are in
`pnpm-lock.yaml`. Package updates require review, refreshed legal inputs and affected
tests, not automatic adoption of the source mirror. Distributed notices and the SBOM
are build inputs for further release dependency/license review.
