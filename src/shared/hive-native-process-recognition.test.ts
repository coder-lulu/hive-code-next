import { describe, expect, it } from 'vitest'
import {
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from './agent-process-recognition'

describe('Hive native Pi uses the canonical process identity', () => {
  it.each(['pi', '/usr/local/bin/pi', String.raw`C:\Users\dev\bin\pi.cmd`])(
    'keeps the explicit Pi executable separate from the Hive launcher: %s',
    (command) => {
      expect(recognizeAgentProcess(command)).toEqual({ agent: 'pi', processName: 'pi' })
      expect(recognizeAgentProcessFromCommandLine(`${command} --resume session`)).toEqual({
        agent: 'pi',
        processName: 'pi'
      })
    }
  )

  it.each(['hive hive-ai', 'hive.cmd hive-ai', 'node /usr/local/bin/hive hive-ai'])(
    'recognizes the explicit Hive agent launcher: %s',
    (command) => {
      expect(recognizeAgentProcessFromCommandLine(command)).toEqual({
        agent: 'hivecode',
        processName: 'hive'
      })
    }
  )

  it.each([
    'hive',
    'hive status',
    'hive terminal list',
    'hive list --label hive-ai',
    'hive.cmd --help',
    'node /usr/local/bin/hive status',
    'node /tmp/server.js "hive hive-ai"'
  ])('does not infer agent ownership from a generic Hive command: %s', (command) => {
    expect(recognizeAgentProcessFromCommandLine(command)).toBeNull()
  })

  it.each([
    ['D:/HiveCode/resources/native-pi/win32-x64', 'node.exe'],
    ['C:/Program Files/HiveCode/resources/native-pi/win32-arm64', 'node.exe'],
    ['/Applications/HiveCode.app/Contents/Resources/native-pi/darwin-arm64', 'node'],
    ['/opt/hive/resources/native-pi/linux-x64', 'node']
  ])('recognizes the canonical entrypoint after the preload: %s', (directory, node) => {
    const command = `"${directory}/${node}" --import "file://${directory}/launcher.mjs" "${directory}/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" --session-dir sessions`
    expect(recognizeAgentProcessFromCommandLine(command)).toEqual({
      agent: 'pi',
      processName: 'pi'
    })
  })

  it.each([
    'node /tmp/launcher.mjs',
    'node --import /tmp/launcher.mjs /tmp/server.js',
    'node /tmp/server.js /opt/hive/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    'node --import /tmp/launcher.mjs /opt/hive/node_modules/@earendil-works/pi-coding-agent/dist/cli.js.backup'
  ])('rejects unrelated scripts and prompt text: %s', (command) => {
    expect(recognizeAgentProcessFromCommandLine(command)).toBeNull()
  })
})
