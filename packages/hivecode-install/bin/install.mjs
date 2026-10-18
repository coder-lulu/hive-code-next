#!/usr/bin/env node
import { run } from '../lib/installer.mjs'

try {
  process.exitCode = await run(process.argv.slice(2))
} catch (error) {
  console.error(`HiveCode installer: ${error.message}`)
  process.exitCode = 1
}
