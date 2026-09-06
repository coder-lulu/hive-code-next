# Desktop sidebar duplicate Runtime projection

The local profile contains two project groups and one folder workspace, whereas
the sidebar showed each group twice and repeated the folder workspace in both.
The same checkout appeared as both Local Windows and the claimed computer.

Two causes were fixed:

- The account Runtime catalog imported the current computer as a remote Runtime.
  Main now excludes its persisted Runtime record ID from connection targets and
  rejects a stale selector that attempts to reconnect to itself. Account directory
  and ownership records remain available for device management.
- Sidebar group membership, parent relationships and counts used bare group IDs.
  These are now scoped to the owning host. Non-local header keys and reveal paths
  use the existing host-qualified identity, keeping same-ID groups on genuinely
  different computers independent. Host filtering and folder path-status probes
  and cache reads use the same owning host, preventing another computer's status
  from hiding or disabling a local folder.

Renderer ownership updates refresh the remote catalog when the local record ID
changes, including initial ownership hydration. Existing removal handling purges
the retired mirror and fences delayed catalog replies. No profile data migration,
name/path deduplication, or deletion of real projects is needed.

Changed areas: main account Runtime access/startup/routing, renderer account
catalog synchronization, and sidebar grouping/reveal/filtering/path status. No UI theme tokens,
dependencies or product switches were added.

Verification: 36 main catalog/routing tests, 16 account synchronization tests,
7 existing mirror-purge tests, and 110 existing/focused sidebar grouping,
collapse, reveal and drag tests passed. Seven additional host-filter/path-status
tests passed. Node, CLI and renderer typechecks passed;
targeted lint and formatting passed. Live UI verification after installing the
rebuilt Desktop remains pending; no installed running session was terminated.
