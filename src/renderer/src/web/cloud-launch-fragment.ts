const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BASE64URL_SECRET_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const EXACT_LAUNCH_FRAGMENT_PATTERN = /^launch=([0-9a-f-]+)\.([A-Za-z0-9_-]+)$/

export type CloudLaunchCredential = {
  ticketId: string
  launchSecret: string
}

export type CloudLaunchFragmentResult =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'valid'; credential: CloudLaunchCredential }

type CloudLaunchLocation = Pick<Location, 'hash' | 'search'>

type CloudLaunchAddressBar = {
  location: Pick<Location, 'hash' | 'origin' | 'pathname' | 'search'>
  history: Pick<History, 'replaceState'>
  documentTitle: string
}

export function readCloudLaunchFragment(location: CloudLaunchLocation): CloudLaunchFragmentResult {
  if (new URLSearchParams(location.search).has('launch')) {
    return { kind: 'invalid' }
  }

  const fragment = location.hash.replace(/^#/, '')
  if (!fragment) {
    return { kind: 'absent' }
  }

  const fragmentParameters = new URLSearchParams(fragment)
  if (!fragmentParameters.has('launch')) {
    return { kind: 'absent' }
  }

  const match = EXACT_LAUNCH_FRAGMENT_PATTERN.exec(fragment)
  if (!match) {
    return { kind: 'invalid' }
  }

  const ticketId = match[1] ?? ''
  const launchSecret = match[2] ?? ''
  if (!CANONICAL_UUID_PATTERN.test(ticketId) || !BASE64URL_SECRET_PATTERN.test(launchSecret)) {
    return { kind: 'invalid' }
  }

  return { kind: 'valid', credential: { ticketId, launchSecret } }
}

export function clearCloudLaunchCredentialFromAddressBar(
  addressBar: CloudLaunchAddressBar = currentAddressBar()
): void {
  if (!addressBar.location.hash && !addressBar.location.search) {
    return
  }

  const cleanUrl = `${addressBar.location.origin}${addressBar.location.pathname}`
  // Why: both valid fragments and rejected query-form credentials must disappear
  // before any network request can copy them into history or referrer metadata.
  addressBar.history.replaceState(null, addressBar.documentTitle, cleanUrl)
}

function currentAddressBar(): CloudLaunchAddressBar {
  return {
    location: window.location,
    history: window.history,
    documentTitle: document.title
  }
}
