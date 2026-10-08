import type { WorkflowStage } from './hive-workflow-draft'

export type WorkflowGraphNode = {
  key: string
  stage: WorkflowStage
  sourceIndex: number
  layer: number
  row: number
}
export type WorkflowGraphEdge = {
  key: string
  from: string
  to: string
  kind: 'dependency' | 'return'
}
export type WorkflowGraphTopology = {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  layers: number
  invalid: boolean
}

export function workflowGraphTopology(stages: readonly WorkflowStage[]): WorkflowGraphTopology {
  const byRef = new Map<string, number>()
  let invalid = false
  stages.forEach((stage, index) => {
    if (byRef.has(stage.stageRef)) {
      invalid = true
    } else {
      byRef.set(stage.stageRef, index)
    }
  })
  const edges: WorkflowGraphEdge[] = []
  const seen = new Set<string>()
  const add = (from: string, to: string, kind: WorkflowGraphEdge['kind']) => {
    const fromIndex = byRef.get(from)
    const toIndex = byRef.get(to)
    if (fromIndex === undefined || toIndex === undefined) {
      invalid = true
      return
    }
    const key = JSON.stringify([kind, fromIndex, toIndex])
    if (seen.has(key)) {
      invalid = true
      return
    }
    seen.add(key)
    edges.push({ key, from: `${fromIndex}:${from}`, to: `${toIndex}:${to}`, kind })
  }
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) {
      add(dependency, stage.stageRef, 'dependency')
    }
    if (stage.returnToStageRef) {
      add(stage.stageRef, stage.returnToStageRef, 'return')
    }
  }
  const degree = stages.map(() => 0)
  const children: number[][] = stages.map(() => [])
  const layers = stages.map(() => 0)
  for (const edge of edges) {
    if (edge.kind !== 'dependency') {
      continue
    }
    const from = Number(edge.from.slice(0, edge.from.indexOf(':')))
    const to = Number(edge.to.slice(0, edge.to.indexOf(':')))
    degree[to] += 1
    children[from].push(to)
  }
  const pending = degree
    .map((value, index) => (value === 0 ? index : -1))
    .filter((index) => index >= 0)
  let processed = 0
  while (pending.length) {
    const index = pending.shift()!
    processed += 1
    for (const child of children[index]) {
      layers[child] = Math.max(layers[child], layers[index] + 1)
      degree[child] -= 1
      if (degree[child] === 0) {
        pending.push(child)
      }
    }
  }
  invalid ||= processed !== stages.length
  const nodes = stages.map((stage, sourceIndex) => ({
    key: `${sourceIndex}:${stage.stageRef}`,
    stage,
    sourceIndex,
    layer: invalid ? sourceIndex : layers[sourceIndex],
    row: 0
  }))
  nodes.sort((left, right) => left.layer - right.layer || left.sourceIndex - right.sourceIndex)
  const rows = new Map<number, number>()
  for (const node of nodes) {
    node.row = rows.get(node.layer) ?? 0
    rows.set(node.layer, node.row + 1)
  }
  return {
    nodes,
    edges,
    layers: nodes.length ? Math.max(...nodes.map((node) => node.layer)) + 1 : 0,
    invalid
  }
}
