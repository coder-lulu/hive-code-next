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
