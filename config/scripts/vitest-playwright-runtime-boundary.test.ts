import { globSync, readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import ts from 'typescript-api'
import { expect, it } from 'vitest'
import { NODE_RUNTIME_INCLUDE } from './vitest-node-runtime-files.mjs'
import { callsImportedRuntime, hasValueImport } from './vitest-runtime-owner-source'

const PLAYWRIGHT = 'playwright-core'
const FIXTURE = './mobile-web-app-terminal-render-fixture.mjs'
const START_FIXTURE = 'startTerminalRenderFixture'

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('owner.ts', text, ts.ScriptTarget.Latest, true)
}

function source(file: string): ts.SourceFile {
  return parse(readFileSync(file, 'utf8'))
}

function someNode(node: ts.Node, predicate: (child: ts.Node) => boolean): boolean {
  return (
    predicate(node) || !!ts.forEachChild(node, (child) => someNode(child, predicate) || undefined)
  )
}

// A mocked module has no real lifecycle ownership, even when its imported API is called.
function mocksModule(file: ts.SourceFile, module: string): boolean {
  const mockHosts = new Set(['vi', 'vitest', 'jest'])
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !hasValueImport(statement)) {
      continue
    }
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'vitest'
    ) {
      continue
    }
    const named = statement.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const binding of named.elements) {
        if (
          !binding.isTypeOnly &&
          ['vi', 'vitest'].includes((binding.propertyName ?? binding.name).text)
        ) {
          mockHosts.add(binding.name.text)
        }
      }
    }
  }
  return someNode(file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return false
    }
    const { expression: receiver, name } = node.expression
    const argument = node.arguments[0]
    if (!ts.isIdentifier(receiver) || !mockHosts.has(receiver.text)) {
      return false
    }
    if (!['mock', 'doMock'].includes(name.text) || !argument) {
      return false
    }
    const target =
      ts.isCallExpression(argument) && argument.expression.kind === ts.SyntaxKind.ImportKeyword
        ? argument.arguments[0]
        : argument
    return !!target && ts.isStringLiteral(target) && target.text === module
  })
}

function callsLaunch(node: ts.Node, bindings: Set<string>): boolean {
  return someNode(node, (child) => {
    if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) {
      return false
    }
    const { expression: receiver, name } = child.expression
    return name.text === 'launch' && ts.isIdentifier(receiver) && bindings.has(receiver.text)
  })
}

function launchesPlaywright(file: ts.SourceFile): boolean {
  if (mocksModule(file, PLAYWRIGHT)) {
    return false
  }
  const engines = new Set<string>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !hasValueImport(statement)) {
      continue
    }
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== PLAYWRIGHT
    ) {
      continue
    }
    const named = statement.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const binding of named.elements) {
        if (
          !binding.isTypeOnly &&
          ['chromium', 'webkit', 'firefox'].includes((binding.propertyName ?? binding.name).text)
        ) {
          engines.add(binding.name.text)
        }
      }
    }
  }
  if (callsLaunch(file, engines)) {
    return true
  }
  // Trace the actual describe.each([{ browserType: chromium }, ...]) callback binding.
  return someNode(file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isCallExpression(node.expression)) {
      return false
    }
    const each = node.expression
    if (!ts.isPropertyAccessExpression(each.expression) || each.expression.name.text !== 'each') {
      return false
    }
    const rows = each.arguments[0]
    const callback = node.arguments[1]
    if (!rows || !ts.isArrayLiteralExpression(rows) || rows.elements.length === 0) {
      return false
    }
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      return false
    }
    const parameter = callback.parameters[0]?.name
    if (!parameter || !ts.isObjectBindingPattern(parameter)) {
      return false
    }
    return parameter.elements.some((binding) => {
      const key = binding.propertyName ?? binding.name
      if (!ts.isIdentifier(key) || !ts.isIdentifier(binding.name)) {
        return false
      }
      const realEngineRows = rows.elements.every(
        (row) =>
          ts.isObjectLiteralExpression(row) &&
          row.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === key.text &&
              ts.isIdentifier(property.initializer) &&
              engines.has(property.initializer.text)
          )
      )
      return realEngineRows && callsLaunch(callback.body, new Set([binding.name.text]))
    })
  })
}

function callsRealFixture(file: ts.SourceFile): boolean {
  return !mocksModule(file, FIXTURE) && callsImportedRuntime(file, FIXTURE, START_FIXTURE)
}

