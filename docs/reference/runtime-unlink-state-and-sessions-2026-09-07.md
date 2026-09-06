# Runtime unlink ownership and sessions

Cloud unlink succeeded (HTTP 200) while Desktop kept its persisted CLAIMED
registration. The lookup decoder rejected the server's UNLINKED status, and a
fenced presence did not trigger ownership verification. The account session list
also used the retired Web session representation.

Desktop now accepts the strict UNLINKED lookup, refreshes ownership on relevant
presence transitions, and clears only the old registration after authoritative
confirmation. Keys, Runtime identity and local workspace data remain available
for reclaiming the same computer. Network failures never imply unlinking.

The session list uses current account Runtime sessions. Owned client IPC, parsing
and revoke requests use managedSessionId and expectedResourceVersion with the
current account Runtime revoke protocol. Revocation responses update status and
versions without discarding the existing row metadata. Pending activation and
closed sessions are represented explicitly.

Necessary ownership, session contract, IPC, settings and localization tests passed;
Node/renderer typechecks and targeted lint passed. Installed Desktop visual
verification and real SMS reclaim remain user verification after restart.
