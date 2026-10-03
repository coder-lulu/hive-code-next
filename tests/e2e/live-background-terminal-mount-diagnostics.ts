import { randomUUID } from 'node:crypto'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalRead, RuntimeTerminalSummary } from '../../src/shared/runtime-types'
import { readTerminalPtyWriteEntries } from './helpers/terminal-pty-write-spy'

export async function logTerminalInputDiagnostic(
  app: ElectronApplication,
  page: Page,
  client: RuntimeClient,
  terminal: RuntimeTerminalSummary,
  marker: string
): Promise<void> {
  try {
    const before = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
      terminal: terminal.handle,
      limit: 300
    })
    const transport = await page.evaluate(
      async (ptyId) => ({
        driver: (await window.api.runtime.getTerminalDrivers()).find(
          (entry) => entry.ptyId === ptyId
        ),
        providerHasPty: await window.api.pty.hasPty(ptyId),
        mainBufferSnapshot: await window.api.pty.getMainBufferSnapshot(ptyId, {
          scrollbackRows: 30
        })
      }),
      terminal.ptyId!
    )
    const diagnosticMarker = `SETUP_DIAGNOSTIC_${randomUUID()}`
    const accepted = await page.evaluate(
      ({ ptyId, marker }) => window.api.pty.writeAccepted(ptyId, `${marker}\r`, 'driving'),
      { ptyId: terminal.ptyId!, marker: diagnosticMarker }
    )
    const read = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
      terminal: terminal.handle,
      limit: 300
    })
    const renderer = await page.evaluate((tabId) => {
      const pane = window.__paneManagers?.get(tabId)?.getActivePane?.()
      const buffer = pane?.terminal.buffer.active
      return {
        viewportText:
          pane && buffer
            ? Array.from(
                { length: pane.terminal.rows },
                (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
              ).join('\n')
            : null,
        accessibilityText: pane?.container.querySelector('.xterm-accessibility-tree')?.textContent,
        delivery: window.api.pty.getRendererDeliveryDebugSnapshot()
      }
    }, terminal.tabId)
    console.log(
      'SETUP_INPUT_DIAGNOSTIC',
      JSON.stringify({
        handle: terminal.handle,
        ptyId: terminal.ptyId,
        incarnationId: terminal.incarnationId,
        marker,
        diagnosticMarker,
        diagnosticWriteAccepted: accepted,
        runtimeOutputBeforeDiagnostic: before.result.terminal.tail.join('\n'),
        runtimeOutput: read.result.terminal.tail.join('\n'),
        transport,
        ...renderer,
        ipcWrites: await readTerminalPtyWriteEntries(app)
      })
    )
  } catch (error) {
    console.log('SETUP_INPUT_DIAGNOSTIC_ERROR', String(error))
  }
}
