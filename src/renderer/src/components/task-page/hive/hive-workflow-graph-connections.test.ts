import { describe, expect, it } from 'vitest'
import { workflowGraphTopology } from './hive-workflow-graph-topology'
import {
  workflowGraphChannels,
  workflowGraphConnections,
  type WorkflowGraphMeasurement,
  type WorkflowGraphBox
} from './hive-workflow-graph-connections'
import { branchingGraphStages, graphStages } from './hive-workflow-graph.test-fixtures'

function coordinates(d: string): [number, number][] {
  const values = d
    .split(/[ML]/)
    .filter(Boolean)
    .map((value) => value.trim().split(' ').map(Number))
  return values.map((values) => [values[0], values[1]])
}
function passesThrough(points: [number, number][], box: WorkflowGraphBox) {
  return points.slice(1).some(([x, y], index) => {
    const [previousX, previousY] = points[index]
    return x === previousX
      ? x > box.left &&
          x < box.left + box.width &&
          Math.min(y, previousY) < box.top + box.height &&
          Math.max(y, previousY) > box.top
      : y === previousY &&
          y > box.top &&
          y < box.top + box.height &&
          Math.min(x, previousX) < box.left + box.width &&
          Math.max(x, previousX) > box.left
  })
}
describe('measured workflow relationship connections', () => {
  it('keeps the adjacent tester return as a U-shaped route with distinct vertical rails', () => {
    const graph = workflowGraphTopology(graphStages())
    const boxes = Object.fromEntries(
      graph.nodes.map((node) => [
        node.key,
        { left: 12 + node.layer * 192, top: 12, width: 144, height: 100 }
      ])
    )
    const returned = workflowGraphConnections(graph, {
      orientation: 'horizontal',
      width: 768,
      height: 200,
      layerGap: 48,
      laneGap: 12,
      boxes
    }).find((edge) => edge.kind === 'return')!
    const points = coordinates(returned.d)
    expect(points[1][0]).not.toBe(points[3][0])
    expect(Math.abs(points[3][0] - points[2][0])).toBeGreaterThan(0)
    expect(points[2][1]).toBe(points[3][1])
    const segments = points.slice(1).map((end, index) => ({ start: points[index], end }))
    for (const [index, segment] of segments.entries()) {
      expect(
        segments
          .slice(index + 1)
          .some(
            (other) =>
              JSON.stringify(segment.start) === JSON.stringify(other.end) &&
              JSON.stringify(segment.end) === JSON.stringify(other.start)
          )
      ).toBe(false)
    }
    expect(points.at(-1)).toEqual([boxes[returned.to].left + boxes[returned.to].width, 62])
    for (const [key, box] of Object.entries(boxes)) {
      if (key !== returned.from && key !== returned.to) {
        expect(passesThrough(points, box)).toBe(false)
      }
    }
  })
  it('draws every dependency and return across branches without crossing other nodes', () => {
    const graph = workflowGraphTopology(branchingGraphStages())
    const boxes = Object.fromEntries(
      graph.nodes.map((node) => [
        node.key,
        { left: 20 + node.layer * 208, top: 40 + node.row * 148, width: 160, height: 100 }
      ])
    )
    const measure: WorkflowGraphMeasurement = {
      orientation: 'horizontal',
      width: 840,
      height: 400,
      layerGap: 48,
      laneGap: 12,
      boxes
    }
    const connections = workflowGraphConnections(graph, measure)
    expect(connections).toHaveLength(graph.edges.length)
    for (const edge of connections) {
      const points = coordinates(edge.d)
      expect(points.flat().every(Number.isFinite)).toBe(true)
      for (const [key, box] of Object.entries(boxes)) {
        if (key !== edge.from && key !== edge.to) {
          expect(passesThrough(points, box)).toBe(false)
        }
      }
    }
    expect(workflowGraphChannels(graph).forward).toEqual(['2:product'])
    expect(
      coordinates(connections.find((edge) => edge.kind === 'return')!.d).some(([, y]) => y > 288)
    ).toBe(true)
  })
  it('separates forward and configured return lanes on narrow vertical layouts', () => {
    const graph = workflowGraphTopology(graphStages())
    const boxes = Object.fromEntries(
      graph.nodes.map((node, index) => [
        node.key,
        { left: 24, top: 12 + index * 148, width: 220, height: 100 }
      ])
    )
    const connections = workflowGraphConnections(graph, {
      orientation: 'vertical',
      width: 300,
      height: 600,
      layerGap: 48,
      laneGap: 12,
      boxes
    })
    expect(connections).toHaveLength(4)
    for (const edge of connections) {
      const points = coordinates(edge.d)
      expect(points[1][0]).toBe(
        edge.kind === 'return'
          ? 12
          : 244 + (56 * (['0:product', '1:developer', '2:tester'].indexOf(edge.from) + 1)) / 4
      )
      for (const [key, box] of Object.entries(boxes)) {
        if (key !== edge.from && key !== edge.to) {
          expect(passesThrough(points, box)).toBe(false)
        }
      }
    }
  })
  it('never invents geometry for unavailable measurements or missing original nodes', () => {
    const graph = workflowGraphTopology(graphStages())
    const measure: WorkflowGraphMeasurement = {
      orientation: 'vertical',
      width: 0,
      height: 0,
      layerGap: 48,
      laneGap: 12,
      boxes: {}
    }
    expect(workflowGraphConnections(graph, measure)).toEqual([])
    expect(
      workflowGraphConnections(graph, {
        ...measure,
        width: 100,
        height: 100,
        boxes: { unrelated: { left: 10, top: 10, width: 10, height: 10 } }
      })
    ).toEqual([])
  })
})
