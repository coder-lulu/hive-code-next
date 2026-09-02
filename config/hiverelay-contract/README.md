# HiveRelay v2 P0 authority contract

Contract revision: `hiverelay-v2-p0.1`

This directory is the sole authority copied by HiveCode and HiveRelay Cell. A consumer
must verify `fixture-manifest.json`, every listed file digest, the revision, and its source
commit before running fixtures. Extra or missing vendored files fail verification.

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
   userinfo, query, fragment, or non-root path. The canonical form omits port 443 and the
   trailing slash.
6. Identifier and reason values are opaque and must never be emitted as metric labels.
7. A verdict reason is one symbol from the fixture/registry; free-text parser details are
   diagnostic only and must not cross the component boundary.
8. A component omitted from a fixture's `applicableComponents` still emits one result for
   that case: `NOT_APPLICABLE` with reason `COMPONENT_NOT_APPLICABLE`.

## Cryptographic fixtures

Keys and tokens in `fixtures/` are public test material and must never be configured in a
deployed environment. The test signer is distinct from Hive Session and Runtime identity
signers. Validators implement only the exact Ed25519 compact-JWS profile in this contract.

## Change rule

Once another phase consumes this revision, do not rewrite it. Create a new revision,
regenerate all digests, update each consumer receipt, and rerun all three validators.
