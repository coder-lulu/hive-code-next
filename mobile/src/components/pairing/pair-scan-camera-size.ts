const PAIR_SCAN_CAMERA_MAX_SIZE = 216

export function resolvePairScanCameraSize(
  viewportWidth: number,
  horizontalPadding: number
): number {
  return Math.max(0, Math.min(PAIR_SCAN_CAMERA_MAX_SIZE, viewportWidth - horizontalPadding * 2))
}
