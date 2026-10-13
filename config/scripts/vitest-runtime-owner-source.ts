import ts from 'typescript-api'

export function hasValueImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) {
    return true
  }
  if (clause.isTypeOnly) {
    return false
  }
  return (
    !!clause.name ||
    !clause.namedBindings ||
    ts.isNamespaceImport(clause.namedBindings) ||
    clause.namedBindings.elements.length === 0 ||
    clause.namedBindings.elements.some((binding) => !binding.isTypeOnly)
  )
}

export function callsImportedRuntime(
  source: ts.SourceFile,
  moduleSuffix: string,
  importedName: string
): boolean {
  const bindings = new Set<string>()
  for (const node of source.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !hasValueImport(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.endsWith(moduleSuffix)
    ) {
      continue
    }
    const named = node.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const binding of named.elements) {
        if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === importedName) {
          bindings.add(binding.name.text)
        }
      }
    }
  }
  let called = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      called ||= bindings.has(node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return called
}
