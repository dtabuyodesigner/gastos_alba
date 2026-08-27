/*
 * Genera los iconos PNG de la PWA sin dependencias externas.
 * Dibuja un "ticket" estilizado pixel a pixel y comprime con zlib.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [29, 42, 58] // #1d2a3a
const PAPER = [244, 245, 247] // #f4f5f7
const INK = [122, 134, 150] // lineas del ticket
const ACCENT = [45, 156, 122] // #2d9c7a

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro "none"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Dibuja el icono: fondo + hoja de ticket con borde dentado y lineas. */
function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = a
  }

  const radius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (maskable) {
        set(x, y, BG)
        continue
      }
      // Fondo con esquinas redondeadas.
      const cx = Math.min(x, size - 1 - x)
      const cy = Math.min(y, size - 1 - y)
      const inCorner = cx < radius && cy < radius
      const d = Math.hypot(radius - cx, radius - cy)
      if (!inCorner || d <= radius) set(x, y, BG)
    }
  }

  // Hoja del ticket (mas pequena en maskable para respetar la zona segura).
  const scale = maskable ? 0.44 : 0.56
  const w = Math.round(size * scale)
  const h = Math.round(size * scale * 1.18)
  const x0 = Math.round((size - w) / 2)
  const y0 = Math.round((size - h) / 2)
  const tooth = Math.max(2, Math.round(w / 9))

  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // Borde inferior dentado, como un ticket cortado.
      if (y > y0 + h - tooth) {
        const phase = ((x - x0) % (tooth * 2)) / (tooth * 2)
        const depth = 1 - Math.abs(phase - 0.5) * 2
        if (y - (y0 + h - tooth) > depth * tooth) continue
      }
      set(x, y, PAPER)
    }
  }

  // Lineas de texto del ticket.
  const lineH = Math.max(1, Math.round(h * 0.055))
  const padX = Math.round(w * 0.16)
  const lines = [0.16, 0.32, 0.48]
  for (const [idx, ratio] of lines.entries()) {
    const ly = y0 + Math.round(h * ratio)
    const lw = idx === 0 ? w - padX * 2 : Math.round((w - padX * 2) * (idx === 1 ? 0.75 : 0.55))
    for (let y = ly; y < ly + lineH; y++) {
      for (let x = x0 + padX; x < x0 + padX + lw; x++) set(x, y, INK)
    }
  }

  // Barra de "total" en color acento.
  const ty = y0 + Math.round(h * 0.66)
  const th = Math.max(2, Math.round(h * 0.1))
  for (let y = ty; y < ty + th; y++) {
    for (let x = x0 + padX; x < x0 + w - padX; x++) set(x, y, ACCENT)
  }

  return encodePng(size, px)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'icon-192.png'), drawIcon(192))
writeFileSync(resolve(OUT_DIR, 'icon-512.png'), drawIcon(512))
writeFileSync(resolve(OUT_DIR, 'icon-maskable-512.png'), drawIcon(512, { maskable: true }))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Gastos Alba">
  <rect width="64" height="64" rx="14" fill="#1d2a3a"/>
  <path d="M20 14h24v32l-3-3-3 3-3-3-3 3-3-3-3 3-3-3-3 3z" fill="#f4f5f7"/>
  <rect x="25" y="21" width="14" height="2.5" rx="1.25" fill="#7a8696"/>
  <rect x="25" y="26" width="10" height="2.5" rx="1.25" fill="#7a8696"/>
  <rect x="25" y="33" width="14" height="4" rx="2" fill="#2d9c7a"/>
</svg>
`
writeFileSync(resolve(OUT_DIR, 'icon.svg'), svg)

console.log('Iconos generados en public/icons/')
