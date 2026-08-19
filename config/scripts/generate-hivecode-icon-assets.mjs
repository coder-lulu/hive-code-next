#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import {
  buildWindowsIcoFromPng,
  encodePng,
  findOpaqueBounds,
  resizeImage
} from './trim-windows-icon-source.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const SOURCE_PATH = join(REPO_ROOT, 'resources', 'icon-source', 'hivecode-logo-master.png')
const LIGHT_BACKGROUND = { r: 234, g: 242, b: 255, a: 255 }
const LIGHT_BORDER = { r: 190, g: 214, b: 255, a: 255 }
const SOURCE_BACKGROUND_THRESHOLD = 32

function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: Buffer.from(png.data) }
}

function cropImage(image, bounds) {
  const data = Buffer.alloc(bounds.width * bounds.height * 4)
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.minY + y) * image.width + bounds.minX) * 4
    const targetStart = y * bounds.width * 4
    image.data.copy(data, targetStart, sourceStart, sourceStart + bounds.width * 4)
  }
  return { width: bounds.width, height: bounds.height, data }
}

function isSourceBackground(data, pixelIndex) {
  const offset = pixelIndex * 4
  return (
    Math.max(255 - data[offset], 255 - data[offset + 1], 255 - data[offset + 2]) <
    SOURCE_BACKGROUND_THRESHOLD
  )
}

export function extractLogoForeground(source) {
  const pixelCount = source.width * source.height
  const background = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const enqueue = (pixelIndex) => {
    if (background[pixelIndex] || !isSourceBackground(source.data, pixelIndex)) {
      return
    }
    background[pixelIndex] = 1
    queue[queueEnd] = pixelIndex
    queueEnd += 1
  }

  for (let x = 0; x < source.width; x += 1) {
    enqueue(x)
    enqueue((source.height - 1) * source.width + x)
  }
  for (let y = 0; y < source.height; y += 1) {
    enqueue(y * source.width)
    enqueue(y * source.width + source.width - 1)
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart]
    queueStart += 1
    const x = pixelIndex % source.width
    const y = Math.floor(pixelIndex / source.width)
    if (x > 0) {
      enqueue(pixelIndex - 1)
    }
    if (x + 1 < source.width) {
      enqueue(pixelIndex + 1)
    }
    if (y > 0) {
      enqueue(pixelIndex - source.width)
    }
    if (y + 1 < source.height) {
      enqueue(pixelIndex + source.width)
    }
  }

  const foreground = {
    width: source.width,
    height: source.height,
    data: Buffer.from(source.data)
  }
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    foreground.data[pixelIndex * 4 + 3] = background[pixelIndex] ? 0 : 255
  }
  const bounds = findOpaqueBounds(foreground, 0)
  if (!bounds) {
    throw new Error('HiveCode logo source did not contain a foreground mark.')
  }
  return cropImage(foreground, bounds)
}

function createCanvas(size, color = { r: 0, g: 0, b: 0, a: 0 }) {
  const data = Buffer.alloc(size * size * 4)
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4
    data[offset] = color.r
    data[offset + 1] = color.g
    data[offset + 2] = color.b
    data[offset + 3] = color.a
  }
  return { width: size, height: size, data }
}

function blendPixel(target, targetOffset, source, sourceOffset) {
  const sourceAlpha = source[sourceOffset + 3] / 255
  if (sourceAlpha === 0) {
    return
  }
  const targetAlpha = target[targetOffset + 3] / 255
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  for (let channel = 0; channel < 3; channel += 1) {
    const premultiplied =
      source[sourceOffset + channel] * sourceAlpha +
      target[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)
    target[targetOffset + channel] = Math.round(premultiplied / outputAlpha)
  }
  target[targetOffset + 3] = Math.round(outputAlpha * 255)
}

function compositeCentered(canvas, image) {
  const offsetX = Math.floor((canvas.width - image.width) / 2)
  const offsetY = Math.floor((canvas.height - image.height) / 2)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sourceOffset = (y * image.width + x) * 4
      const targetOffset = ((offsetY + y) * canvas.width + offsetX + x) * 4
      blendPixel(canvas.data, targetOffset, image.data, sourceOffset)
    }
  }
  return canvas
}

function renderMark(mark, size, heightRatio, background) {
  const canvas = createCanvas(size, background)
  const height = Math.round(size * heightRatio)
  const width = Math.round((mark.width / mark.height) * height)
  return compositeCentered(canvas, resizeImage(mark, width, height))
}

function roundedRectangleCoverage(x, y, size, inset, radius) {
  const half = size / 2 - inset
  const localX = Math.abs(x + 0.5 - size / 2) - (half - radius)
  const localY = Math.abs(y + 0.5 - size / 2) - (half - radius)
  const outside = Math.hypot(Math.max(localX, 0), Math.max(localY, 0))
  const inside = Math.min(Math.max(localX, localY), 0)
  const distance = outside + inside - radius
  return Math.max(0, Math.min(1, 0.5 - distance))
}