// Exact reviewed owners; this list must never be replaced by the mobile-web-app prefix.
const DIRECT_OWNERS = [
  'config/scripts/mobile-web-app-agent-history-render.test.mjs',
  'config/scripts/mobile-web-app-browser-pane-render.test.mjs',
  'config/scripts/mobile-web-app-clipboard-image-resize-render.test.mjs',
  'config/scripts/mobile-web-app-drawer-render.test.mjs',
  'config/scripts/mobile-web-app-files-render.test.mjs',
  'config/scripts/mobile-web-app-frame-budget-sweep.test.ts',
  'config/scripts/mobile-web-app-handoff-grants-render.test.mjs',
  'config/scripts/mobile-web-app-held-press-render.test.mjs',
  'config/scripts/mobile-web-app-html-preview-render.test.mjs',
  'config/scripts/mobile-web-app-media-preview-render.test.mjs',
  'config/scripts/mobile-web-app-mermaid-render.test.mjs',
  'config/scripts/mobile-web-app-native-chat-visual-links.test.mjs',
  'config/scripts/mobile-web-app-native-parity-render.test.mjs',
  'config/scripts/mobile-web-app-render.test.mjs',
  'config/scripts/mobile-web-app-rich-markdown-render.test.mjs',
  'config/scripts/mobile-web-app-safe-area-render.test.mjs',
  'config/scripts/mobile-web-app-session-render.test.mjs',
  'config/scripts/mobile-web-app-session-terminal-init.test.mjs',
  'config/scripts/mobile-web-app-source-control-render.test.mjs',
  'config/scripts/mobile-web-app-stack-transition-render.test.mjs',
  'config/scripts/mobile-web-app-tasks-render.test.mjs',
  'config/scripts/mobile-web-app-terminal-live-input-render.test.mjs',
  'config/scripts/mobile-web-app-working-spinner-render.test.mjs'
]

const HELPER_OWNERS = [
  'config/scripts/mobile-web-app-terminal-render.test.mjs',
  'config/scripts/mobile-web-app-terminal-render-fixture.test.mjs'
]

const PURE_OWNERS = [
  'config/scripts/mobile-web-app-browser-pane-text-inputs.test.mjs',
  'config/scripts/mobile-web-app-csp.test.mjs',
  'config/scripts/mobile-web-app-editable-host-font-size.test.mjs',
  'config/scripts/mobile-web-app-external-link-seam.test.mjs',
  'config/scripts/mobile-web-app-external-navigation-grant.test.mjs',
  'config/scripts/mobile-web-app-files-external-links.test.mjs',
  'config/scripts/mobile-web-app-haptics-seam.test.mjs',
  'config/scripts/mobile-web-app-override-inventory.test.mjs',
  'config/scripts/mobile-web-app-page-closure-families.test.mjs',
  'config/scripts/mobile-web-app-page-grant-call-sites.test.mjs',
  'config/scripts/mobile-web-app-push-subsystem-closure.test.mjs',
  'config/scripts/mobile-web-app-route-manifest.test.mjs',
  'config/scripts/mobile-web-app-route-snapshot.test.mjs',
  'config/scripts/mobile-web-app-screencast-lane-grant.test.mjs',
  'config/scripts/mobile-web-app-session-dictation-capture.test.mjs',
  'config/scripts/mobile-web-app-session-external-links.test.mjs',
  'config/scripts/mobile-web-app-session-media-picker.test.mjs',
  'config/scripts/mobile-web-app-session-terminal-closure.test.mjs',
  'config/scripts/mobile-web-app-session-text-inputs.test.mjs',
  'config/scripts/mobile-web-app-session-webview-consumers.test.mjs',
  'config/scripts/mobile-web-app-source-control-external-links.test.mjs',
  'config/scripts/mobile-web-app-source-control-keyboard.test.mjs',
  'config/scripts/mobile-web-app-source-control-text-inputs.test.mjs',
  'config/scripts/mobile-web-app-tasks-external-links.test.mjs'
]

