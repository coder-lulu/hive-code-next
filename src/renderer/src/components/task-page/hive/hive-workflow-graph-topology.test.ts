import { describe, expect, it } from 'vitest'
import { workflowGraphTopology } from './hive-workflow-graph-topology'
import { branchingGraphStages, graphStages } from './hive-workflow-graph.test-fixtures'

describe('workflow graph layout projection', () => {
  it('layers branches and joins while keeping authored stage labels and input intact', () => {
    const stages = branchingGraphStages()
    const original = structuredClone(stages)
    const graph = workflowGraphTopology(stages)
    expect(graph.invalid).toBe(false)
    expect(graph.layers).toBe(4)
    expect(
      graph.nodes.map((node) => [node.stage.stageRef, node.sourceIndex, node.layer, node.row])
    ).toEqual([
      ['product', 2, 0, 0],
      ['developer-other', 1, 1, 0],
      ['developer', 4, 1, 1],
      ['tester', 3, 2, 0],
      ['ops', 0, 3, 0]
    ])
    expect(graph.edges.filter((edge) => edge.kind === 'dependency')).toHaveLength(6)
    expect(graph.edges.filter((edge) => edge.kind === 'return')).toHaveLength(1)
    expect(stages).toEqual(original)
  })
  it('keeps configured return edges outside dependency ordering', () => {
    const stages = graphStages()
    const graph = workflowGraphTopology(stages)
    expect(graph.invalid).toBe(false)
    expect(graph.nodes.map((node) => node.layer)).toEqual([0, 1, 2, 3])
    expect(graph.edges.at(-2)?.kind).toBe('return')
  })
  it.each(['cycle', 'self', 'missing', 'duplicate-stage', 'duplicate-dependency'])(
    'preserves every authored node for an invalid %s draft without looping',
    (kind) => {
      const stages = graphStages()
      if (kind === 'cycle') {
        stages[0] = { ...stages[0], dependsOn: ['ops'] }
      }
      if (kind === 'self') {
        stages[0] = { ...stages[0], dependsOn: ['product'] }
      }
      if (kind === 'missing') {
        stages[2] = { ...stages[2], dependsOn: ['missing'] }
      }
      if (kind === 'duplicate-stage') {
        stages[1] = { ...stages[1], stageRef: 'product' }
      }
      if (kind === 'duplicate-dependency') {
        stages[1] = { ...stages[1], dependsOn: ['product', 'product'] }
      }
      const graph = workflowGraphTopology(stages)
      expect(graph.invalid).toBe(true)
      expect(graph.nodes.map((node) => node.stage)).toEqual(stages)
      expect(new Set(graph.nodes.map((node) => node.key)).size).toBe(stages.length)
    }
  )
  it('lays out all 32 authored stages, including large joins, in bounded passes', () => {
    const [first] = graphStages()
    const stages = Array.from({ length: 32 }, (_, index) => ({
      ...first,
      stageRef: `stage-${index}`,
      dependsOn: Array.from({ length: index }, (_, dependency) => `stage-${dependency}`)
    }))
    const graph = workflowGraphTopology(stages)
    expect(graph.invalid).toBe(false)
    expect(graph.nodes).toHaveLength(32)
    expect(graph.edges).toHaveLength(496)
    expect(graph.layers).toBe(32)
    expect(workflowGraphTopology([])).toEqual({ nodes: [], edges: [], layers: 0, invalid: false })
  })
})
