# P4 account Runtime clients

Status: `VERIFIED_WITH_IOS_DEFERRED` — Android manual acceptance is confirmed by
the user on 2026-09-07; iOS acceptance is explicitly deferred because no Apple
development machine is available. P5 may proceed for this accepted scope.
No separate product editions or version switches
were introduced. This record supersedes historical P4 instructions preserving old
Relay clients or requiring default-off flags.

## Changes

- Shared material, channel, pool, stream ownership and error policy serve Desktop,
  Mobile and Web. Cloud receives a fresh key and secret digest. Cell receives only
  admission credentials and the public key. The ticket secret is sent once inside
  E2EE; subsequent RPC identity is bound to the authenticated Runtime socket.
- Strict JSON/schema/origin validation rejects duplicates, unknown response fields,
  expired material and low-order public keys. Mutable secrets are cleared on success,
  failure and stale completion; no claim is made about erasing garbage-collected copies.
- A pool has at most 8 physical channels, 64 consumers and 64 pending requests.
  Request and retained stream-key budgets are each 16 MiB. Identical logical streams
  share ownership; different streams without a cancellation/routing contract use
  bounded independent slots. Releasing the final owner closes that stream's socket
  and releases Runtime resources. RPC channels close after 30 seconds idle.
- Account changes, expiry, backgrounding, assignment changes and connection termination
  discard old material. Queued acquisition respects terminal errors and throttling.
  Unary operations are never automatically replayed.
- Mobile uses Expo's secure random source explicitly, including the E2EE nonce.
  The old Android cleartext API fallback was removed.
- Web is a static browser client at the user site's `/runtime/`. It reuses the
  existing HttpOnly BFF session and CSRF protection, then connects directly to Cell.
  It is not a Runtime execution site and does not change the meaning of
  `HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN`.
- Cell preserves both text and binary opcodes through its existing bounded queue.
  Browser extension offers are accepted without negotiating compression; compressed
  frames still close with 1002. The bounded JSON serializer also works without Node globals.
- Contract `hiverelay-v2-p0.8` records the actual Intent `201` response. Manifest:
  `243a8b0baf0c5a17a687d4b160a86e95fd0e8c96be3aa69349ce7083178a81a0`.

## Evidence

Necessary checks cover credential separation, exact frame limits, late-close races,
queued throttling, subscription release and no secret persistence. The short pool
test uses 20 consumers sharing two logical streams and checks independent binary
routing. Node, Web and Mobile type checks pass; CLI, desktop, Web and Android Hermes
builds pass. Changed-code quality checks pass after targeted fixes (48 changed files, zero new findings).
The final focused client run passes 52 tests, the bounded serializer passes 10 tests,
Mobile passes 50 tests, and the BFF passes 58 tests. Contract checks pass in all three
repositories; both consumers match all 111 authority file hashes.

Real integration uses Cloud with PostgreSQL, the production TLS Cell/Domain, Host,
Runtime account RPC dispatch and the shared client. Fixture RPC and streaming methods
exercise principal binding, JSON/binary delivery, Cloud revocation, cleanup and secret
canaries. This is transport integration, not a claim that every application RPC was tested.
The final Node + real Chrome run passes with zero skips (42.85 seconds). Chrome refresh
creates a new public key and material; cookies, local/session storage and IndexedDB stay
empty. Cloud revocation closes all clients and reaches REVOKED in the database.

The Web entry is also exercised in real Chrome with a controlled same-origin BFF
session/directory: login navigation, Runtime listing, narrow layout, no Electron API
and no secret storage. This entry test is separate from the service integration.

Reproduction uses the existing `Stage2bHiveRelayMigrationPostgresTest` bridge with
`HIVE_RUNTIME_HOST_TEST_SCENARIO=tests/e2e/hiverelay/hive-account-relay-cell.unit.test.ts`.
Use a disposable PostgreSQL database initialized from the existing base SQL, set
`HIVE_RELAY_POSTGRES_MIGRATION_IT_URL` and `HIVE_RUNTIME_HOST_CODE_REPO`, and run the
`stage2b-e2e` profile. Test fixtures own their TLS credentials and processes.

## Remaining acceptance and deployment

- Android Hermes export and lifecycle tests passed; an actual Android account Relay
  journey is not verified. Automatic approval rejected the second emulator deep-link
  launch with `blocked by policy` and no further reason. It was not retried.
- iOS device/simulator acceptance is unavailable on this Windows environment.
- Public Cloud, Cell and browser client deployment completed on 2026-09-06.
  The current browser entry is `https://console.hivekernel.com/runtime/`.
  Service health, Fleet activation and public Chrome/TLS checks passed. See the
  [deployment record](../../../hive-cloud/docs/hive/hiverelay-public-deployment-2026-09-06.md).
- Existing full E2E type-check baseline errors and bundle-size warnings remain;
  the modified application targets pass their type checks. No sustained-load or
  production-HA claim is made.

P4 must remain `PARTIAL` until the missing platform journeys have actual evidence.

