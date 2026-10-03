// Public compatibility surface for the desktop home projection. Keeping this
// path stable lets Landing and downstream tests consume the V3 model while the
// implementation stays split into focused modules under the same directory.
export * from './desktop-home-model-types'
export {
  buildDesktopHomeModel,
  findDesktopHomeWorkspace,
  formatHomeRelativeTime
} from './desktop-home-model-builder'
