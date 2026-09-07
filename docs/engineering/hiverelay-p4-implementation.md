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
