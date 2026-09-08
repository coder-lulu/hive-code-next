# Upstream synchronization: 2026-09-08

Status: all original conflicts resolved; candidate published to vendor-integration; product promotion remains on HOLD pending independent review and incomplete validation. Early Pending entries below describe historical checkpoints, not current approval.

## Functional review follow-up

- Reviewed candidate: `a5326f3be760d9ba004f96cdbbc5e24fd44668d6`; remote product remains `7fa4dd4d4b95ec2286f5431d2307448b6cd989d7`.
- Fresh Hive account, Runtime Cloud, Relay, login discovery, and project-owner routing regression: 50 files / 399 tests passed.
- Corrected upstream test adaptation omissions: HiveCode preview messages, accepted Hive CLI names, current Japanese generic-agent terminology, and platform-specific Windows recovery-command quoting. Runtime behavior and request-identity assertions were retained.
- Expanded orchestration, recovery-command, translation-policy, and document-preview regression after corrections: 33 files / 299 tests passed. React act-environment warnings remain in preview tests.
- Evidence: `E:/projects/hive-platform/upstream-review-hive-features.log`, `upstream-review-followup-failures.log`, and `upstream-review-adaptation-tests.log`.
- This bounded verification does not close the root full-suite, macOS/Linux, or live cross-Cell validation gaps. Native role routing remains unavailable, so there is no independent code-reviewer APPROVE / architect CLEAR. Do not treat this authoring-lane evidence as merge approval.
- GitHub Actions was confirmed disabled. No workflow was dispatched and no product promotion was performed.

- Upstream: `12f53da542d03473367e48a63b85a49eae7c5f8b`
- Product: `7fa4dd4d4b95ec2286f5431d2307448b6cd989d7`
- Vendor lease base: `69f36c2581e9dc24c0551a32baea0d8a83e235c9`
- Effective checkpoint: `0bbf86bb7a070c2b56025bba59251b3f34080e42`
- Isolation branch: `sync/orca-20260908`
- Initial conflict paths: 178.
- GitHub Actions remains disabled by user instruction. Validation runs locally.
- The user explicitly authorized deliberate conflict resolution, vendor publication,
  review, and product promotion after successful review.

## Decisions

| Path | Decision | Verification |
| --- | --- | --- |
| `src/shared/secure-file.test.ts` | Keep HiveCode durable Windows fsync regression and upstream unreadable-error/ACL regressions. | Pending secure-file suite. |
| `src/main/orca-profiles/profile-cloud-session-store.ts` | Preserve HiveCode branding; absorb unreadable-session handling so transient access errors do not masquerade as absent credentials. | Pending session-store suite. |
| `src/main/runtime/orca-runtime-serialize-main-terminal-buffer.ts` | Use upstream provider/renderer restored-snapshot fallback, preserving HiveCode prohibition on displaying incomplete headless history and its post-await ownership check. | Pending restored-history suites. |
| `src/main/runtime/orca-runtime-serialize-terminal-buffer-from-available-state.ts` | Apply the same no-partial-history invariant to the shared serialization facade, including an ownership recheck after awaiting headless serialization. | Pending restored-history suites. |

## Additional reviewed resolutions

- CLI child PATH uses the extracted upstream helper while advertising `hive`;
  the platform seam chooses the target platform's PATH delimiter. Secure-file,
  profile session-store and CLI child-path suites: 49 passed, 2 skipped.
- Runtime serialization keeps the no-partial-restored-history guards. Structured
  worker receipts, federation, mutation classification and mailbox helpers follow
  the upstream splits, preserving the canonical Hive CLI command.
- Terminal close/shutdown adopts copy-on-write map cleanup while preserving Hive
  unread completion counts and sleeping terminal identities. Shutdown: 6 passed.
- Activity counting preserves Hive sidebar badge modes and adopts live-state
  freshness. Activity, browser notice, terminal link hint and tab identity suites:
  51 passed. Successful in-app popup navigation no longer emits a warning notice.
- Locale JSON was merged by individual keys, retaining independent changes and
  explicitly resolving shared branding keys; generated branding still needs audit.
