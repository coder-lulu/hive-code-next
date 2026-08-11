import { APP_DISPLAY_NAME } from './brand'

// Why: single source of truth for the commit trailer the product appends when
// the attribution toggle (`enableGitHubAttribution`) is on. Used by both
// the terminal git/gh shim and the AI commit-message generator so the two
// code paths agree on the exact string.

// The compatibility export name is part of the existing internal API. The value
// deliberately avoids an invented email address while official links are null.
export const ORCA_GIT_COMMIT_TRAILER = `Made-with: ${APP_DISPLAY_NAME}`
