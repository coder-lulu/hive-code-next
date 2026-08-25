import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const patches = [
  {
    buildSettingsMarker: "+    'defines': [ 'NAPI_CPP_EXCEPTIONS' ]",
    name: 'node-pty',
    source: readFileSync(resolve(import.meta.dirname, '../patches/node-pty@1.1.0.patch'), 'utf8')
  },
  {
    buildSettingsMarker: '+      "defines": [ "NAPI_CPP_EXCEPTIONS" ]',
    name: 'windows-process-tree',
    source: readFileSync(
      resolve(import.meta.dirname, '../patches/@vscode__windows-process-tree@0.8.0.patch'),
      'utf8'
    )
  }
]

describe('Windows native build patch contract', () => {
  it.each(patches)(
    'inlines node-addon-api build settings for $name',
    ({ buildSettingsMarker, source }) => {
      expect(source).toContain(buildSettingsMarker)
      expect(source).not.toMatch(/^\+.*node-addon-api.*targets/m)
    }
  )

  it('keeps process-tree intermediates below the Windows path limit', () => {
    expect(patches[1].source).toContain(
      '$(TEMP)\\\\hivecode-wpt\\\\$(ProjectGuid)\\\\$(Platform)\\\\$(Configuration)'
    )
  })

  it('preserves node-pty macOS exception settings', () => {
    expect(patches[0].source).toContain("+          'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'")
    expect(patches[0].source).toContain("+          'CLANG_CXX_LIBRARY': 'libc++'")
    expect(patches[0].source).toContain("+          'MACOSX_DEPLOYMENT_TARGET': '10.7'")
  })
})
