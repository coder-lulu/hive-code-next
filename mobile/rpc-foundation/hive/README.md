# Hive RPC recording overlay

`../pilot-scenarios.json` and `../goldens/` are the frozen upstream scenario and recording
references. Hive keeps product-specific trace differences in `goldens/`; all other supported
recordings use the upstream trace directly. `reviewed-deltas.json` pins the upstream corpus digest,
both trace hashes, and a reason for every product difference. `manifest.json` pins the source
commit, recorder, adapters, upstream corpus, and sparse overlay files.

Review a changed upstream corpus before updating either digest. Compare the supported upstream
traces with the previous corpus, then verify each existing Hive delta and any newly differing
recording against the product boundary. Commit mobile product sources, shared protocol, recorder,
and mobile lockfile changes before recording. From the repository root, use a full source commit SHA
and the frozen upstream SHA to record the complete supported corpus into evidence:

```powershell
$sourceCommit = git rev-parse HEAD
$upstreamCommit = 'a781a602a8729439d7a3eebf0c3b9e5817362e77'
$env:ORCA_BACKGROUND_LAUNCH = '1'
$env:RPC_FOUNDATION_RECORD = '1'
pnpm --dir mobile exec tsx scripts/rpc-recording.mts --record-hive $sourceCommit $upstreamCommit --evidence-only
```

The recorder checks source identity before and after the run. It writes `provenance.json` and
`goldens/` into `logs/upstream-sync/hive-rpc-recording/<sourceSHA>/` at the repository root, without
changing the Hive manifest or overlays. Optional golden IDs after the two SHAs select a targeted
diagnostic run; targeted recordings never publish.

Review every measured trace difference against the immutable upstream originals, then update
`reviewed-deltas.json` with the current upstream aggregate hash, exact before/after trace hashes,
and a concrete product reason for each difference. This review data is publication input; the
recording sources must continue to match the frozen source commit. Publish the reviewed complete
evidence using the same two SHAs:

```powershell
pnpm --dir mobile exec tsx scripts/rpc-recording.mts --publish-hive $sourceCommit $upstreamCommit
```

Publication verifies the recorded provenance and complete supported domain, rejects changed
scenario contracts, missing adapter provenance, unreviewed trace differences, and disappeared
reviewed deltas, then writes the v2 manifest and sparse overlays. Every upstream original remains
unchanged. Run the golden/domain/bridge replay suites against the published references before
committing the generated metadata separately. Do not copy diagnostic recordings into this
directory manually.
