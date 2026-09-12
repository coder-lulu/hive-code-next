import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { MOBILE_SESSION_ROUTE_SOURCE_FILES } from './mobile-session-route-source-family.test-support'

const SESSION_FILES = MOBILE_SESSION_ROUTE_SOURCE_FILES
const LOGIC_EXPANSION_NAMES = new Set([
  'useMobileSessionController',
  'useMobileSessionFoundation',
  'useMobileSessionScreenState',
  'useMobileSessionTerminalRuntime',
  'useMobileSessionFeedbackCapabilities',
  'useMobileSessionNativeChatDictation',
  'useMobileSessionTerminalSubscriptionFoundation',
  'useMobileSessionTerminalSubscription',
  'useMobileSessionTerminalStreamDisplay',
  'useMobileSessionTerminalList',
  'useMobileSessionTabApplication',
  'useMobileSessionDocumentReaders',
  'useMobileSessionDiffComments',
  'useMobileSessionMarkdownActions',
  'useMobileSessionTabReconciliation',
  'useMobileSessionLifecycle',
  'useMobileSessionKeyboardState',
  'useMobileSessionStartup',
  'useMobileSessionPreferenceFocus',
  'useMobileSessionTabSwitching',
  'useMobileSessionTerminalWebview',
  'useMobileSessionTerminalSendActions',
  'useMobileSessionFileActions',
  'useMobileSessionTerminalInput',
  'useMobileSessionAccessorySelection',
  'useMobileSessionAttachments',
  'useMobileSessionTerminalCreateActions',
  'useMobileSessionContentCreateActions',
  'useMobileSessionCloseActions',
  'useMobileSessionBulkClose',
  'useMobileSessionPresentation',
  'useMobileSessionPanelRouteActions'
])
const SURFACE_EXPANSION_NAMES = new Set([
  'MobileSessionSurface',
  'MobileSessionHeader',
  'MobileSessionContentRow',
  'MobileSessionActiveContent',
  'MobileSessionCommandDock',
  'MobileSessionSheets'
])
const CONTENT_COMPONENT_NAMES = ['MarkdownReader', 'DiffLineRow', 'FileReader'] as const
const HOST_COMPONENT_NAMES = new Set([
  'ActivityIndicator',
  'Animated.View',
  'FlatList',
  'Image',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'Text',
  'TextInput',
  'View'
])

// Hive route baseline at the reviewed upstream merge: notification-pane hook and terminal-create failure copy.
// The string count and leaf JSX hash also repair drift already present in frozen product a697f3ba.
// Immutable product/candidate fact comparisons are captured in logs/mobile-parity-fact-diff.txt.
const HEAD_MAIN_HOOK_SHA256 = '2a44f37a7cc9e889219b18066ed810d35a106af6630e103f77a45aedf8eaaa66'
const HEAD_HOOK_BINDING_SHA256 = 'bca4639b7af0a1a743f35052c9444b33e6d0d01622e6afc2cdd2db51633f98fa'
const HEAD_CALLBACK_IDENTITY_SHA256 =
  'cad8b6e3c8ff4889e72272659a4b4b52730909c1e410107aab7606729f60b5d7'
const HEAD_CALLBACK_BODY_SHA256 = '3bab990c09b8ebeca8763fe990985678596f0e24cc66deeee981684c1d73cacc'
const HEAD_EFFECT_SHA256 = 'ec67f7c5cdd8926842f2bccbcccf4d3d922ec6086d5cd66c785071492fec2b3c'
const HEAD_CONTENT_HOOK_SHA256 = 'f0c5809b641fc16a2ae59548785e3d0e6d318f311d568f9ad324382f02599177'
const HEAD_NESTED_FUNCTION_SHA256 =
  '9cd442d7a2c73a88e9adf41f50c25c8f10df0672e74df36cd225d75ace0a416c'
const HEAD_NATIVE_REGISTRATION_SHA256 =
  'cab85e4e4a3f43289ba93ddea9ccce57aea83e0bf14fd1620a965aad0c1cb49e'
const HEAD_NATIVE_REMOVAL_SHA256 =
  '4c994574675a2a0f9c607b3ea89ab7a2ed5a83f7c72fa42342ddcb5f00fc3f4f'
const HEAD_TIMER_CREATION_SHA256 =
  '7a06ea7e65ac48dfbd3d4350f9856e7aa8802abc70ccd0e2556f5b59975648de'
const HEAD_TIMER_CLEANUP_SHA256 = 'd10925056f20b127981b551704406d7298e0e0bc1fd29e519cd11b7e7fea57dd'
const HEAD_RUNTIME_STRING_SHA256 =
  'f93b92c081e583566de404e5d9e1750b911a1d6b1bfcd68f29692fce18f46abe'
