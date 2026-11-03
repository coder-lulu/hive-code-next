import { describe, expect, it } from 'vitest'
import { resolveConnectorOrigin } from './connector-origin'
describe('product connector source', () => {
  it('has no packaged source or runtime override without a product service contract', () => {
    expect(resolveConnectorOrigin({}, true)).toBeNull()
    expect(
      resolveConnectorOrigin({ ORCA_CONNECTOR_URL: 'https://connector.example.test' }, true)
    ).toBeNull()
  })
  it('requires an explicit valid development origin', () => {
    expect(resolveConnectorOrigin({}, false)).toBeNull()
    expect(
      resolveConnectorOrigin({ ORCA_CONNECTOR_URL: 'https://connector.example.test' }, false)
    ).toBe('https://connector.example.test')
    expect(
      resolveConnectorOrigin({ ORCA_CONNECTOR_URL: 'http://remote.example.test' }, false)
    ).toBeNull()
  })
})
