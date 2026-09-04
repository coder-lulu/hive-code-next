# Canonical encodings

All text is UTF-8 without normalization at validation time. Identifiers are ASCII by
schema. Integers are unsigned big-endian. Lengths are unsigned 32-bit big-endian byte
counts.

## `relayHostId`

1. Decode `hostPublicKeyB64` as canonical unpadded base64url to exactly 32 bytes.
2. Reject a low-order X25519 public key.
3. Compute SHA-256 over the raw 32 bytes.
4. Encode the digest as unpadded base64url and take its first 16 ASCII characters.

The result is a routing hint only.

## Host possession transcript

Concatenate fields in this exact order. Each field is encoded as
`u32(nameLength) || name || u32(valueLength) || value`:

```text
protocol = "hive-relay-host-proof/v2"
version = 0x02
cellOrigin
cellId
cellIncarnationId
relayEphemeralPublicKey = 32 raw bytes
challengeNonce = 24 raw bytes
challengeId
issuedAt = u64 epoch milliseconds
expiresAt = u64 epoch milliseconds
runtimeId
runtimeBootId
authorityGeneration = u64
fencingEpoch = u64
leaseEpoch = u64
assignmentId
assignmentEpoch = u64
controlGeneration = u64
relayHostId
hostPublicKey = 32 raw bytes
```

The challenge plaintext is
`"hive-relay-host-challenge/v2\0" || u32(transcriptLength) || transcript || secret`,
where `secret` is 32 random bytes. The ACK proof is
`HMAC-SHA-256(secret, "hive-relay-host-proof/v2\0ack\0" || transcript)` and is encoded as
unpadded base64url. Existing v1 domains and bytes are not modified.

## Session binding hash

Compute SHA-256 over fields encoded with the same length-prefixed field representation in
this exact order:

```text
domain = "hive-relay-session-binding/v2"
intentId
ticketId
cellId
cellIncarnationId
connId
assignmentId
assignmentEpoch = u64
controlGeneration = u64
clientPublicKey = 32 raw bytes
runtimePublicKey = 32 raw bytes
e2eeTranscriptHash = 32 raw bytes
```

The 32-byte digest is represented as unpadded base64url in JSON. A consume replay must
compare both the canonical request bytes and this digest.

## Canonical command and transition body

For idempotency, serialize the schema-declared fields in the order shown by the schema,
with UTF-8 string bytes and big-endian integer bytes using the length-prefixed field
representation above. Optional fields are represented by an empty byte value in their
declared position. SHA-256 of those bytes is the replay body digest.

## Runtime Cloud request proof

`runtimeProof` has exactly one carrier: the `runtimeProof` member of the JSON request
body. It is never accepted from `Authorization`, another header, a query parameter, or a
second body member. To form the protected payload, remove that one top-level member and
serialize the remaining JSON value with RFC 8785 JSON Canonicalization Scheme (JCS).
`bodySha256` is lowercase hexadecimal SHA-256 of those UTF-8 JCS bytes.

The proof fields `runtimeId`, `runtimeBootId`, `authorityGeneration`, `fencingEpoch`, and
`leaseEpoch` must equal the current Runtime tuple resolved by Cloud. When any of those
fields is also present in the protected payload it must be equal after JSON decoding.
`method` and `path` are the actual uppercase HTTP method and exact path (including
resolved path identifiers, without query). `authorityId` is the Cloud authority selected
by deployment configuration.

Sign UTF-8 bytes of the following newline-delimited values in this exact order, without
a trailing newline, using the Runtime identity Ed25519 private key:

```text
hive-relay-runtime-proof/v2
Ed25519
method
path
authorityId
runtimeId
runtimeBootId
authorityGeneration (base-10 ASCII)
fencingEpoch (base-10 ASCII)
leaseEpoch (base-10 ASCII)
issuedAt (base-10 epoch milliseconds ASCII)
nonce (canonical lowercase UUIDv4)
bodySha256
```

The signature is canonical unpadded base64url of exactly 64 bytes. Verification requires
`issuedAt <= validationTime + 30,000 ms` and
`validationTime <= issuedAt + 60,000 ms + 30,000 ms`, both inclusively. This preserves
the full 60 s lifetime while allowing exactly 30 s of comparison skew.

For one-use replay storage compute lowercase hexadecimal SHA-256 over UTF-8 bytes of
`"hive-relay-runtime-proof-nonce/v2\n" || runtimeId || "\n" || nonce`. The nonce is
committed atomically only after all structural, binding, freshness, digest, and signature
checks succeed, and the digest is retained through proof expiry plus skew.

## Canonical HTTPS origin semantics

After the schema shape check, split the authority into DNS host and optional decimal
port. Reject empty labels, uppercase, non-ASCII, underscores, labels longer than 63,
leading or trailing hyphens, hosts longer than 253, IPv4/IPv6 literals, port zero, ports
above 65535, and explicit port 443. Compare the reconstructed canonical origin exactly
against the allowlist; do not rely on URL-parser normalization.