const HEAD_HOST_JSX_SHA256 = '6961e342d66c3b5ec9d78e75a5e79e3c69e7f4f79703203710d492928c93e131'
const HEAD_LEAF_JSX_SHA256 = '4f988d2e13ca6944165416638891b4d16d8a2d6c4a07d2a7e2439fedf5f3b8c6'
const HEAD_STYLE_REFERENCE_SHA256 =
  'd05089e4d4c85f52e6f5518196bac924adb89b7b2b3e70ed9c99de35f7d266b7'
const HEAD_IDENTITY_FIELD_SHA256 =
  '91146853930a34dd1f3d80e5c97fbacd7cf19fb93dd26fe8fc6f29169622f9d6'
const HEAD_NAVIGATION_SHA256 = '9d96f5dad7de555d6553eac39c0fab00efad507470fd562cb9beaa32db16f512'
const HEAD_CAPABILITY_SHA256 = 'ca219f7909a091717110b823d5b94a20770ad3ae51894e0fa765e8628309392d'

type Definition = { declaration: ts.FunctionDeclaration; sourceFile: ts.SourceFile }
type HookFacts = {
  bindings: string[]
  callbackBodies: string[]
  callbacks: string[]
  effects: string[]
  hooks: string[]
}

const printer = ts.createPrinter({ removeComments: true })
const sourceFiles = new Map<string, ts.SourceFile>()

function parse(relativePath: string): ts.SourceFile {
  const cached = sourceFiles.get(relativePath)
  if (cached) {
    return cached
  }
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url))
  const sourceFile = ts.createSourceFile(
    relativePath,
    readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n'),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  sourceFiles.set(relativePath, sourceFile)
  return sourceFile
}

function canonical(node: ts.Node, sourceFile: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, '')
}

function hash(values: readonly string[]): string {
  return createHash('sha256').update(values.join('\n')).digest('hex')
}

function readDefinitions(): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  for (const relativePath of SESSION_FILES) {
    const sourceFile = parse(relativePath)
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        definitions.set(node.name.text, { declaration: node, sourceFile })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return definitions
}

function visitLogicalFunction(
  name: string,
  definitions: ReadonlyMap<string, Definition>,
  onNode: (node: ts.Node, sourceFile: ts.SourceFile) => void,
  active = new Set<string>()
): void {
  const definition = definitions.get(name)
  if (!definition?.declaration.body) {
    throw new Error(`Missing session function: ${name}`)
  }
  if (active.has(name)) {
    throw new Error(`Recursive session function: ${name}`)
  }
  const nextActive = new Set(active).add(name)
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      LOGIC_EXPANSION_NAMES.has(node.expression.text)
    ) {
      visitLogicalFunction(node.expression.text, definitions, onNode, nextActive)
      return
    }
    onNode(node, definition.sourceFile)
    ts.forEachChild(node, visit)
  }
  visit(definition.declaration.body)
}

function readHookFacts(name: string, definitions: ReadonlyMap<string, Definition>): HookFacts {
  const facts: HookFacts = {
    bindings: [],
    callbackBodies: [],
    callbacks: [],
    effects: [],
    hooks: []
  }
  visitLogicalFunction(name, definitions, (node, sourceFile) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !/^use[A-Z]/.test(node.expression.text)
    ) {
      return
    }
    const hookName = node.expression.text
    facts.hooks.push(hookName)
    const owner = ts.isVariableDeclaration(node.parent)
      ? node.parent.name.getText(sourceFile)
      : ts.isExpressionStatement(node.parent)
        ? '<statement>'
        : ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression)
          ? `<argument:${node.parent.expression.text}>`
          : '<nested>'
    const lastArgument = node.arguments.at(-1)
    const dependencies =
      lastArgument && ts.isArrayLiteralExpression(lastArgument)
        ? canonical(lastArgument, sourceFile)
        : '<none>'
    facts.bindings.push(`${hookName}|${owner}|${dependencies}`)
    if (hookName === 'useCallback') {
      facts.callbacks.push(`${owner}|${dependencies}`)
      facts.callbackBodies.push(
        `${owner}|${canonical(node.arguments[0], sourceFile)}|${dependencies}`
      )
    }
    if (hookName === 'useEffect') {
      facts.effects.push(`${canonical(node.arguments[0], sourceFile)}|${dependencies}`)
    }
  })
  return facts
}

