// Only these leaf ownership boundaries support repair selection; everything else runs all gates.
const SCOPES = [
  ['src/main/hive-account/', ['hivecloud', 'runtime-rpc', 'mobile']],
  ['src/main/hive-runtime-cloud/', ['hivecloud', 'runtime-rpc', 'mobile']],
  ['src/main/updater/', ['updater']],
  ['src/main/updater.', ['updater']],
  ['src/main/updater-', ['updater']],
  ['src/main/runtime/', ['runtime-rpc', 'hivecloud', 'mobile', 'platform']],
  ['mobile/src/', ['mobile', 'runtime-rpc', 'hivecloud', 'platform']],
  ['src/main/pty/', ['platform', 'runtime-rpc', 'mobile']],
  ['src/main/git/', ['platform']],
  ['src/main/providers/', ['platform', 'runtime-rpc', 'mobile']]
]
const ALWAYS = new Set(['brand', 'generated'])

export function validateChangedPath(file) {
  if (
    typeof file !== 'string' ||
    !file ||
    /[\\:]/.test(file) ||
    [...file].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    file.startsWith('/') ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe changed path: ${JSON.stringify(file)}`)
  }
  return file
}

export function validateBase(base) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(base ?? '')) {
    throw new Error('--changed-from requires a full frozen commit SHA')
  }
}

export function discoverChangedPaths(base, git) {
  validateBase(base)
  const resolved = git(['rev-parse', '--verify', `${base}^{commit}`]).trim()
  if (resolved.toLowerCase() !== base.toLowerCase()) {
    throw new Error('Frozen base must identify a commit')
  }
  const commands = [
    ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'],
    ['diff', '--name-only', '-z', '--no-renames', '--cached', 'HEAD', '--'],
    ['diff', '--name-only', '-z', '--no-renames', '--'],
    ['ls-files', '--others', '--exclude-standard', '-z']
  ]
  return [
    ...new Set(
      commands.flatMap((args) => git(args).split('\0').filter(Boolean).map(validateChangedPath))
    )
  ].sort()
}

export function planRepairChecks(fixedChecks, changedPaths, exists) {
  const paths = [...new Set(changedPaths.map(validateChangedPath))].sort()
  const categories = new Set(ALWAYS)
  const unknown = []
  for (const file of paths) {
    const scope = SCOPES.find(([prefix]) => file.startsWith(prefix))
    if (!scope) {
      unknown.push(file)
    } else {
      scope[1].forEach((category) => categories.add(category))
    }
  }
  const selected = unknown.length
    ? [...fixedChecks]
    : fixedChecks.filter((check) => categories.has(check.category))
  const covered = new Set(
    selected.flatMap((check) =>
      (check.paths ?? []).map((file) => (check.cwd === '.' ? file : `${check.cwd}/${file}`))
    )
  )
  for (const mobile of [false, true]) {
    const tests = paths.filter(
      (file) =>
        file.startsWith('mobile/') === mobile &&
        /\.test\.(?:ts|tsx|mjs)$/.test(file) &&
        !covered.has(file) &&
        exists(file)
    )
    if (!tests.length) {
      continue
    }
    selected.push({
      id: mobile ? 'repair-mobile-tests' : 'repair-root-tests',
      category: mobile ? 'mobile' : 'changed-tests',
      kind: 'vitest',
      cwd: mobile ? 'mobile' : '.',
      argv: [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--config',
        mobile ? 'vitest.config.ts' : 'config/vitest.config.ts'
      ],
      paths: tests.map((file) => (mobile ? file.slice('mobile/'.length) : file))
    })
  }
  return {
    formalAcceptance: false,
    changedPaths: paths,
    fallbackPaths: unknown,
    checks: selected,
    omittedGates: fixedChecks.filter((check) => !selected.includes(check)).map((check) => check.id)
  }
}
