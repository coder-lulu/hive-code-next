// A slow (but succeeding) daemon start must not flip terminals to the
// LocalPtyProvider fallback — local PTYs are killed on quit, so panes bound to
// them lose their daemon sessions permanently (#5232). This is only a deadlock
// backstop for adopting the persistent provider.
export const LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS = 60_000
