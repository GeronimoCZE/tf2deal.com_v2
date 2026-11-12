// Pictures uploaded in the admin panel (blog posts, covers). They are kept on the server's disk, outside git:
//   UPLOADS_DIR=...   the folder (default: <site folder>/uploads, which .gitignore leaves out, so `git pull` keeps it)
// and served at /uploads/<folder>/<name> (app.js), cached for a year: a file's name is its content's fingerprint, so a
// changed picture gets a new address.
//
// Only PNG, JPEG, WebP and GIF are taken, recognised by their first bytes (not by what the browser says), and never
// SVG (it can carry scripts). The admin editor makes big pictures smaller and WebP before uploading
// (js/admin_blog.js), so the server needs no image library.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const MAX_BYTES = 8 * 1024 * 1024
const FOLDERS = ['blog']

export const dir = () => path.resolve(process.env.UPLOADS_DIR || path.join(SITE_ROOT, 'uploads'))

// { type, ext, width, height } from the file's first bytes, or null when it isn't a picture we take
export const sniff = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null
  // PNG: signature, then the IHDR chunk with width and height
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // GIF
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
    return { type: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // WebP: RIFF....WEBP, then a VP8 / VP8L / VP8X chunk
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const chunk = buf.toString('ascii', 12, 16)
    let width = 0, height = 0
    if (chunk === 'VP8 ') { width = buf.readUInt16LE(26) & 0x3fff; height = buf.readUInt16LE(28) & 0x3fff }
    else if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1 }
    else if (chunk === 'VP8X') { width = buf.readUIntLE(24, 3) + 1; height = buf.readUIntLE(27, 3) + 1 }
    else return null
    return { type: 'image/webp', ext: 'webp', width, height }
  }
  // JPEG: walk the markers to the frame header (SOFn)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let at = 2
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) { at++; continue }
      const marker = buf[at + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue }
      const length = buf.readUInt16BE(at + 2)
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', ext: 'jpg', width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5) }
      }
      at += 2 + length
    }
    return { type: 'image/jpeg', ext: 'jpg', width: 0, height: 0 }
  }
  return null
}

// saves a picture; the same picture uploaded twice is one file. Returns { url, width, height, bytes }
export const save = async (folder, buf) => {
  if (!FOLDERS.includes(folder)) throw new Error('Unknown upload folder')
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('The file is empty.')
  if (buf.length > MAX_BYTES) throw new Error(`The picture is larger than ${MAX_BYTES / 1024 / 1024} MB.`)
  const info = sniff(buf)
  if (!info) throw new Error('Only PNG, JPEG, WebP and GIF pictures can be uploaded.')
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20)}.${info.ext}`
  const target = path.join(dir(), folder)
  await fs.promises.mkdir(target, { recursive: true })
  const file = path.join(target, name)
  if (!fs.existsSync(file)) await fs.promises.writeFile(file, buf)
  return { url: `/uploads/${folder}/${name}`, width: info.width, height: info.height, bytes: buf.length }
}

// the pictures in a folder, newest first: [{ url, bytes, time }]
export const list = async (folder, limit = 200) => {
  if (!FOLDERS.includes(folder)) return []
  const target = path.join(dir(), folder)
  let names = []
  try { names = await fs.promises.readdir(target) } catch (error) { return [] }
  const files = await Promise.all(names.filter((name) => /^[0-9a-f]{20}\.(png|jpg|webp|gif)$/.test(name)).map(async (name) => {
    try {
      const stat = await fs.promises.stat(path.join(target, name))
      return { url: `/uploads/${folder}/${name}`, bytes: stat.size, time: stat.mtimeMs }
    } catch (error) { return null }
  }))
  return files.filter(Boolean).sort((a, b) => b.time - a.time).slice(0, limit)
}
