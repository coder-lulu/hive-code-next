import { fileURLToPath } from 'node:url'
import { run } from '../../lib/installer.mjs'

process.exitCode = await run([], {
  tempRoot: fileURLToPath(new URL('../../../../logs/npm-installer/tmp/', import.meta.url)),
  fetch: () =>
    new Response(
      '#!/usr/bin/env bash\nexec 3<>/dev/tty || exit 90\ntest -t 3 || exit 91\nprintf "TTY_AVAILABLE\\n" >&3\n'
    )
})
