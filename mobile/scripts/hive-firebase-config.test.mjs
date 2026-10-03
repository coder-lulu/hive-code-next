import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const configure = require('../app.config.js')

describe('Hive Firebase build configuration', () => {
  it('keeps Firebase credentials absent unless an absolute build secret path is injected', () => {
    expect(configure({ config: { android: { package: 'com.example.mobile' } } })).toEqual({
      android: { package: 'com.example.mobile' }
    })
    expect(() => configure.firebaseServicesFile('google-services.json')).toThrow(
      'must be an absolute path'
    )
  })

  it('passes an existing absolute build-time file path without copying its contents', () => {
    const file = import.meta.filename
    expect(configure.firebaseServicesFile(file)).toBe(file)
  })
})