function readNestedFunctions(definitions: ReadonlyMap<string, Definition>): string[] {
  const functions: string[] = []
  const visitDefinition = (name: string, active: ReadonlySet<string>): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid nested-function stage: ${name}`)
    }
    const nextActive = new Set(active).add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text, nextActive)
        return
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(`${node.name.text}|${canonical(node, definition.sourceFile)}`)
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
  }
  visitDefinition('SessionScreen', new Set())
  return functions
}

function readNativeAndTimerFacts(definitions: ReadonlyMap<string, Definition>): {
  cleanups: string[]
  creations: string[]
  registrations: string[]
  removals: string[]
} {
  const registrations: string[] = []
  const removals: string[] = []
  const creations: string[] = []
  const cleanups: string[] = []
  const collect = (node: ts.Node, sourceFile: ts.SourceFile): void => {
    if (!ts.isCallExpression(node)) {
      return
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(sourceFile)
      const method = node.expression.name.text
      if (
        ['BackHandler', 'AppState', 'Keyboard'].includes(receiver) &&
        ['addEventListener', 'addListener'].includes(method)
      ) {
        registrations.push(canonical(node, sourceFile))
      }
      if (method === 'remove') {
        removals.push(canonical(node, sourceFile))
      }
    }
    if (ts.isIdentifier(node.expression)) {
      if (['setTimeout', 'setInterval', 'requestAnimationFrame'].includes(node.expression.text)) {
        creations.push(canonical(node, sourceFile))
      }
      if (
        ['clearTimeout', 'clearInterval', 'cancelAnimationFrame'].includes(node.expression.text)
      ) {
        cleanups.push(canonical(node, sourceFile))
      }
    }
  }
  visitLogicalFunction('FileReader', definitions, collect)
  visitLogicalFunction('SessionScreen', definitions, collect)
  return { cleanups, creations, registrations, removals }
}

function isRuntimeNode(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isImportTypeNode(parent) ||
      ts.isTypeNode(parent)
    ) {
      return false
    }
  }
  return true
}

function readRuntimeStrings(): string[] {
  const values: string[] = []
  for (const relativePath of SESSION_FILES) {
    const visit = (node: ts.Node): void => {
      if (isRuntimeNode(node)) {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          values.push(node.text)
        }
        if (ts.isJsxText(node) && node.text.trim()) {
          values.push(node.text.replace(/\s+/g, ' ').trim())
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(relativePath))
  }
  return values.sort()
}

function readJsxFacts(definitions: ReadonlyMap<string, Definition>): {
  host: string[]
  leaf: string[]
  styleReferences: string[]
} {
  const host: string[] = []
  const leaf: string[] = []
  const active = new Set<string>()
  const visitDefinition = (name: string): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid JSX stage: ${name}`)
    }
    active.add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text)
        return
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node
        const tagName = opening.tagName.getText(definition.sourceFile)
        if (SURFACE_EXPANSION_NAMES.has(tagName)) {
          visitDefinition(tagName)
          return
        }
        const attributes = opening.attributes.properties
          .map((attribute) => {
            if (ts.isJsxSpreadAttribute(attribute)) {
              return `...${canonical(attribute.expression, definition.sourceFile)}`
            }
            const attributeName = attribute.name.getText(definition.sourceFile)
            if (!attribute.initializer) {
              return attributeName
            }
            if (ts.isStringLiteral(attribute.initializer)) {
              return `${attributeName}=${JSON.stringify(attribute.initializer.text)}`
            }
            return `${attributeName}=${
              attribute.initializer.expression
                ? canonical(attribute.initializer.expression, definition.sourceFile)
                : ''
            }`
          })
          .join(',')
        ;(HOST_COMPONENT_NAMES.has(tagName) ? host : leaf).push(`${tagName}|${attributes}`)
        for (const attribute of opening.attributes.properties) {
          ts.forEachChild(attribute, visit)
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children) {
            visit(child)
          }
        }
        return
      }
      if (ts.isJsxFragment(node)) {
        for (const child of node.children) {
          visit(child)
        }
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
    active.delete(name)
  }
  for (const name of CONTENT_COMPONENT_NAMES) {
    visitDefinition(name)
  }
  visitDefinition('SessionScreen')
  const styleReferences: string[] = []
  for (const record of [...host, ...leaf]) {
    for (const match of record.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
      styleReferences.push(match[1])
    }
  }
  return { host, leaf, styleReferences }
}

