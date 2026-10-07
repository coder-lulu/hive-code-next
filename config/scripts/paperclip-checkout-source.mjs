import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { paperclipExternalExecutionSourceDigest } from './paperclip-source-proof.mjs'

export function paperclipCheckoutAliases(source) {
  const requireDb = createRequire(join(source, 'packages/db/package.json'))
  return {
    '@paperclipai/db': join(source, 'packages/db/src/schema/index.ts'),
    '@hive-paperclip-drizzle-pg': requireDb.resolve('drizzle-orm/pg-core'),
    '@hive-paperclip-drizzle-session': requireDb.resolve('drizzle-orm/postgres-js/session'),
    '@hive-paperclip-agent-eligibility': join(source, 'packages/shared/src/agent-eligibility.ts'),
    'drizzle-orm': dirname(requireDb.resolve('drizzle-orm'))
  }
}

export async function verifyPaperclipCheckoutSources(root, manifest) {
  const modules = manifest.issueCheckoutCore.modules
  if (!Array.isArray(modules) || modules.length !== 3) {
    throw new Error('Paperclip checkout guard source proof is required')
  }
  const expected = [
    'issue-checkout-ownership.ts',
    'issue-checkout-admission.ts',
    'issue-dependency-readiness.ts'
  ]
  for (const [index, module] of modules.entries()) {
    const path = `integration/paperclip/core/${expected[index]}`
    if (
      module.vendoredModule !== path ||
      module.module !== `server/src/services/${expected[index]}` ||
      (await paperclipExternalExecutionSourceDigest(root, path)) !== module.sha256
    ) {
      throw new Error('Paperclip checkout guard differs from the pinned provider-free source')
    }
  }
}
