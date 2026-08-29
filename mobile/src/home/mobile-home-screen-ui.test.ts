import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(new URL('./MobileHomeScreen.tsx', import.meta.url), 'utf8')

describe('mobile home product UI wiring', () => {
  it('keeps the HiveCode home surface connected to the current themed components', () => {
    expect(homeSource).toContain("from './MobileHomeToolbar'")
    expect(homeSource).toContain("from './MobileCloudWorkPreview'")
    expect(homeSource).toContain("from './MobileHomeDrawer'")
    expect(homeSource).toContain("from './MobileComputerEmptyState'")
    expect(homeSource).not.toContain("from './MobileHomeTopBar'")
  })
})