- Runtime startup retains the existing Hive cloud RPC installation and presence
  readiness paths. Its existing extracted installer already implements upstream
  E2E port validation. Orchestration now supplies the pairing revision through
  the existing cloud-aware transport instead of bypassing account routing.
- SSH deadline parsing follows the upstream extraction. CLI error/pairing parsing
  likewise follows extracted modules with Hive branding migrated into them.
  CLI formatting and SSH host passthrough: 71 passed.
- Terminal-send command help includes submission observation and durable retry;
  worker help includes structured launches and paginated remote worker listing.
  Deleted root-help modules remain deleted; their changed documentation was
  ported into Hive's active help source.
- GitHub project views adopt roadmap support and its allowlist; support links
  and product identity remain Hive-owned.
- Agent launch uses upstream unknown-capabilities behavior without replacing
  Hive's resolved execution host. Header dragging keeps Hive repo types and
  upstream pointer-release/click-swallow helpers.
- Windows daemon relocation keeps the signed executable's original basename.
  Uninstall handles both the current app name and the prior Hive daemon name,
  scopes by user, and skips image-name termination when user identity is absent.
  Hive hardware signing remains authoritative; the upstream SignPath hook is
  not wired into the product packager. Daemon relocation and markdown installer
  checks: 31 passed, 1 skipped; no installer was built or executed.
- Hive landing and sidebar creation placement stay product-owned. The upstream
  global create dropdown overlaps Hive's project-scoped creation controls;
  retain compact filter badges and project scope, while absorbing translated
  default sidebar headings. Upstream tests for the absent global dropdown were
  removed from this product-specific suite; existing Hive behavior tests remain.
- Link-action popup and browser search suites passed (21 tests combined);
  sidebar rerun passed (11 tests) and mobile IPC passed in the subsequent runtime
  group. The cleanly moved send-control-mail module needed its brand import
  adjusted for the extra directory depth.
- Mobile questions adopt index-based option identity and optional descriptions,
  using Hive semantic tokens and Chinese submission labels. Shell activity icons
  inspect the tool call input instead of its ambiguous name. Terminal theme
  injection respects the host's published contrast floor and keeps Hive CSS
  variables and mode-aware fallback. Question/theme suites: 31 passed.
- The removed inject-rejection and worker-observation facades remain removed;
  their Hive branding and regression assertions moved to the active shared
  refusal contract and worker module. Refusal, worker observation, and PR E2E
  contract suites: 53 passed. The PR contract now understands Hive's early
  routing/directory guards and hyphenated job IDs; no workflow was executed.
- Preamble snapshots preserve Hive commands and absorb single-line shell recipes
  and follow-up checks. Preamble: 27 passed, 2 Windows bash-only checks skipped.
- Retired adhoc/hourly/dev-channel workflows remain retirement stubs. Android
  publication stays on HiveCloud; Windows upload retains the Hive artifact name
  and adopts zero compression. Cloud runner selection remains product-owned.
  PR path classification adopts streamed stdin and retains the CRLF regression.
- Readme translations keep Hive compatibility explanations and do not restore
  upstream app downloads/community marketing. The obsolete download SVG remains
  deleted. Windows documentation and crash-test comments reflect verbatim daemon
  image relocation; the corrected relative source link is retained.

Early focused tests above reused the primary checkout's root/mobile dependency
directories via isolated-worktree junctions; both were subsequently removed and replaced by frozen isolated installations. Mobile's initial test-created Vite
cache is preserved at `mobile/.upstream-test-dependency-cache` and must not be
committed. Root and mobile frozen, script-free installations and both typechecks subsequently passed; full gate limitations are recorded below. Initial mobile IPC testing was blocked by
then-unresolved preamble syntax; it is not counted as a pass.

## Pending validation and publication

### Removed legacy relay review

The old DesktopRelayService, regional probe modules, mobile endpoint supervisor,
MobileRelayRpcStreams, CloudRelayTransport and pairing-mode UI stay deleted,
including newly introduced tests that only address those retired modules.

