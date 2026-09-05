# Single current Relay implementation

The September 6 product decision supersedes the earlier P3 default-off and legacy
compatibility notes. There are no released users requiring parallel implementations.

## Implementation

- A claimed, configured Runtime starts its Host automatically after RPC readiness.
  Cloud selects placement when no region is supplied. Signed authority, mTLS,
  revocation, capacity checks and bounded queues remain required.
- Removed the old Relay service, invite/resume transport, automatic fallback and
  redundant product switches. Desktop, Node, Web and mobile direct connections use
  the current transcript-bound encrypted session. Fixed protocol identifiers and
  cryptographic domain strings remain part of that single wire contract.
- Removed the unaccepted account-client prototype that exposed its ticket secret
  outside the encrypted channel. Account remote connection fails before issuing
  credentials or opening a socket until P4 implements the current client contract.
  Local pairing and account directory operations remain available.
- Cloud and both consumers share contract revision `hiverelay-v2-p0.7`, manifest
  SHA-256 `12be3f464bbb61022f4b832b5f394e2e111f97b775dbbeafa03f299932058140`.

## Deployment addresses

API defaults to `https://api.hivekernel.com`; identity defaults to
`https://identity.hivekernel.com/realms/hive`. Update endpoints remain unconfigured
because the public release service and update API are not ready.

No Runtime Web execution site is currently deployed. `console.hivekernel.com` is
the user portal, and `ops.hivekernel.com` is the management portal. Neither replaces
a Runtime execution site. Leave `HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN` unset until
the actual HTTPS site and WSS proxy exist. Then configure it and Cloud's
`HIVE_RUNTIME_WEB_LAUNCH_ALLOWED_HTTPS_ORIGIN` with the same exact HTTPS origin,
and set the Runtime Web client and WebSocket paths. No production origin is guessed.

## Verification and limits

Necessary checks cover current-session authentication, replay rejection, binary
frames, bounded queues, startup, configuration and the shared contract. Node, Web
and mobile type checks pass. CLI and desktop builds pass. The real desktop startup
test passes with no Host flag or paired device. Cloud's real PostgreSQL integration
with the production Host and a mock Cell passes. Cell contract tests: 17 passed.

This change does not deploy a Runtime Web site or complete P4's account client.
Public production deployment and long-duration load testing are not claimed.
