# HiveRelay v2 authority contract

Contract revision: `hiverelay-v2-p0.3`

This directory is the sole authority copied by HiveCode and HiveRelay Cell. A consumer
must verify `fixture-manifest.json`, every listed file digest, the revision, and its source
commit before running fixtures. Extra or missing vendored files fail verification.

Route registration and capability advertisement remain independently gated and default
off. Legacy Orca bytes and the heartbeat response returned to a Runtime that does not
declare `runtime-session-control-v1` remain unchanged.

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

The contract is split into four small surfaces:

- `openapi/` freezes Cloud and private Cell HTTP shapes plus the three public WSS paths.
- `schemas/` freezes strict JSON structures. Unknown and duplicate object keys are
  rejected before semantic validation.
- `registries/` freezes values that code must not invent: credentials, limits, state
  transitions, close codes, and disabled flags.
- `fixtures/` supplies language-neutral ACCEPT/REJECT cases. Legacy cases apply to Cloud,
  HiveCode, and `legacy-orca`, while the v2-only Cell reports `NOT_APPLICABLE` for them.

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

## Change rule

Once another phase consumes this revision, do not rewrite it. Create a new revision,
regenerate all digests, update each consumer receipt, and rerun all three validators.