## User acceptance follow-up (2026-09-07)

The user reports that all eight manual checks passed: account computer listing and
workspace connection; directory/file contents; terminal `echo P4_OK` input/output;
three minutes switching files and terminals without noticeable stalls or duplicate
output; recovery after 30 seconds in the background without command replay;
reconnection after 10 seconds offline; logout closing the previous account's
connection; and Runtime session revocation preventing further operations.

The user subsequently identified Android as passed and explicitly deferred iOS
until an Apple development machine is available. This supersedes the historical
requirement to block P5 on missing iOS acceptance. iOS remains unverified and must
not be included in any RC platform claim. The installed artifact was not specified;
do not equate this manual result with the current checkout automatically. The
public deployment record also contains earlier Android account/workspace/terminal
read-navigation evidence from 2026-09-07. Earlier PARTIAL statements are historical.

## Verification refresh (2026-09-10)

This is a current-checkout regression check, not a new all-platform acceptance or
public deployment. The Android acceptance and explicit iOS deferral above remain
historical evidence with their original artifact limitation.

Verified revisions:

- HiveCode: `39e80295062c9f296bda5dd32e96117244529ede`
- Cloud: `f0a93f3021167fb8efccd9667de8353928788841`
- Cell: `07ac3bf94a4efcd493f97a20b06203b4a80001de`

| Check | Fresh result |
| --- | --- |
| Shared/Desktop service/Web focused Vitest tests | 46 passed, 1 failed across 7 files |
| Mobile directory, reconciliation and RPC tests | 19 passed across 5 files |
| Node, Web and Mobile TypeScript checks | All three passed |
| `node config/scripts/verify-hiverelay-contract.mjs` | 147 passed, 1 skipped; integrity PASS |
| Cloud, HiveCode and Cell contract receipt hashes | All 114 files match in each repository |
| Real PostgreSQL + Cloud HTTP + TLS Cell + Runtime Host + headless Chrome bridge | 1 test passed, 0 failures/errors/skips |

The current contract is `hiverelay-v2-p0.9`, not the older p0.8 mentioned in the
phase plan. Manifest SHA-256:
`6cffb6deb3a9b8dfa31ea20db2663fc4cb66ed64435abea9aa2a0c126f941d4e`.
The generated integrity report is `config/hiverelay-contract-report.json`.

### Regression finding (resolved in follow-up below)

`src/renderer/src/web/account-runtime-relay/WebAccountConnect.test.tsx:63`
expects an accessible button named `刷新`, but the rendered button is `Refresh`.
The application boots in English and the test does not explicitly select a locale.
The preceding assertions for the unavailable/unauthorized alert and absence of an
RPC connection passed. This establishes a test-language mismatch, not a demonstrated
connection or refresh logic defect. Align the test locale or expected accessible
name and rerun before claiming the focused suite is green. No product or test code
was changed during this verification-only pass.

### Integration reproduction and limits

Prepare the Cloud reactor using `mvn -o -pl ruoyi-admin -am install
-Dmaven.test.skip=true`, then run `mvn -o -Pstage2b-e2e -pl ruoyi-admin test
-Dtest=Stage2bHiveRelayMigrationPostgresTest#realRuntimeHostHttpBridgeWithMockCell
-Dsurefire.failIfNoSpecifiedTests=true -Dmaven.test.skip=false` with the PostgreSQL
and HiveCode repository environment variables described above. Quote individual
`-D` arguments in PowerShell. The bridge test resides in `ruoyi-admin/src/test/java`.
Despite its historical method name, selecting
`tests/e2e/hiverelay/hive-account-relay-cell.unit.test.ts` starts the real TLS Cell
fixture and headless Chrome. Use `ORCA_BACKGROUND_LAUNCH=1` for background checks.

The bridge passed in 56.42 seconds and exercised principal-bound RPC, JSON/binary
and stream traffic, fresh browser connection material, revocation propagation,
database REVOKED status, cleanup and secret-canary checks. The optional
`HIVE_RELAY_CLOUD_PAUSE_TEST` branch was not enabled; this run does not establish
fresh Cloud-outage/deadline evidence. It also does not establish current Android,
iOS or packaged Electron UI acceptance, public-server health, or sustained load.

Local build and integration logs were captured at
`E:/hive-build/p4-build-20260910.log` and
`E:/hive-build/p4-verification-20260910.log`. The isolated loopback PostgreSQL
container `hive-p4-verify-20260910` and its disposable database volume were removed
after verification. No public services or user databases were changed.

### Web test locale fix and rerun (2026-09-10)

`WebAccountConnect.test.tsx` now saves the current language, awaits
`i18n.changeLanguage('zh')` before each test, and restores the saved language after
unmounting the component. The existing Chinese accessible-name assertion is kept;
no product behavior or translation catalog was changed.

Reran the same seven Shared/Desktop service/Web test files: **47 passed, 0 failed**.
The Web TypeScript check also passed. This resolves the language mismatch recorded
above; the other platform and integration verification limits are unchanged.
