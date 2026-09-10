# HA-P4 implementation

## 2026-09-10: catalog boundary and explicit model selection

Status: IN_PROGRESS. This checkpoint implements part of W01/W04, not a desktop
release or completion of either work package. No product entry point uses the new
client yet; production Pi Pack, adapter, proxy and internal-content activation
remain pending. The already verified P3 profile is synthetic-only.

Added:

- `src/shared/hive-ai-model-catalog.ts`: strict P3 catalog projection, bounded IDs,
  revisions, model count and limits; rejects unknown fields and duplicate model IDs.
  Explicit selection never substitutes the first model or falls back when missing.
  PENDING/RUNNING/UNKNOWN prohibit selection; stale catalog/model revisions and
  incompatible profiles/capabilities fail closed. This is a pure projection, not a
  new session store or authorization authority.
- `src/main/hive-runtime-cloud/hive-ai-catalog-client.ts`: main-process catalog POST
  with an AI-domain Ed25519 proof over the exact request body and current Runtime
  tuple. Reuses the existing bounded HTTP client (10 seconds, 64 KiB response,
  redirect denied, no automatic retry). Accepts only HTTPS authority origins,
  never provider route/key fields. Unknown server error strings are discarded.
  Account/lease context must be supplied by the existing trusted host, not Renderer.
- Corresponding tests cover signature verification, nonce freshness, malformed/
  credential-bearing catalogs, exact selection, unavailable models, revision and
  generation fences, cancellation, transport failure and error redaction.

The P3 catalog has no protocol field: server-side Pack protocol filtering remains
authoritative; the local projection checks explicit active profiles and text-only
capability. This does not establish real-content eligibility. The inherited 64 KiB
transport limit deliberately rejects larger catalogs; paging or a bounded larger
AI response limit must be addressed before supporting a catalog beyond this size.

Verification (Node 24.18.0, existing dependencies):

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
pnpm exec vitest run --config config/vitest.config.ts src/shared/hive-ai-model-catalog.test.ts src/main/hive-runtime-cloud/hive-ai-catalog-client.test.ts src/main/hive-runtime-cloud/hive-runtime-cloud-http-client.test.ts config/scripts/managed-pi-p0.test.ts src/main/native-chat/hive-agent-session-host.test.ts
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json
pnpm exec oxlint src/shared/hive-ai-model-catalog.ts src/shared/hive-ai-model-catalog.test.ts src/main/hive-runtime-cloud/hive-ai-catalog-client.ts src/main/hive-runtime-cloud/hive-ai-catalog-client.test.ts
```

Results: 76 tests passed across five files; Node typecheck and scoped lint passed.
P0 actual Pi completion/cancellation children used Node 24.18.0, empty tools, zero
observed network attempts/external reads. This remains a coexistence smoke, not an
OS sandbox or production Pack claim. No live model calls, public deployments,
dependency changes, UI changes, commits or pushes were performed.

Next: bind explicit selected model/revision to the existing P2 durable generation
and mutation admission, then connect the supervised Pi runner and inference proxy.
Do not install the adapter/default UI until prerequisite release gates are met.
No parallel journal, inference ledger or model-preference store was introduced.
