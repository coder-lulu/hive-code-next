import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { it as test } from 'vitest'
import { parse } from '@babel/parser'
const root = resolve(import.meta.dirname, '../..')
const syntax = (text) =>
  parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }).program.body
function pureContract(text) {
  return syntax(text).every((node) =>
    node.type === 'ImportDeclaration'
      ? node.importKind === 'type'
      : node.type === 'ExportNamedDeclaration'
        ? node.exportKind === 'type'
        : node.type === 'TSTypeAliasDeclaration'
  )
}
test('RPC transport contract is type-only and cannot import the mobile runtime factory', () => {
  const source = readFileSync(resolve(root, 'mobile/src/transport/rpc-client-contract.ts'), 'utf8')
  assert.equal(pureContract(source), true)
  assert.equal(
    pureContract(`${source}\nimport { DirectRpcClient } from "./direct-rpc-client"`),
    false
  )
  const consumer = readFileSync(
    resolve(root, 'tests/e2e/native-chat-ssh-delivery.unit.test.ts'),
    'utf8'
  )
  assert.match(consumer, /import type \{ RpcClient \} from ['"].*rpc-client-contract['"]/)
})
test('permission-send type dependency graph cannot pull Expo or React Native into the Node harness', () => {
  const queue = [resolve(root, 'mobile/src/session/mobile-native-chat-permission-send.ts')]
  const visited = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (visited.has(file)) {
      continue
    }
    visited.add(file)
    for (const node of syntax(readFileSync(file, 'utf8'))) {
      if (
        !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          node.type
        ) ||
        !node.source
      ) {
        continue
      }
      const spec = node.source.value
      assert.equal(
        /^(react-native(?:\/|$)|expo(?:-modules-core|-crypto|\/|$))/.test(spec),
        false,
        `${file} imports ${spec}`
      )
      if (!spec.startsWith('.')) {
        continue
      }
      const target = resolve(dirname(file), spec)
      const found = [target, ...['.ts', '.tsx', '/index.ts'].map((suffix) => target + suffix)].find(
        (p) => existsSync(p) && extname(p)
      )
      assert.ok(found, `${file} has unresolved import ${spec}`)
      queue.push(found)
    }
  }
  assert.ok(visited.has(resolve(root, 'mobile/src/transport/rpc-client-contract.ts')))
  assert.equal(visited.has(resolve(root, 'mobile/src/transport/rpc-client.ts')), false)
})
