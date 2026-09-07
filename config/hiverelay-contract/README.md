# HiveRelay v2 authority contract

Contract revision: `hiverelay-v2-p0.9`

This directory is the sole authority copied by HiveCode and HiveRelay Cell. A consumer
must verify `fixture-manifest.json`, every listed file digest, the revision, and its source
commit before running fixtures. Extra or missing vendored files fail verification.

The product has one current Relay implementation. Runtime Host starts automatically after
account binding and authority readiness. Cloud selects placement when requestedRegion is
omitted; an explicit override must be a valid nonempty region. Signed authority, mTLS,
revocation, rate limits and capacity checks remain mandatory. No old product path or
version feature switch is retained; protocol IDs continue to bind the current wire contract.

The Relay heartbeat keeps two independent acknowledgements: a boolean
`controlConnectionAcknowledged` for the Cell control handshake and a structured
`controlCommandAck` for one contiguous Cloud-to-Runtime command. Session-transition
sequence acknowledgement is separate from both. Replaying a durable lifecycle operator
operation may perform a fresh private delivery; the authority result remains stable while
the new delivery can safely return `STALE_NOOP`. A 503 after an operator lifecycle call
may therefore follow a committed authority transition; clients must retry the byte-for-byte
equivalent request with the same `operationId`, never mint a replacement operation.

`sessionAuthorityUntil` is null unless the reported assignment and current Cell control
connection are authoritative. `nextControlSequence` is the first sequence neither
acknowledged nor included in the response's contiguous `controlCommands` prefix. A
duplicate heartbeat returns a current bounded command snapshot; it must preserve stored
transition adjudications and both server cursors, but it is not an immutable replay of a
previous command-delivery snapshot.

Heartbeat failures keep the legacy five-field `HiveHttpProblem` and
`application/problem+json` media type unless the request can be strictly parsed far
enough to observe the explicit `runtime-session-control-v1` capability. A declaring
Runtime receives only the closed one-field `{ "code": "..." }` symbolic response with
`application/json`. Invalid JSON, duplicate keys, and other input from which that
capability cannot be reliably identified stay on the legacy Problem contract. The route
publishes only 400, 401, 409, 410, 422, 426, and 503 failures; 503 includes a bounded
`Retry-After` value.

The contract is split into four small surfaces:

- `openapi/` freezes Cloud and private Cell HTTP shapes plus the three public WSS paths.
- `schemas/` freezes strict JSON structures. Unknown and duplicate object keys are
  rejected before semantic validation.
- `registries/` freezes values that code must not invent: credentials, limits, state
  transitions and close codes. The historical flags registry is empty.
- `fixtures/` supplies language-neutral ACCEPT/REJECT cases for the current stack.

## Parsing rules

1. Input is valid UTF-8 JSON with no BOM, comments, trailing commas, duplicate keys,
   non-finite numbers, or numbers outside the exact schema range.
2. Every object is closed unless a schema explicitly says otherwise. Unknown fields are
   rejected.
3. Base64url is RFC 4648 URL alphabet without padding and must round-trip to identical
   text. Standard base64 is used only where a schema explicitly names it.
4. JWS NumericDate values are integer epoch seconds. Wire timestamps ending in `At` are
   integer epoch milliseconds. Validators use each fixture's frozen `validationTime`.
5. An origin is lowercase `https`, an ASCII DNS host, optional non-default port, and no
   userinfo, query, fragment, IPv6 literal, or path (including `/`). Each DNS label is
   1..63 characters, starts and ends with `[a-z0-9]`, and otherwise contains only
   `[a-z0-9-]`; the full host is at most 253 characters. A supplied port is `1..65535`
   and must not be `443`. JSON Schema checks only the wire shape; validators perform
   these per-label, numeric-port, and canonical-form checks before allowlist comparison.
6. Identifier and reason values are opaque and must never be emitted as metric labels.
7. A verdict reason is one symbol from the fixture/registry; free-text parser details are
   diagnostic only and must not cross the component boundary.
8. A component omitted from a fixture's `applicableComponents` still emits one result for
   that case: `NOT_APPLICABLE` with reason `COMPONENT_NOT_APPLICABLE`.

## Cryptographic fixtures

Keys and tokens in `fixtures/` are public test material and must never be configured in a
deployed environment. The test signer is distinct from Hive Session and Runtime identity
signers. Validators implement only the exact Ed25519 compact-JWS profile in this contract.
JWS `kid`, `iss`, and private Cell origin values are deployment bindings, not constants
in the normative token schema. Fixtures supply them through `input.verifierContext`.
Key lookup also enforces registry purpose: Relay compact JWS accepts only
`cloud-relay-ed25519`; a Runtime-proof key remains invalid even if its `kid` is placed in
the caller's accepted-key set.

Runtime proof is not a bearer credential. It is the closed `runtimeProof` object inside
the JSON request body and follows `schemas/runtime-proof.schema.json` plus the exact
projection, digest, signature-input, freshness, and nonce-digest rules in
`canonical-encoding.md`. A runtime-proof fixture marked with any other carrier must be
rejected before cryptographic verification.

Managed-session transitions use the request and response definitions in
`schemas/session-transition.schema.json`. Only stored adjudications cover a contiguous
ACK; a gap or replay conflict and every later entry in that batch remain unstored.

