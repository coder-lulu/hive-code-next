const { readFileSync } = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')

const upstreamVisibleBrandPattern = /\b(?:ORCA|Orca)\b/
// Why: the compatibility value `orca` remains common in discriminants, fixtures,
// storage keys, and protocol handling. Only command-shaped copy belongs to this
// user-visible boundary.
const legacyCliExamplePattern =
  /(^|[\s`$'"])(?:orca-ide|orca)(?=\s+(?:account|emulator|open|orchestration|serve|status|tab|terminal|worktree)\b)/m
const dynamicProductBrandAdapters = new Set(['applyProductBranding', 'applyProductCliBranding'])
const allowlistedDynamicProductBrandAdapters = new Map([
  ['src/main/i18n/main-i18n.ts', new Set(['translateMain'])],
  ['src/renderer/src/i18n/i18n.ts', new Set(['translate'])]
])
const productNameAdapters = new Set([
  'applyProductBranding',
  'applyProductCliBranding',
  'productNameText',
  'translate',
  'translateMain',
  'withProductBranding'
])
const productCliAdapters = new Set(['applyProductCliBranding', 'translate', 'translateMain'])

function callName(node) {
  if (node.callee?.type === 'Identifier') {
    return node.callee.name
  }
  if (node.callee?.type === 'MemberExpression' && node.callee.property?.type === 'Identifier') {
    return node.callee.property.name
  }
  return null
}

function isStaticBrandAdapterValue(node) {
  return (
    node.type === 'StringLiteral' ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0)
  )
}

function brandValueArgumentIndex(adapterName) {
  return adapterName === 'translate' || adapterName === 'translateMain' ? 1 : 0
}

function isAllowlistedDynamicProductBrandAdapter(relativePath, valueArgument, ancestors) {
  const allowedFunctions = allowlistedDynamicProductBrandAdapters.get(relativePath)
  if (
    !allowedFunctions ||
    valueArgument?.type !== 'Identifier' ||
    valueArgument.name !== 'fallback'
  ) {
    return false
  }
  return ancestors.some(
    (ancestor) =>
      ancestor.type === 'FunctionDeclaration' &&
      ancestor.id?.type === 'Identifier' &&
      allowedFunctions.has(ancestor.id.name)
  )
}

function isDirectStaticAdapterValue(node, ancestors, adapterNames) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    const adapterName = ancestor.type === 'CallExpression' ? callName(ancestor) : null
    if (!adapterName || !adapterNames.has(adapterName)) {
      continue
    }
    const valueArgument = ancestor.arguments[brandValueArgumentIndex(adapterName)]
    return valueArgument === node && isStaticBrandAdapterValue(valueArgument)
  }
  return false
}

function isInsideProductNameAdapter(node, ancestors) {
  return isDirectStaticAdapterValue(node, ancestors, productNameAdapters)
}

function isInsideProductCliAdapter(node, ancestors) {
  return isDirectStaticAdapterValue(node, ancestors, productCliAdapters)
}

const userVisiblePropertyNames = new Set([
  'description',
  'detail',
  'error',
  'guidance',
  'help',
  'label',
  'message',
  'nextStep',
  'nextSteps',
  'reason',
  'subtitle',
  'title',
  'unsupportedReason',
  'warning'
])

function propertyName(node) {
  if (node?.key?.type === 'Identifier' || node?.key?.type === 'StringLiteral') {
    return node.key.name ?? node.key.value
  }
  return null
}

function identifierName(node) {
  return node?.type === 'Identifier' ? node.name : null
}

function isBackendUserVisibleContext(ancestors) {
  return ancestors.some((node) => {
    if (node.type === 'ThrowStatement') {
      return true
    }
    if (node.type === 'NewExpression') {
      return /(?:Error|Exception)$/.test(callName(node) ?? '')
    }
    if (node.type === 'ObjectProperty') {
      return userVisiblePropertyNames.has(propertyName(node))
    }
    if (node.type === 'VariableDeclarator') {
      return /(?:description|detail|guidance|help|label|message|reason|subtitle|title|warning)/i.test(
        identifierName(node.id) ?? ''
      )
    }
    if (node.type === 'CallExpression') {
      return /(?:dialog|message|notification|notify|showError|toast|warning)/i.test(
        callName(node) ?? ''
      )
    }
    return false
  })
}

function isInsideCompatibilityConsumer(node, ancestors) {
  const parent = ancestors.at(-1)
  if (parent?.type === 'CallExpression' && parent.arguments.includes(node)) {
    const method = callName(parent)
    const argumentIndex = parent.arguments.indexOf(node)
    if (method === 'replace' || method === 'replaceAll') {
      return argumentIndex === 0
    }
    return ['endsWith', 'includes', 'match', 'startsWith', 'test'].includes(method)
  }
  return ancestors.some(
    (ancestor) =>
      ancestor.type === 'VariableDeclarator' &&
      /^(?:LEGACY_|ORCA_(?:DISPATCH_STATUS|.*(?:MARKER|PROTOCOL)))/.test(
        identifierName(ancestor.id) ?? ''
      )
  )
}

function removeCompatibilityIdentifiers(value) {
  return value
    .replace(/\bOrca Nerd Font Symbols\b/g, '')
    .replace(/\bORCA\.[A-Z0-9_-]+\b/gi, '')
    .replace(/\bORCA_[A-Z0-9_]+\b/g, '')
    .replace(/\bORCA:\/\/[^\s"']*/gi, '')
}

function candidatePreview(value) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine
}

function collectBrandCandidatesFromSource(source, filePath, repoRoot, options = {}) {
  const hasProductBrandAdapter = /\b(?:applyProductBranding|applyProductCliBranding)\s*\(/.test(
    source
  )
  if (
    !upstreamVisibleBrandPattern.test(source) &&
    !legacyCliExamplePattern.test(source) &&
    !hasProductBrandAdapter
  ) {
    return []
  }
  const sourceFile = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', ...(filePath.endsWith('x') ? ['jsx'] : [])]
  })
  const candidates = []

  function visit(node, ancestors = []) {
    if (node.type === 'CallExpression') {
      const adapterName = callName(node)
      const valueArgument = node.arguments[0]
      const relativePath = path.relative(repoRoot, filePath).replaceAll('\\', '/')
      if (
        dynamicProductBrandAdapters.has(adapterName) &&
        valueArgument?.type &&
        !isStaticBrandAdapterValue(valueArgument) &&
        relativePath !== 'src/shared/brand.ts' &&
        !isAllowlistedDynamicProductBrandAdapter(relativePath, valueArgument, ancestors)
      ) {
        const argumentSource = source.slice(valueArgument.start, valueArgument.end)
        const visibleArgumentSource = removeCompatibilityIdentifiers(argumentSource)
        if (
          !upstreamVisibleBrandPattern.test(visibleArgumentSource) &&
          !legacyCliExamplePattern.test(visibleArgumentSource)
        ) {
          candidates.push(`${relativePath}:${node.loc.start.line}:${adapterName}(dynamic value)`)
        }
      }
    }
    let value = null
    if (node.type === 'StringLiteral') {
      value = node.value
    } else if (node.type === 'TemplateLiteral') {
      value = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('')
    } else if (node.type === 'JSXText') {
      value = node.value.trim()
    }
    // Only module-specifier strings are non-visible. An exported function can
    // still throw or return user-facing copy, so an export ancestor must not
    // suppress its entire subtree.
    const parent = ancestors.at(-1)
    const isImportOrExport =
      parent &&
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(parent.type)
    const visibleValue = value ? removeCompatibilityIdentifiers(value) : ''
    const hasUpstreamName =
      upstreamVisibleBrandPattern.test(visibleValue) && !isInsideProductNameAdapter(node, ancestors)
    const hasLegacyCliExample =
      legacyCliExamplePattern.test(visibleValue) && !isInsideProductCliAdapter(node, ancestors)
    const isInRequestedSurface =
      !options.backendUserVisibleContextOnly || isBackendUserVisibleContext(ancestors)
    if (
      value &&
      !isImportOrExport &&
      !isInsideCompatibilityConsumer(node, ancestors) &&
      isInRequestedSurface &&
      (hasUpstreamName || hasLegacyCliExample)
    ) {
      candidates.push(
        `${path.relative(repoRoot, filePath).replaceAll('\\', '/')}:${node.loc.start.line}:${candidatePreview(value)}`
      )
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'errors'].includes(key)) {
        continue
      }
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item?.type) {
            visit(item, [...ancestors, node])
          }
        }
      } else if (child?.type) {
        visit(child, [...ancestors, node])
      }
    }
  }

  visit(sourceFile)
  return candidates
}

function collectRendererBrandCandidates(filePath, repoRoot, options = {}) {
  return collectBrandCandidatesFromSource(
    readFileSync(filePath, 'utf8'),
    filePath,
    repoRoot,
    options
  )
}

module.exports = { collectBrandCandidatesFromSource, collectRendererBrandCandidates }
