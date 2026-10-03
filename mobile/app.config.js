const { existsSync } = require('node:fs')
const { isAbsolute, resolve } = require('node:path')

function firebaseServicesFile(value) {
  if (!value) {
    return undefined
  }
  const configured = value.trim()
  if (!configured || !isAbsolute(configured)) {
    throw new Error('FIREBASE_GOOGLE_SERVICES_FILE must be an absolute path')
  }
  const file = resolve(configured)
  if (!existsSync(file)) {
    throw new Error('FIREBASE_GOOGLE_SERVICES_FILE does not exist')
  }
  return file
}

module.exports = ({ config }) => {
  const googleServicesFile = firebaseServicesFile(process.env.FIREBASE_GOOGLE_SERVICES_FILE)
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {})
    }
  }
}

module.exports.firebaseServicesFile = firebaseServicesFile