function paintRoundedRectangle(canvas, inset, radius, color) {
  const source = Buffer.from([color.r, color.g, color.b, color.a])
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const coverage = roundedRectangleCoverage(x, y, canvas.width, inset, radius)
      if (coverage === 0) {
        continue
      }
      source[3] = Math.round(color.a * coverage)
      blendPixel(canvas.data, (y * canvas.width + x) * 4, source, 0)
    }
  }
}

function renderDesktopIcon(mark, size) {
  const canvas = createCanvas(size)
  paintRoundedRectangle(canvas, size * 0.022, size * 0.19, LIGHT_BORDER)
  paintRoundedRectangle(canvas, size * 0.029, size * 0.183, LIGHT_BACKGROUND)
  const height = Math.round(size * 0.74)
  const width = Math.round((mark.width / mark.height) * height)
  return compositeCentered(canvas, resizeImage(mark, width, height))
}

function renderTrayTemplate(mark, width, height) {
  const whiteMark = {
    width: mark.width,
    height: mark.height,
    data: Buffer.alloc(mark.width * mark.height * 4)
  }
  for (let index = 0; index < mark.width * mark.height; index += 1) {
    const offset = index * 4
    const isWhiteGlyph =
      mark.data[offset + 3] > 0 &&
      Math.min(mark.data[offset], mark.data[offset + 1], mark.data[offset + 2]) >= 228
    whiteMark.data[offset + 3] = isWhiteGlyph ? 255 : 0
  }
  const bounds = findOpaqueBounds(whiteMark, 0)
  if (!bounds) {
    throw new Error('HiveCode logo source did not contain the white H glyph.')
  }
  const glyph = cropImage(whiteMark, bounds)
  const targetHeight = height - 2
  const targetWidth = Math.min(width - 2, Math.round((glyph.width / glyph.height) * targetHeight))
  const resized = resizeImage(glyph, targetWidth, targetHeight)
  const data = Buffer.alloc(width * height * 4)
  const offsetX = Math.floor((width - targetWidth) / 2)
  const offsetY = Math.floor((height - targetHeight) / 2)
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceOffset = (y * targetWidth + x) * 4
      const targetOffset = ((offsetY + y) * width + offsetX + x) * 4
      data[targetOffset + 3] = resized.data[sourceOffset + 3]
    }
  }
  return { width, height, data }
}

function encodeIcns(icon) {
  const entries = [
    ['ic10', 1024],
    ['ic09', 512],
    ['ic08', 256],
    ['ic07', 128],
    ['icp6', 64],
    ['icp5', 32],
    ['icp4', 16]
  ].map(([type, size]) => {
    const payload = encodePng(size === icon.width ? icon : resizeImage(icon, size, size))
    const entry = Buffer.alloc(payload.length + 8)
    entry.write(type, 0, 4, 'ascii')
    entry.writeUInt32BE(entry.length, 4)
    payload.copy(entry, 8)
    return entry
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4)
  return Buffer.concat([header, ...entries])
}

function writePng(relativePath, image) {
  const outputPath = join(REPO_ROOT, relativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, encodePng(image))
  process.stdout.write(`Generated ${relativePath}\n`)
}

export function generateHiveCodeIconAssets() {
  const source = decodePng(readFileSync(SOURCE_PATH))
  if (source.width !== 1024 || source.height !== 1024) {
    throw new Error('HiveCode logo master must be a 1024x1024 PNG.')
  }
  const mark = extractLogoForeground(source)
  const desktopIcon = renderDesktopIcon(mark, 1024)
  const mobileIcon = renderMark(mark, 1024, 0.76, LIGHT_BACKGROUND)
  const productLogo = renderMark(mark, 512, 0.94)
  const adaptiveForeground = renderMark(mark, 1024, 0.61)
  const splashIcon = renderMark(mark, 512, 0.82)

  writePng('resources/product-logo.png', productLogo)
  writePng('resources/build/icon.png', desktopIcon)
  writePng('resources/icon.png', resizeImage(desktopIcon, 256, 256))
  writePng('resources/icon-dev.png', resizeImage(desktopIcon, 256, 256))
  writePng('resources/icon-source/icon.icon/Assets/product-logo.png', mobileIcon)
  writePng('mobile/assets/icon.png', mobileIcon)
  writePng('mobile/assets/adaptive-icon.png', adaptiveForeground)
  writePng('mobile/assets/splash-icon.png', splashIcon)
  writePng('mobile/assets/favicon.png', resizeImage(desktopIcon, 32, 32))
  writePng('resources/tray/hivecode-menu-barTemplate.png', renderTrayTemplate(mark, 22, 14))
  writePng('resources/tray/hivecode-menu-barTemplate@2x.png', renderTrayTemplate(mark, 44, 28))

  writeFileSync(join(REPO_ROOT, 'resources', 'build', 'icon.icns'), encodeIcns(desktopIcon))
  writeFileSync(
    join(REPO_ROOT, 'resources', 'build', 'icon.ico'),
    buildWindowsIcoFromPng(encodePng(desktopIcon))
  )
  process.stdout.write('Generated resources/build/icon.icns\n')
  process.stdout.write('Generated resources/build/icon.ico\n')
}

if (resolve(process.argv[1]) === import.meta.filename) {
  generateHiveCodeIconAssets()
}
