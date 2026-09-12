# Upstream review and incremental checkpoints

HiveCode absorbs upstream BUG, security, stability, and data-consistency fixes.
It also absorbs new functionality that is not already provided by HiveCode.
Overlapping functionality must preserve HiveCode branding, capabilities, and
wire/persistence contracts. An equivalent implementation needs concrete review
evidence; an unexplained skip is not an accepted outcome.

## One historical review, then increments

After the September 2026 maintenance merge, the maintainer requested that only
`hivecode/main-next` remain as a product repository branch. Remove the temporary
`vendor-integration` ref only after its exact candidate is included in that
branch and verified remotely. Preserve review checkpoints and evidence.
The existing sync preflight deliberately fails when vendor is absent; a future
maintainer-authorized sync must recreate its temporary integration ref from the
reviewed product tip, never from upstream, before invoking the protected flow.
Do not re-enable disabled Actions or change release publication settings as part
of branch cleanup.

`config/upstream-sync-state.json` starts with `initialAuditCompleted: false`.
No previous fetch, vendor merge, or old report is automatically treated as a
completed historical review. The first run accounts for the entire reachable
upstream history and includes a fork-delta report for the product adaptations.
Git ancestry and nonempty patch IDs prove inclusion, not that subsequent product
changes preserved behavior; the reviewer must assess those adaptations.

For each module split, follow the active import/export entry point and compare
its product behavior with the extracted modules. A clean merge of helper files
can leave an older monolith active and silently bypass upstream fixes. Review
the facade, modules, public exports, and existing contract tests together using
`moduleSplitTargets` in the boundary manifest. Move retained product behavior
into the active modules and verify callers through the facade. Apply this check
to newly introduced splits as well as the maintained list.

After the reviewed vendor PR is merged into the product target, later runs use
that target's `lastReviewedUpstreamSha` as their exclusive lower bound and the
newly fetched immutable upstream SHA as their inclusive upper bound. They also
revisit `pendingShas`, so a deferred boundary feature is never forgotten merely
because the cursor advanced. Ordinary features and required fixes cannot be
silently classified as optional product decisions.

The workflow reads state from the original, frozen **product target**, even if
the vendor branch contains a newer proposed checkpoint. It writes the next
checkpoint into the candidate before publication, then tests that final
candidate SHA. The checkpoint is only a proposal until all gates pass and the
reviewed PR is merged into the product branch.

| Event                                                                  | Effective review position                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Fetch, clean merge, or candidate publication                           | Unchanged                                                |
| Intake failure, merge conflict, failed gate, or rejected/unmerged PR   | Unchanged; retry the same interval and pending decisions |
| Fully verified and reviewed vendor PR merged into the product target   | Advances to that candidate's frozen upstream SHA         |
| Malformed state, missing pending commit, or rewritten upstream history | Stop for explicit investigation; do not move the cursor  |

## Evidence and decisions

Every commit in the interval and carried-over pending set receives an inclusion
result and review classification. Unabsorbed required fixes, missing parent
dependencies, invalid/empty patch evidence, and unexplained omissions fail the
intake command. A matching commit subject is never sufficient evidence.

Keep explicit boundary feature deferrals in the ledger with the reason and
product adaptation decision, and keep their SHAs pending. Demonstrated duplicate
features may be recorded as equivalent. Existing legacy ledger notes remain
available, but unsupported claims do not automatically close a new audit.

Preserve the skill-sharing reference-only boundary, product endpoints, updater
authority, branding, compatibility aliases, and maintained UI capabilities. The
protected workflow still merges the product target into vendor first, then
upstream; conflicts are recorded and the merge is aborted for deliberate review.

Freeze upstream, target, vendor lease base, and final candidate SHAs. Publish only
the vendor candidate with its original lease. Evidence jobs use the frozen
upstream and candidate, upload their own intake/priority/fork-delta reports, and
the PR links that evidence with boundary decisions, pending items, platform
coverage, and limitations. A round with an unchanged product tree and checkpoint
skips publication and repeated gates. Before publishing a changed candidate,
return an existing ready PR to draft; failed validation leaves it there. Refresh
its evidence and restore ready status only after all checks succeed. Re-check
remote target and vendor tips before proposing the PR.

## Verification without repeated full platform suites

Run the common product/security/generated-file/lockfile checks and one broad
unit/build verification job. Run mobile typecheck, lint, and tests once in that
job after its frozen, script-free dependency installation.

`config/upstream-regression-matrix.json` selects the existing focused PTY/WSL/SSH
contracts for Linux, macOS, and Windows, plus CLI typecheck on Windows. The
executable matrix replaces the unused requirement to repeat the entire main and
shared test trees on all three OSes. `run-upstream-sync-gates.mjs --suite=all`
runs common checks and the current OS's matrix once; `--suite=regression` runs
only that OS's matrix. `--list --platform=win32|darwin|linux` inspects another OS's
selection but cannot claim to execute its platform coverage locally.

Add a focused regression when a concrete logic, security, or performance failure
is found. Real-device behavior and platform jobs that were not executed remain
explicitly unverified; passing static checks does not replace them.