- Region warmup/minimum sampling, one-hour no-hint caching and assigned-cell
  self-heal target Orca's fixed region catalog and director. Hive's active
  `HiveRuntimeRelayAuthorizationProvider` sends the configured requested region
  to HiveCloud and uses the signed assignment. The old region selector is not
  part of that flow; do not add its director endpoints or region enum.
- Pending-connection replay and accepting late conn-open while draining depend
  on Orca hello-ack pendingConns, invite/resume device binding and retained
  origins. Hive's v2 ack has only generation/expiry, and its ticket conn-open
  pins assignmentEpoch/controlGeneration. Cell INCARNATION_DRAIN stops new
  admission and shortens owner deadlines; it does not use that origin rotation
  protocol. Evidence: active Hive host protocol/control client plus
  hive-relay-cell/lib/hive_relay/domain.ex hello_ack and INCARNATION_DRAIN.
- The revoke-outbox unreadable-file fix is already covered by Hive's stricter
  service-owned JSON reader and transition-outbox constructor: unreadable or
  corrupt files throw before any write. Storage, outbox, broker, host service,
  account relay channel and pool suites: 47 passed.
- Cancellation-after-ready and sibling-unsubscribe leaks in the old shared
  mobile socket do not apply to Hive's one-stream-per-channel transport.
  Channel subscribe returns close; account stream attachment closes any late
  physical result after cancellation, and the client fences generations.
  Account runtime client/request suites: 7 passed.
- Old relay-cell UI detail is not restored through the deleted IPC endpoint;
  Hive account Runtime and Cell diagnostics remain on their existing services.

Resolve remaining conflicts individually, audit cleanly merged changes and newly
introduced modules, verify current HiveRelay equivalents for removed Orca relay
paths, run intake and generated-file checks, then run local test/typecheck/lint/build
gates. Publish only with the recorded vendor lease and revalidated product tip.
Review the immutable candidate before promoting through a vendor-to-product PR.
Unexecuted platforms must remain explicitly unverified.

## Documentation, generated contracts, and Windows preservation (continued)

- Compact guide/reference split retained; Hive canonical `hive`, session-pinned executable, GNOME Orca guard, and bounded older-host fallback preserved. Shared resolver composition covers Hive Android UI too. Generated guide checks: 82 passed, 2 POSIX-only skipped.
- Skill manifest regenerated from product committed release registry/mapping; released history must remain immutable. No release row added.
- Mobile parity test failed on frozen product too (269 vs 271 hooks). Captured AST facts against both source trees: only nested-function and runtime-string hashes differ in this merge, explained by structured-provider creation and Android input reopening. Other updated baseline facts already match frozen product. Route parity, structured launch and input focus: 30 passed.
- Removed 5 obsolete mobile max-lines exemptions; preserved existing Hive exceptions, no new exemptions.
- Node typecheck exposed a missing PRIMARY_CLI_COMMAND import in extracted PTY host assembly and a Windows regression importing retired Relay outbox. Import fixed; ACL regression now creates a real Hive transition outbox, denies reads and verifies constructor refusal plus original-byte preservation. All 6 real Windows ACL tests passed.
- Root node typecheck passed using existing product dependencies. Dependency junction was removed before isolated lockfile generation/install; earlier pnpm exec attempted dependency resolution and was immediately interrupted before linking (primary .modules.yaml timestamp unchanged). Subsequent targeted tests used direct Node executable paths.

## Candidate validation update

All 178 original unmerged paths have individual resolutions; the index has zero unmerged entries. This is an implementation candidate, not independent review approval.

