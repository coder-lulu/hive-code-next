import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolvePairScanCameraSize } from './pair-scan-camera-size'

describe('pair scan camera size', () => {
  it('caps the square viewport while preserving narrow-screen padding', () => {
    expect(resolvePairScanCameraSize(405, 20)).toBe(216)
    expect(resolvePairScanCameraSize(240, 20)).toBe(200)
    expect(resolvePairScanCameraSize(36, 20)).toBe(0)
  })

  it('applies the resolved dimension to both axes of the camera viewport', () => {
    const source = readFileSync(new URL('../../../app/pair-scan.tsx', import.meta.url), 'utf8')

    expect(source).toContain('{ width: cameraSize, height: cameraSize }')
    expect(source).not.toContain('aspectRatio: 1')
  })
})
