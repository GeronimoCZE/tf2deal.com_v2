// Chrome / Edge window as a bot, for the admin (Bot manager → Bots → "Open in Chrome" / "Open in Edge", docs/BOT_BROWSER.md).
//
// Nikolas 2026-11-18: "open new browser where the selected steam account would login on steam and open the bot's steam
// profile, also allow login on backpack.tf". A website can't log a browser into Steam, so the admin installs the small
// Chrome extension in extension/ (downloaded from Admin as a zip, below). "Open in Chrome" asks bot_manager for the bot's
// web login (admin:steam:cookies: steamLoginSecure + sessionid, an access token that ends within a day; never the
// password, secrets or refresh token) and the admin page hands it to the extension, which opens a private window with it.
//
// Unlike "Open Steam" (service/steam_browser.js, where the login never leaves bot_manager), this login reaches the
// admin's browser on purpose. Only the admin API calls this (admin Steam account + admin password, api/routes/admin.js).
//
// Each window gets a lease, tied to the admin panel's unlock (service/admin_sessions.js). The extension asks
// GET /api/bot_browser/lease/<lease> every 30 seconds and whenever a tf2deal.com page loads; once the admin logs out of
// the site or locks the panel the answer is 410 and the extension closes the window and deletes its cookies (Nikolas
// 2026-11-20: "disable proxies windows with logged bots once admin is logged out").
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import * as bot_manager from './bot_manager.js'
import * as admin_sessions from './admin_sessions.js'
import localEmitter from '../emitter.js'

// the extension that checks its lease (older ones can't close their window when the admin logs out)
export const MIN_EXTENSION = '1.2.0'
const LEASE_MS = 24 * 60 * 60 * 1000 // a bot's web login lasts about a day
const leases = new Map() // lease -> { key, steamid, name, admin, opened }
setInterval(() => { for (const [l, x] of leases) { if (Date.now() - x.opened > LEASE_MS || !admin_sessions.active(x.key)) { leases.delete(l) } } }, 60 * 1000).unref()
localEmitter.on('admin:ended', ({ key }) => {
  for (const [l, x] of leases) {
    if (x.key === key) { leases.delete(l); console.log(`bot browser: the window of ${x.name} closes (admin panel ended)`) }
  }
})

/** the extension's check: is this window's lease still good? */
export const lease_alive = (lease) => {
  const x = typeof lease == 'string' ? leases.get(lease) : null
  if (!x) return false
  if (Date.now() - x.opened > LEASE_MS || !admin_sessions.active(x.key)) { leases.delete(lease); return false }
  return true
}

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension')
const HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com', 'help.steampowered.com'])
const NAMES = new Set(['steamLoginSecure', 'sessionid'])

/** admin: the bot's web login for the extension → { steamid, name, cookies: [{ host, name, value }], expires } */
export const login = async (p = {}, admin, key) => {
  const bot = String(p.bot || '').trim().slice(0, 64)
  if(!bot){ return { status: 'error', message: 'Pick a bot.' } }
  if(!admin_sessions.active(key)){ return { status: 'error', message: 'Unlock the admin panel again first.' } }
  const res = await bot_manager.ask('admin:steam:cookies', { bot }, admin)
  if(res.status != 'ok'){
    const why = {
      not_logged_in: 'That bot is not logged in yet.',
      no_web_session: 'That bot has no Steam web session right now. Try "New web session" first.'
    }[res.code]
    // a bot_manager from before admin:steam:cookies has no handler for it and never answers
    const old = !res.code && !res.offline && /in time/.test(String(res.message || ''))
    return { ...res, message: why || (old ? 'bot_manager did not answer. If it is not updated yet, pull and restart it: "Open in Chrome" needs its admin:steam:cookies.' : res.message) }
  }
  const d = res.data || {}
  const cookies = (Array.isArray(d.cookies) ? d.cookies : [])
    .filter((c) => c && HOSTS.has(c.host) && NAMES.has(c.name) && typeof c.value == 'string' && c.value)
    .map((c) => ({ host: c.host, name: c.name, value: c.value }))
  if(!/^\d{17}$/.test(String(d.steamid || '')) || !cookies.some((c) => c.name == 'steamLoginSecure')){
    return { status: 'error', message: 'bot_manager sent no Steam login for that bot. Try "New web session" first.' }
  }
  const name = String(d.name || d.accountName || d.steamid)
  const lease = crypto.randomBytes(24).toString('base64url')
  leases.set(lease, { key, steamid: String(d.steamid), name, admin: String(admin || ''), opened: Date.now() })
  console.log(`bot browser: ${name} opened in the browser of ${admin || 'admin'}`)
  return { status: 'ok', steamid: String(d.steamid), name, cookies, expires: Number(d.expires) || null, lease, min_extension: MIN_EXTENSION }
}

// ---------------------------------------------------------------- the extension as a zip

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1 }
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xFFFFFFFF
  for (const byte of buf) { c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8) }
  return (c ^ 0xFFFFFFFF) >>> 0
}

// files: [{ name, data: Buffer }] → a .zip (deflate), what Chrome's "Load unpacked" needs once it is unpacked
const zip = (files) => {
  const local = [], central = []
  let offset = 0
  const time = ((12 << 11) | (0 << 5)) & 0xFFFF, date = (((2026 - 1980) << 9) | (11 << 5) | 18) & 0xFFFF
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const packed = zlib.deflateRawSync(f.data)
    const crc = crc32(f.data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28)
    local.push(head, name, packed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(f.data.length, 24); entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += head.length + name.length + packed.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dir, end])
}

const list = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if(entry.name.startsWith('.')){ return [] }
  const full = path.join(dir, entry.name), rel = prefix + entry.name
  return entry.isDirectory() ? list(full, rel + '/') : [{ name: rel, full }]
})

/** the extension folder as a zip → { file (name), data }
 * The files sit at the top of the zip, and the zip's name has no version: Windows' "Extract All" makes a folder named
 * after the zip, so this gives one tf2deal-bot-browser folder with manifest.json right in it (a folder inside the zip
 * gave tf2deal-bot-browser-1.0.0\tf2deal-bot-browser-1.0.0\manifest.json, and "Load unpacked" on the outer folder fails
 * with "Manifest file is missing"), and a newer version unzips over the same folder. */
export const extension_zip = () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'))
  const files = list(EXTENSION_DIR).map((f) => ({ name: f.name, data: fs.readFileSync(f.full) }))
  return { file: 'tf2deal-bot-browser.zip', version: manifest.version, data: zip(files) }
}

/** the version in extension/manifest.json (the admin page tells when the installed one is older) */
export const extension_version = () => {
  try { return JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).version } catch { return null }
}
