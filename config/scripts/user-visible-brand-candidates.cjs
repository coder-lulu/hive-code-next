const { readFileSync } = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')

const upstreamVisibleBrandPattern = /\b(?:ORCA|Orca)\b/
const productNameAdapters = new Set([
  'applyProductBranding',
  'productNameText',
  'translate',
  'translateMain'
])

function callName(node) {
  if (node.callee?.type === 'Identifier') {
    return node.callee.name
  }
  if (node.callee?.type === 'MemberExpression' && node.callee.property?.type === 'Identifier') {
    return node.callee.property.name
  }
  return null
}

function isInsideProductNameAdapter(ancestors) {
  return ancestors.some(
    (node) => node.type === 'CallExpression' && productNameAdapters.has(callName(node))
  )
}

function removeCompatibilityIdentifiers(value) {
  return value
    .replace(/\bOrca Nerd Font Symbols\b/g, '')
    .replace(/\bORCA\.[A-Z0-9_-]+\b/gi, '')
    .replace(/\bORCA_[A-Z0-9_]+\b/g, '')
    .replace(/\bORCA:\/\/[^\s"']*/gi, '')
}

function collectRendererBrandCandidates(filePath, repoRoot) {
  const source = readFileSync(filePath, 'utf8')
  const sourceFile = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', ...(filePath.endsWith('x') ? ['jsx'] : [])]
  })
  const candidates = []

  function visit(node, ancestors = []) {
    let value = null
    if (node.type === 'StringLiteral') {
      value = node.value
    } else if (node.type === 'TemplateLiteral') {
      value = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('')
    } else if (node.type === 'JSXText') {
      value = node.value.trim()
    }
    if (
      value &&
      upstreamVisibleBrandPattern.test(removeCompatibilityIdentifiers(value)) &&
      !isInsideProductNameAdapter(ancestors) &&
      !ancestors.some((ancestor) =>
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          ancestor.type
        )
      )
    ) {
      candidates.push(
        `${path.relative(repoRoot, filePath).replaceAll('\\', '/')}:${node.loc.start.line}:${value}`
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

module.exports = { collectRendererBrandCandidates }
