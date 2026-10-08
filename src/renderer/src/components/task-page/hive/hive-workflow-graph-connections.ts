import type { WorkflowGraphEdge, WorkflowGraphTopology } from './hive-workflow-graph-topology'

export type WorkflowGraphBox = { left: number; top: number; width: number; height: number }
export type WorkflowGraphMeasurement = {
  orientation: 'horizontal' | 'vertical'
  width: number
  height: number
  layerGap: number
  laneGap: number
  boxes: Record<string, WorkflowGraphBox>
}

export function workflowGraphChannels(topology: WorkflowGraphTopology) {
  const byKey = new Map(topology.nodes.map((node) => [node.key, node]))
  const dependencies = new Set<string>()
  const returns = new Set<string>()
  for (const edge of topology.edges) {
    if (edge.kind === 'return') {
      returns.add(edge.from)
    } else if ((byKey.get(edge.to)?.layer ?? 0) !== (byKey.get(edge.from)?.layer ?? 0) + 1) {
      dependencies.add(edge.from)
    }
  }
  return {
    forward: topology.nodes.filter((node) => dependencies.has(node.key)).map((node) => node.key),
    returns: topology.nodes.filter((node) => returns.has(node.key)).map((node) => node.key),
    sources: topology.nodes
      .filter((node) =>
        topology.edges.some((edge) => edge.kind === 'dependency' && edge.from === node.key)
      )
      .map((node) => node.key)
  }
}

function path(points: readonly [number, number][]) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ')
}

export function workflowGraphConnections(
  topology: WorkflowGraphTopology,
  measure: WorkflowGraphMeasurement
) {
  const boxes = Object.values(measure.boxes)
  if (
    !boxes.length ||
    ![measure.width, measure.height, measure.layerGap, measure.laneGap].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    return []
  }
  const channels = workflowGraphChannels(topology)
  const top = Math.min(...boxes.map((box) => box.top))
  const bottom = Math.max(...boxes.map((box) => box.top + box.height))
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.left + box.width))
  const fraction = (keys: readonly string[], key: string) =>
    (keys.indexOf(key) + 1) / (keys.length + 1)
  const connection = (edge: WorkflowGraphEdge): string | null => {
    const source = measure.boxes[edge.from]
    const target = measure.boxes[edge.to]
    if (
      !source ||
      !target ||
      ![...Object.values(source), ...Object.values(target)].every(Number.isFinite)
    ) {
      return null
    }
    const sourceY = source.top + source.height / 2
    const targetY = target.top + target.height / 2
    if (measure.orientation === 'vertical') {
      if (edge.kind === 'return') {
        const lane = left * fraction(channels.returns, edge.from)
        return path([
          [source.left, sourceY],
          [lane, sourceY],
          [lane, targetY],
          [target.left, targetY]
        ])
      }
      const lane = right + (measure.width - right) * fraction(channels.sources, edge.from)
      return path([
        [source.left + source.width, sourceY],
        [lane, sourceY],
        [lane, targetY],
        [target.left + target.width, targetY]
      ])
    }
    if (edge.kind === 'return') {
      const lane = bottom + (measure.height - bottom) * fraction(channels.returns, edge.from)
      const sourceX = Math.max(measure.laneGap / 2, source.left - measure.layerGap / 3)
      const targetX = Math.min(
        measure.width - measure.laneGap / 2,
        target.left + target.width + measure.layerGap / 3
      )
      return path([
        [source.left, sourceY],
        [sourceX, sourceY],
        [sourceX, lane],
        [targetX, lane],
        [targetX, targetY],
        [target.left + target.width, targetY]
      ])
    }
    const sourceX = source.left + source.width
    if (
      !channels.forward.includes(edge.from) ||
      (target.left - sourceX <= measure.layerGap * 1.5 && target.left > sourceX)
    ) {
      const middle = (sourceX + target.left) / 2
      return path([
        [sourceX, sourceY],
        [middle, sourceY],
        [middle, targetY],
        [target.left, targetY]
      ])
    }
    const lane = top * fraction(channels.forward, edge.from)
    const exit = Math.min(measure.width - measure.laneGap / 2, sourceX + measure.layerGap / 2)
    const entry = Math.max(measure.laneGap / 2, target.left - measure.layerGap / 2)
    return path([
      [sourceX, sourceY],
      [exit, sourceY],
      [exit, lane],
      [entry, lane],
      [entry, targetY],
      [target.left, targetY]
    ])
  }
  return topology.edges.flatMap((edge) => {
    const d = connection(edge)
    return d ? [{ ...edge, d }] : []
  })
}
