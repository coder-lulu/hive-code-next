import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import type { ComponentType } from 'react'
import ts from 'typescript-api'

/** Exercise the active Hive route switch without mounting its native task workspace. */
export function loadTasksShellSwitch(bindings: Record<string, unknown>): ComponentType {
  const path = new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url)
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const route = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'MobileTasksRoute'
  )
  if (!route) {
    throw new Error('Active Hive task route switch was not found')
  }
  const compiled = ts.transpileModule(
    `${route.getText(source).replace(/^export default /, '')}\nMobileTasksRoute`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }
  )
  return runInNewContext(compiled.outputText, bindings) as ComponentType
}