function readCompatibilityFacts(definitions: ReadonlyMap<string, Definition>): {
  capabilities: string[]
  identityFields: string[]
  navigation: string[]
} {
  const capabilities: string[] = []
  const identityFields: string[] = []
  const navigation: string[] = []
  visitLogicalFunction('SessionScreen', definitions, (node, sourceFile) => {
    if (!isRuntimeNode(node)) {
      return
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile)
      if (['notifyClients', 'deviceToken', 'clientId'].includes(name)) {
        identityFields.push(`${name}|${canonical(node.initializer, sourceFile)}`)
      }
      if (
        name === 'client' &&
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'id'
        ) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'type'
        )
      ) {
        identityFields.push(`client|${canonical(node.initializer, sourceFile)}`)
      }
    }
    if (!ts.isCallExpression(node)) {
      return
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'router' &&
      ['push', 'replace', 'back'].includes(node.expression.name.text)
    ) {
      navigation.push(canonical(node, sourceFile))
    }
    const callName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ''
    const callText = canonical(node, sourceFile)
    if (
      ['startRuntimeCapabilityProbe', 'supportsMobileQuickCommands'].includes(callName) ||
      (callName === 'includes' && callText.includes('capabilities.includes'))
    ) {
      capabilities.push(callText)
    }
  })
  return { capabilities, identityFields, navigation }
}

describe('mobile session route extraction parity', () => {
  it('preserves hooks, callbacks, effects, and nested action bodies', () => {
    const definitions = readDefinitions()
    const main = readHookFacts('SessionScreen', definitions)
    const contentBindings = CONTENT_COMPONENT_NAMES.flatMap(
      (name) => readHookFacts(name, definitions).bindings
    )
    expect(main.hooks).toHaveLength(272)
    expect(hash(main.hooks)).toBe(HEAD_MAIN_HOOK_SHA256)
    expect(hash(main.bindings)).toBe(HEAD_HOOK_BINDING_SHA256)
    expect(main.callbacks).toHaveLength(78)
    expect(hash(main.callbacks)).toBe(HEAD_CALLBACK_IDENTITY_SHA256)
    expect(hash(main.callbackBodies)).toBe(HEAD_CALLBACK_BODY_SHA256)
    expect(main.effects).toHaveLength(24)
    expect(hash(main.effects)).toBe(HEAD_EFFECT_SHA256)
    expect(contentBindings).toHaveLength(17)
    expect(hash(contentBindings)).toBe(HEAD_CONTENT_HOOK_SHA256)
    const nestedFunctions = readNestedFunctions(definitions)
    expect(nestedFunctions).toHaveLength(11)
    expect(hash(nestedFunctions)).toBe(HEAD_NESTED_FUNCTION_SHA256)
  })

  it('preserves native listeners, timers, identity payloads, and compatibility gates', () => {
    const definitions = readDefinitions()
    const native = readNativeAndTimerFacts(definitions)
    const compatibility = readCompatibilityFacts(definitions)
    expect(native.registrations).toHaveLength(7)
    expect(hash(native.registrations)).toBe(HEAD_NATIVE_REGISTRATION_SHA256)
    expect(native.removals).toHaveLength(9)
    expect(hash(native.removals)).toBe(HEAD_NATIVE_REMOVAL_SHA256)
    expect(native.creations.filter((fact) => fact.startsWith('setTimeout'))).toHaveLength(6)
    expect(native.creations.filter((fact) => fact.startsWith('setInterval'))).toHaveLength(1)
    expect(
      native.creations.filter((fact) => fact.startsWith('requestAnimationFrame'))
    ).toHaveLength(1)
    expect(hash(native.creations)).toBe(HEAD_TIMER_CREATION_SHA256)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearTimeout'))).toHaveLength(10)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearInterval'))).toHaveLength(1)
    expect(native.cleanups.filter((fact) => fact.startsWith('cancelAnimationFrame'))).toHaveLength(
      1
    )
    expect(hash(native.cleanups)).toBe(HEAD_TIMER_CLEANUP_SHA256)
    expect(compatibility.identityFields).toHaveLength(14)
    expect(hash(compatibility.identityFields)).toBe(HEAD_IDENTITY_FIELD_SHA256)
    expect(compatibility.navigation).toHaveLength(6)
    expect(hash(compatibility.navigation)).toBe(HEAD_NAVIGATION_SHA256)
    expect(compatibility.capabilities).toHaveLength(5)
    expect(hash(compatibility.capabilities)).toBe(HEAD_CAPABILITY_SHA256)
  })

  it('preserves runtime strings, styles, and the expanded JSX tree', () => {
    const strings = readRuntimeStrings()
    const jsx = readJsxFacts(readDefinitions())
    expect(strings).toHaveLength(551)
    expect(hash(strings)).toBe(HEAD_RUNTIME_STRING_SHA256)
    expect(jsx.host).toHaveLength(125)
    expect(hash(jsx.host)).toBe(HEAD_HOST_JSX_SHA256)
    expect(jsx.leaf).toHaveLength(62)
    expect(hash(jsx.leaf)).toBe(HEAD_LEAF_JSX_SHA256)
    expect(jsx.styleReferences).toHaveLength(173)
    expect(hash(jsx.styleReferences)).toBe(HEAD_STYLE_REFERENCE_SHA256)
  })
})