- Full root typecheck and mobile typecheck passed with isolated dependencies. Mobile generated terminal/Mermaid engines were built locally. Windows Node native dependencies were rebuilt locally; node-pty required a temporary short drive mapping, already removed.
- Changed-code native, type-aware, and React Doctor audits reported zero new findings across 2,344 changed files against the frozen product. Full lint subsequently found two duplicate imports; consolidated without changing behavior. Seven Collator performance warnings remain in existing paths.
- Fixed extracted-module imports, Web preference/MiniMax endpoint persistence, retirement-proof capability negotiation, generated signing-script LF, and localized account-runtime connection UI. No desktop installer, release, deployment or GitHub Actions execution is part of this candidate.
- Mobile full first pass: 556/569 files passed; 4,315 tests passed, 18 failed, 3 skipped (plus suite-load failures). Follow-up fixture groups passed: 39 + 12 + 24 tests and 3 signing tests. Payload fingerprint records the deliberate Hive terminal theme/contrast integration; other WebView behavior suites passed. Six UI/static assertions in future-settings-graphite, workspace-creation-graphite and notification-route-coordination were reproduced on frozen product; they remain failures, not waived passes.
- Root full unit run is collecting failures, including unavailable Electron binary downloads, Windows symlink permissions, absent WSL distribution, product-brand/release-contract expectations and lifecycle/integration assertions. These are not a green full-suite result and require triage before promotion. Focused fixtures do not replace the full-suite requirement.
- Platform facade suite passed: 129 tests. macOS/Linux focused regression matrix is not tested. Windows full regression matrix and final exact-SHA gates must be distinguished from this focused platform suite.
- Intake preliminary inclusion report: 349 commits, 346 reachable by ancestry, 3 carried deferred boundary features, zero inclusion blockers. Reachability is not behavioral approval. The proposed checkpoint becomes effective only after reviewed product merge.
- Independent review unavailable: installed code-review skill requires separate code-reviewer and architect lanes and forbids author self-review fallback. This session's native child surface lacks role routing. Keep vendor PR draft; do not merge hivecode/main-next or claim merge-ready.

Local detailed logs are retained under E:/projects/hive-platform/upstream-*.log. Final publication record must pin candidate and original product SHA and retain failed/not-tested evidence.

Pre-commit follow-up: common manifest 14/14 fixed gates passed on Windows. CLI canonical-name expectations and fake Codex child cancellation proof fixture repaired; corresponding 58 tests passed. Two structured-host restart tests still fail on Windows with journal EBUSY and remain unresolved. No assertions were weakened to conceal those failures.

The exploratory root full suite was stopped after recording repeated missing-Electron/WSL/symlink prerequisites and failing assertions; it has no complete passing summary and was not an immutable-SHA final run. It must be rerun after prerequisites and outstanding failures are resolved. Web production bundle passed (existing large-chunk warnings). Explicit lint-staged diff validation passed oxlint, React Doctor and formatting for the merged source; hooks were absent after script-free dependency installation, so this command was executed directly. Formatting and proposed checkpoint are committed together before final candidate checks.


## Follow-up: vendor candidate repairs

The published c69d1042 candidate remains the follow-up lease base; product target remains 7fa4dd4d. PR #8 stays draft, Actions disabled.

- Fixed a real journal-handle leak in retryPendingStructuredAgentSessionSettlement: recovery could open a temporary journal without indexing it in the host session map or closing it. The owner now awaits settlement and closes/retains that temporary journal in finally, preserving host-owned handles. Original two Windows restart EBUSY failures now pass; host and settled-attach retry suites: 41 passed.
- Typed Cell readiness and observation fixture JSON instead of allowing any to erase the whole fixture return type. Timestamp validation and bounded replacement-gap behavior are unchanged; four observation tests passed and focused type-aware lint passed.
- Migrated four reliability-gate entries away from deleted invite/region Relay modules to current Hive account streams, authorization/broker recovery and Cloud E2EE auth. Retained direct/provider tests and original maturity/promotion policies. Historical upstream evidence is explicitly separate from current Hive results; new current commands passed 49 + 89 + 46 tests on Windows. Manifest validation covers all 111 gates.
- Regenerated the runtime-required English catalog using the repository generator, closing a stale generated-artifact failure that the previous common manifest did not check.
- Node typecheck passed. Optional typecheck:e2e still reports existing broad test-tree debt (config/tsconfig.e2e.json explicitly says it is not an enforced gate); none of its reported diagnostics name the three modified HiveRelay fixture files. Full root/mobile suite and cross-platform limitations recorded above remain; these focused repairs are not a substitute for full validation.
- Independent code-reviewer/architect review remains unavailable: no native role-routing capability was exposed in the follow-up tool surface. Author investigation and regression fixes do not constitute independent approval. Do not promote the product branch while that gate is unresolved.