it.each([
  ['named engine', 'import { chromium } from "playwright-core"; chromium.launch()', true],
  ['aliased engine', 'import { webkit as engine } from "playwright-core"; engine.launch()', true],
  [
    'mixed types',
    'import { type Browser, firefox } from "playwright-core"; firefox.launch()',
    true
  ],
  ['type-only clause', 'import type { chromium } from "playwright-core"; chromium.launch()', false],
  [
    'type-only binding',
    'import { type chromium } from "playwright-core"; chromium.launch()',
    false
  ],
  ['comment', '// import { chromium } from "playwright-core"; chromium.launch()', false],
  [
    'string',
    'const sample = `import { chromium } from "playwright-core"; chromium.launch()`',
    false
  ],
  [
    'unused value import',
    'import { chromium } from "playwright-core"; chromium.executablePath()',
    false
  ],
  ['unrelated receiver', 'import { chromium } from "playwright-core"; engine.launch()', false],
  ['mock library', 'import { chromium } from "playwright-core-mock"; chromium.launch()', false],
  [
    'mocked real library',
    'import { chromium } from "playwright-core"; vi.mock("playwright-core"); chromium.launch()',
    false
  ],
  [
    'aliased mocking API',
    'import { vi as double } from "vitest"; import { chromium } from "playwright-core"; double.doMock("playwright-core"); chromium.launch()',
    false
  ],
  [
    'dynamic mock target',
    'import { chromium } from "playwright-core"; vi.mock(import("playwright-core")); chromium.launch()',
    false
  ],
  [
    'commented mock',
    'import { chromium } from "playwright-core"; /* vi.mock("playwright-core") */ chromium.launch()',
    true
  ],
  [
    'table engine',
    'import { chromium as c, webkit as w } from "playwright-core"; describe.each([{browserType:c},{browserType:w}])("engine", ({browserType: engine}) => { engine.launch() })',
    true
  ],
  [
    'unrelated table engine',
    'import { chromium } from "playwright-core"; describe.each([{browserType:fake}])("engine", ({browserType}) => { browserType.launch() })',
    false
  ],
  [
    'unused table engine',
    'import { chromium } from "playwright-core"; describe.each([{browserType:chromium}])("engine", ({browserType}) => { fake.launch() })',
    false
  ]
])('classifies Playwright lifecycle syntax: %s', (_label, text, expected) => {
  expect(launchesPlaywright(parse(text))).toBe(expected)
})

it.each([
  ['real call', `import { ${START_FIXTURE} } from '${FIXTURE}'; ${START_FIXTURE}()`, true],
  ['aliased call', `import { ${START_FIXTURE} as start } from '${FIXTURE}'; start()`, true],
  ['type-only', `import type { ${START_FIXTURE} } from '${FIXTURE}'; ${START_FIXTURE}()`, false],
  ['unused import', `import { ${START_FIXTURE} } from '${FIXTURE}'`, false],
  ['comment', `// import { ${START_FIXTURE} } from '${FIXTURE}'; ${START_FIXTURE}()`, false],
  [
    'mocked helper',
    `import { ${START_FIXTURE} } from '${FIXTURE}'; vi.mock('${FIXTURE}'); ${START_FIXTURE}()`,
    false
  ]
])('classifies terminal fixture lifecycle syntax: %s', (_label, text, expected) => {
  expect(callsRealFixture(parse(text))).toBe(expected)
})

it.each(DIRECT_OWNERS)('proves the real imported Playwright launch in %s', (owner) => {
  expect(launchesPlaywright(source(owner))).toBe(true)
})

it.each(HELPER_OWNERS)('proves the real helper call and producer launch for %s', (owner) => {
  expect(callsRealFixture(source(owner))).toBe(true)
  expect(launchesPlaywright(source(`config/scripts/${FIXTURE.slice(2)}`))).toBe(true)
})

it.each([...DIRECT_OWNERS, ...HELPER_OWNERS])(
  'assigns exact Playwright owner to Node: %s',
  (owner) => {
    expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  }
)

it('keeps the reviewed browser inventory exact without prefix or wider glob ownership', () => {
  expect(DIRECT_OWNERS).toHaveLength(23)
  expect(HELPER_OWNERS).toHaveLength(2)
  expect(PURE_OWNERS).toHaveLength(24)
  const owners = [...DIRECT_OWNERS, ...HELPER_OWNERS]
  expect(new Set(owners).size).toBe(25)
  const prefixFiles = globSync('config/scripts/mobile-web-app-*.test.{mjs,ts}').map((file) =>
    file.replaceAll('\\', '/')
  )
  expect(prefixFiles.sort()).toEqual([...owners, ...PURE_OWNERS].sort())
  for (const pattern of NODE_RUNTIME_INCLUDE) {
    for (const owner of prefixFiles.filter((file) => matchesGlob(file, pattern))) {
      expect(pattern, owner).toBe(owner)
      expect(owners, owner).toContain(owner)
    }
  }
})

it.each(PURE_OWNERS)('keeps pure or mocked prefix suite on Bun: %s', (owner) => {
  const fixture = source(owner)
  expect(launchesPlaywright(fixture)).toBe(false)
  expect(callsRealFixture(fixture)).toBe(false)
  expect(NODE_RUNTIME_INCLUDE.some((pattern) => matchesGlob(owner, pattern))).toBe(false)
})
