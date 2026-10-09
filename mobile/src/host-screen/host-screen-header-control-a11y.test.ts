import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import {
  PRESSABLE_TAGS,
  readAttribute,
  type Read
} from '../mobile-web-shell/pressable-control-source-reader'

/**
 * This header renders distinct phone and embedded toolbars. Every concrete control in both must
 * expose a role and a name, while the product-specific phone hierarchy remains free to carry a
 * smaller control set than the embedded workspace sidebar.
 *
 * A spread reads as unknown rather than absent: a control whose handler or whose accessibility
 * props arrive through one is a control this scan cannot judge, so it fails both rules and says so,
 * instead of passing quietly or reading as an unnamed control.
 */
const HEADER = 'src/host-screen/host-screen-header.tsx'
const MOBILE_ROOT = join(import.meta.dirname, '..', '..')

type Control = { line: number; press: Read; role: Read; label: Read }

function headerControls(): Control[] {
  const source = ts.createSourceFile(
    HEADER,
    readFileSync(join(MOBILE_ROOT, HEADER), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const found: Control[] = []
  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = ts.isJsxElement(node) ? node.openingElement : node
      if (PRESSABLE_TAGS.has(element.tagName.getText())) {
        const press = readAttribute(element, 'onPress')
        // A Pressable with no handler is decoration; one whose handler is spread in is a control.
        if (!press.known || press.value !== '') {
          found.push({
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            press,
            role: readAttribute(element, 'accessibilityRole'),
            label: readAttribute(element, 'accessibilityLabel')
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function show(read: Read): string {
  if (!read.known) {
    return 'spread'
  }
  return read.value || 'none'
}

function describeControl(control: Control): string {
  return `${HEADER}:${control.line} press=${show(control.press)} role=${show(control.role)} label=${show(
    control.label
  )}`
}

const CONTROLS = headerControls()

describe('host header controls carry a role and a name', () => {
  it('finds controls in a source that defines both product toolbars', () => {
    const source = readFileSync(join(MOBILE_ROOT, HEADER), 'utf8')
    expect(source).toContain('function PhoneHostScreenHeader')
    expect(source).toContain('function EmbeddedHostScreenHeader')
    expect(CONTROLS.length).toBeGreaterThan(0)
  })

  it('gives every pressable control the button role', () => {
    expect(
      CONTROLS.filter((control) => !control.role.known || control.role.value !== 'button').map(
        describeControl
      )
    ).toEqual([])
  })

  it('names every pressable control', () => {
    expect(
      CONTROLS.filter((control) => !control.label.known || control.label.value === '').map(
        describeControl
      )
    ).toEqual([])
  })
})
