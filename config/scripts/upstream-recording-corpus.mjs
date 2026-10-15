/** Golden originals obey the same reviewed three-way ownership as the verified tree. */
export function verifyRecordingCorpus(base, product, upstream, content, resolutions) {
  const maps = [base, product, upstream, content].map(
    (entries) =>
      new Map(
        entries
          .filter(({ path }) => path.startsWith('mobile/rpc-foundation/goldens/'))
          .map(({ path, mode, blob }) => [path, { mode, sha: blob }])
      )
  )
  const paths = new Set(maps.flatMap((map) => [...map.keys()]))
  const same = (a, b) =>
    a === null || b === null ? a === b : a?.mode === b?.mode && a?.sha === b?.sha
  for (const path of paths) {
    const [c, r, u, f] = maps.map((map) => map.get(path) ?? null)
    const rows = resolutions.filter((row) => row.path === path)
    let expected
    if (same(u, c)) {
      expected = r
    } else if (same(r, c) || same(r, u)) {
      expected = u
    } else {
      if (
        rows.length !== 1 ||
        !same(rows[0].base, c) ||
        !same(rows[0].product, r) ||
        !same(rows[0].upstream, u) ||
        !same(rows[0].result, f)
      ) {
        throw new Error(`Golden corpus requires exact frozen conflicting review: ${path}`)
      }
      continue
    }
    if (rows.length || !same(f, expected)) {
      throw new Error(`Deterministic golden corpus ownership changed: ${path}`)
    }
  }
}
