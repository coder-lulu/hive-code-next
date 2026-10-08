import { useLayoutEffect, useRef, useState } from 'react'
import type { WorkflowGraphTopology } from './hive-workflow-graph-topology'
import type { WorkflowGraphBox, WorkflowGraphMeasurement } from './hive-workflow-graph-connections'

type MeasuredGraph = { key: string; settled: boolean; measurement: WorkflowGraphMeasurement }

export function useHiveWorkflowGraphMeasurement(topology: WorkflowGraphTopology) {
  const canvas = useRef<HTMLDivElement>(null)
  const nodes = useRef<HTMLOListElement>(null)
  const nodeWidth = useRef<HTMLSpanElement>(null)
  const gaps = useRef<HTMLSpanElement>(null)
  const [measured, setMeasured] = useState<MeasuredGraph | null>(null)
  const key = JSON.stringify([
    topology.nodes.map((node) => [node.key, node.layer, node.row]),
    topology.edges
  ])
  const current = useRef({ topology, key })
  const orientation = measured?.key === key ? measured.measurement.orientation : 'vertical'
  useLayoutEffect(() => {
    current.current = { topology, key }
  })
  useLayoutEffect(() => {
    const element = canvas.current
    const list = nodes.current
    if (!element || !list) {
      return
    }
    let disposed = false
    let frame: number | null = null
    const measure = () => {
      frame = null
      if (disposed || current.current.key !== key) {
        return
      }
      const outer = element.getBoundingClientRect()
      const probe = nodeWidth.current?.getBoundingClientRect()
      const gap = gaps.current?.getBoundingClientRect()
      if (
        !probe ||
        !gap ||
        ![outer.width, outer.height, probe.width, gap.width, gap.height].every(
          (value) => Number.isFinite(value) && value > 0
        )
      ) {
        return
      }
      const byKey: Record<string, WorkflowGraphBox> = {}
      for (const node of list.querySelectorAll<HTMLElement>('[data-workflow-node-key]')) {
        const id = node.dataset.workflowNodeKey
        if (!id) {
          continue
        }
        const box = node.getBoundingClientRect()
        if (![box.width, box.height].every((value) => Number.isFinite(value) && value > 0)) {
          return
        }
        byKey[id] = {
          left: box.left - outer.left,
          top: box.top - outer.top,
          width: box.width,
          height: box.height
        }
      }
      if (Object.keys(byKey).length !== current.current.topology.nodes.length) {
        return
      }
      const layers = current.current.topology.layers
      const nextOrientation =
        outer.width >= layers * probe.width + Math.max(0, layers - 1) * gap.width + gap.height * 2
          ? 'horizontal'
          : 'vertical'
      const next: MeasuredGraph = {
        key,
        settled: element.dataset.orientation === nextOrientation,
        measurement: {
          orientation: nextOrientation,
          width: outer.width,
          height: outer.height,
          layerGap: gap.width,
          laneGap: gap.height,
          boxes: byKey
        }
      }
      setMeasured((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      )
    }
    const schedule = () => {
      if (!disposed && frame === null) {
        frame = requestAnimationFrame(measure)
      }
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(element)
    observer?.observe(list)
    if (nodeWidth.current) {
      observer?.observe(nodeWidth.current)
    }
    if (gaps.current) {
      observer?.observe(gaps.current)
    }
    for (const node of list.querySelectorAll('[data-workflow-node-key]')) {
      observer?.observe(node)
    }
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [key, orientation])
  return {
    canvas,
    nodes,
    nodeWidth,
    gaps,
    orientation,
    measurement: measured?.key === key && measured.settled ? measured.measurement : null
  }
}
