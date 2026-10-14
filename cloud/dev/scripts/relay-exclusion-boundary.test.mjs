import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const root=fileURLToPath(new URL('../../',import.meta.url))
test('retained Push workspace has no embedded Relay executable or deployment command',async()=> {
  const packageJson=JSON.parse(await readFile(root+'package.json','utf8'))
  assert.doesNotMatch(JSON.stringify(packageJson.scripts),/relay-ops|load:relay|ops:relay|deploy-relay/)
  for(const name of ['apps/relay/package.json','apps/relay/src/index.ts','apps/relay-ops/package.json','packages/relay-contract/package.json','infra/terraform/relay.tf']) {
    await assert.rejects(access(root+name),{code:'ENOENT'})
  }
  for(const name of ['infra/terraform/environments/production.tfvars','infra/terraform/environments/staging.tfvars']) {
    assert.doesNotMatch(await readFile(root+name,'utf8'),/^relay_(?:gce_cells|base_url|director_cloud_sql_proxy_sidecar)\s*=/m)
  }
})
