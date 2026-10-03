const release = require('./electron-builder.config.cjs')

// CI discards these packages after smoke tests; keep release compression unchanged.
module.exports = {
  ...release,
  deb: {
    ...release.deb,
    compression: 'gz',
    fpm: [...(release.deb.fpm ?? []), '--deb-compression-level=1']
  },
  rpm: {
    ...release.rpm,
    compression: 'gzip',
    fpm: [...(release.rpm.fpm ?? []), '--rpm-compression-level=1']
  }
}