Private status verification is one atomic operation: the `cellOpsToken` must arrive in
the private HTTPS Authorization header, its method/path/private origin/Cell binding must
match the request, and the request header nonce, token nonce, and response nonce must be
identical. A previously consumed token `jti` or nonce is rejected before status data is
trusted. The response `observedAt` must be within 30 seconds of validation time.

Private command replay returns the structurally identical stored response when command
ID and canonical body digest both match. It never substitutes a new wire-level replay
marker. A lower lifecycle generation produces a stored `STALE_NOOP` response and cannot
roll Cell state backward.

Each component report emits one result for every manifest fixture. `resultCount` equals
the result array length, while `applicableFixtureCount` equals the number of fixtures
that name that component. A passing report sets `testCount` to the number of applicable
fixture evaluations it actually executed, so it must equal `applicableFixtureCount`.
Cell evidence additionally records the
externally supplied immutable container image plus the observed Elixir and OTP versions;
the report generator must not invent or default the image identity.

## Credential deadlines and lifecycle snapshots

For compact JWS credentials, `lifetimeSeconds` is an upper bound: require
`0 < exp - iat <= lifetimeSeconds` and `nbf == iat`. A control lease may be
shortened by the remaining Runtime heartbeat authority (for example, 90 seconds
with a 120-second maximum). Cloud must cap `exp` at the upstream authority
deadline; admission expiry is also capped at its ticket and current assignment.
The Cell trusts only the verified Cloud signature for `controlGeneration`; it
must not invent or independently increment this generation on reconnect.

The 30-second issue-time allowance never extends `exp`: reject when `now >= exp`,
including exact equality. This profile uses no optional expiration leeway from
[RFC 7519 section 4.1.4](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.4).
At acceptance, derive a monotonic deadline once from the signed remaining time;
never restart the full registry TTL after an event or a wall-clock correction.
For control authority, subtract the configured maximum clock error from signed
remaining wall time and also cap the local budget at 120 seconds. An empty
budget rejects admission. A deployment whose clock error exceeds that bound
must close authority and recover clock health before accepting a new lease.
This conservative enforcement keeps a slow Cell clock from extending Cloud's
upstream deadline; scheduling and network delay do not grant additional time.

Fleet operators read `GET /hive/v1/relay-cells/{cellId}/lifecycle` before each new
lifecycle action because status observation can advance `resourceVersion`.
The same genuine mTLS certificate and `relay:fleet:lifecycle` scope protect GET
and POST. GET carries no body, query, Origin, Authorization, or Cookie and returns
only `schemas/lifecycle-snapshot.schema.json`. Unknown Cells return 409
`STALE_BINDING`; storage unavailability returns 503 `RELAY_UNAVAILABLE`.
An exact operation retry retains its original operation ID and body. A new
operation after a version conflict reads a new snapshot before attempting CAS.

## Change rule

Once another phase consumes this revision, do not rewrite it. Create a new revision,
regenerate all digests, update each consumer receipt, and rerun all three validators.

## P0.6 acknowledged control refresh

POST `/hive/v1/runtimes/{runtimeRecordId}/relay/control-leases/refresh` uses
`control-lease-refresh.schema.json` and returns the existing AssignmentResponse.
Only the current ACTIVE, acknowledged assignment may renew in place. A refresh
preserves assignment epoch and control generation; a reconnect continues to use
`/v1/assign` and receives a higher generation. The expiry is a compare-and-set
value: matching expiry permits one extension, an older expiry returns the current
committed lease without extending it, and a newer expiry rejects. Every HTTP
retry uses a fresh one-use Runtime proof. The Cell requires its existing owner
socket for auth-refresh, so a second control socket cannot reuse its generation.

A new Runtime boot may retain the latest X25519 Host key after BOOT_ROTATED or
LEASE_ROTATED fencing with the exact binding version. This creates a successor
binding, never resurrects the terminal row. A key rotated away to another key or
a binding revoked for account, device, ownership or credential reasons cannot be
restored by this exception.

Authorization use is frozen atomically to its first assignment and control generation. Exact retries retain that reservation, including after signing failure. Once another authorization takes over, the old used JTI cannot acquire control again. At the P0.6 migration boundary, preexisting authorizations without provable assignment usage are retired and require fresh authorization; current recorded assignment usage is preserved. No public credential fields change.

## P0.9 managed Cell recovery and deployment proof

REJOIN is a Cloud-only operator CAS action under relay:fleet:lifecycle. It permits
only DRAINING to UNHEALTHY for a currently configured routing-enabled Cell, clears
routing confirmation, increments both versions and emits no private delivery.
RETIRED and removed/disabled configured Cells cannot rejoin. PREPARE and CONFIRM
retain their existing evidence and exact-replay requirements. REJOIN is not a new
Cell private command, token scope or frame type.

POST /hive/v1/relay-cells/{cellId}/deployment-evidence uses a separately pinned
release-tool mTLS principal with relay:fleet:evidence; lifecycle scope alone does
not grant evidence submission. The short-lived Docker attestation binds parent
operation ID, actual container/image/start time, incarnation and lifecycle generation,
public/private origins and the live WSS x-hive-cell-incarnation response header.
Missing, expired, replaced-instance or mismatched public-route proof blocks CONFIRM.
The public header is an instance identifier, never authorization. WSS frame and
signed credential protocols are unchanged.
