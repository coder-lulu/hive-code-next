# Hive RPC recording overlay

The reference `goldens/` corpus follows verified three-way ownership: unchanged upstream
paths retain the product reference, upstream-only changes follow upstream, and conflicts
require exact frozen review rows. Recording never rewrites this reference corpus. Product differences are sparse overlays,
reviewed using exact before/after trace hashes and concrete reasons in `reviewed-deltas.json`.
New recordings use manifest v3. Historical v2 evidence is read-only.

Publish maintenance controls M first. Then calculate the canonical guarded Git-tree projection
of the complete reviewed incoming source. The source input JSON has exactly `source`, `projection` and
`controlProjection`; use `recordingProjection` and `exportRecordingSources` from
`config/scripts/upstream-recording-source.mjs` to produce source evidence from Git object bytes.
Derive `controlProjection` with `recordingControlProjection(repository, M)` and export the
transitive config ESM module closure with `exportRecordingControls`. Its raw bytes and modes
are independently checked against M Git objects before and after recording; copying modules
without this check does not prove their provenance. The fixture must have access to M Git objects.
A trusted external M helper must perform both fixture checks around the recording process,
so a modified fixture cannot authorize itself by changing its own validator. Use
`assertRecordingControls(fixture, M, controlProjection, objectRepository)` with the main
repository as `objectRepository` when M objects are not in the fixture; the supplied projection
is always compared with independently read M objects, never accepted on its own hash.
The `source` fields are `kind: tree-sync-content`, `controlSha: M`, `upstreamSha: U`,
`guardVersion: 1`, `guardedSourcesSha256`, and `guardedFileCount`.

Export into an isolated directory under repository `logs/`, preserve exact modes and raw bytes,
and supply its independent dependencies. Guarded source symlinks are refused on every platform. A Windows runner refuses executable
exports whose mode it cannot reproduce; use a POSIX runner for executable sources. Source inputs belong
outside the guarded paths. The recorder verifies all guarded paths and bytes before and after
running. LF/CRLF working checkouts are not raw recording fixtures.

From that raw fixture root, record the complete supported domain:

```text
RPC_FOUNDATION_RECORD=1 pnpm --dir mobile rpc:record --record-hive <source-input.json> <logs-output-directory> --evidence-only
```

Optional golden IDs produce diagnostic evidence only. Review every changed trace independently
and write `hive/reviewed-deltas.json` below that output directory. Then generate reviewed v3
manifest and overlays in the same explicit logs output:

```text
RPC_FOUNDATION_RECORD=1 pnpm --dir mobile rpc:record --publish-hive <source-input.json> <logs-output-directory>
```

The writer checks current recorder/scenario/adapter digests, the complete derived domain,
scenario contracts, unreviewed differences and disappeared deltas. It never creates ordinary
commit-source recordings or writes generated evidence directly into the source checkout.
Freeze reviewed result blobs in review target R. The existing tree synchronizer produces F
with parent R, followed only by checkpoint changes. The trusted source verifier independently
recomputes that whole merge and checks F against the manifest projection, M control closure,
upstream corpus and reviewed overlay bytes. Any guarded source repair requires re-recording.
Common, Linux, macOS, Windows and the isolated publisher must all verify the same candidate.
