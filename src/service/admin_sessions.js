// The admin's unlocked panel, and everything opened from it that acts as a bot (Nikolas 2026-11-20: "disable proxies
// windows with logged bots once admin is logged out" / "Just make admin more secure too").
//
// Unlocking the panel (/login: the admin's Steam account + ADMIN_PASSWORD) gives the signed-in session an admin key.
// Things opened from the panel are tied to that key:
//   - "Open Steam" windows (service/steam_browser.js)
//   - "Open in Chrome / Edge" windows of the admin extension (service/bot_browser.js leases, extension/background.js)
//   - the panel's live settings socket (service/settings_socket.js)
// The key ends, and all of them with it, when the admin logs out of the site (/logout), locks the panel (the admin
// bar's Lock, POST /admin/lock), or the sign-in itself ends (12 hours, a server restart). The panel's own unlock still
// lasts 1 hour (mw.js ADMIN_SESSION_MS); entering the password again keeps the same key, so a window opened before stays.
//
// The unlock is also tied to the browser that unlocked it (its user agent and network): a copied session cookie used
// from another browser or network asks for the admin password again.
import crypto from 'crypto'
import localEmitter from '../emitter.js'

const SWEEP_MS = 30 * 1000

const keys = new Map() // admin key -> { sid, steamid, since }
let store = null

const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('base64url')

// the network part of an address: IPv4 /24, IPv6 /64 (phones and home routers change the rest now and then)
const network = (ip) => {
  const v = String(ip || '').replace(/^::ffff:/i, '')
  if(/^\d+\.\d+\.\d+\.\d+$/.test(v)){ return v.split('.').slice(0, 3).join('.') }
  if(v.includes(':')){
    const [head, tail = ''] = v.split('::')
    const left = head ? head.split(':') : []
    const right = tail ? tail.split(':') : []
    const full = v.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
    return full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':')
  }
  return v
}

/** what ties an unlock to the browser that made it */
export const bind = (req) => sha(`${req.get?.('user-agent') || ''}|${network(req.ip)}`)

/** the session store (app.js), to tell whether a sign-in still exists */
export const init = (session_store) => { store = session_store }

/** /login with the right password: unlock the panel for this sign-in → its key */
export const unlock = (req, until) => {
  let key = req.session.admin_key
  if(!key || !keys.has(key) || keys.get(key).sid !== req.sessionID){
    key = crypto.randomBytes(24).toString('base64url')
    req.session.admin_key = key
  }
  keys.set(key, { sid: req.sessionID, steamid: String(req.user?.steamid || ''), since: keys.get(key)?.since || Date.now() })
  req.session.admin_until = until
  req.session.admin_bind = bind(req)
  return key
}

/** is this request's unlock still its own (same key, same browser)? mw.has_admin_session checks the rest */
export const valid = (req) => {
  const key = req.session?.admin_key
  return Boolean(key && keys.has(key) && keys.get(key).sid === req.sessionID && req.session.admin_bind === bind(req))
}

/** the request's admin key, when its unlock is valid */
export const key_of = (req) => valid(req) ? req.session.admin_key : null

/** is a key still alive? (things opened from the panel check this on every use) */
export const active = (key) => typeof key == 'string' && keys.has(key)

/** end a key: everything opened with it closes (localEmitter 'admin:ended') */
export const end = (key, reason = 'ended') => {
  if(!keys.delete(key)){ return false }
  console.log(`admin: panel session ended (${reason})`)
  localEmitter.emit('admin:ended', { key, reason })
  return true
}

/** /logout and the Lock button: end this request's key and lock the panel */
export const end_request = (req, reason) => {
  const key = req.session?.admin_key
  if(key){ end(key, reason) }
  if(req.session){
    delete req.session.admin_key
    delete req.session.admin_bind
    req.session.admin_until = 0
  }
}

// a sign-in that no longer exists (expired, logged out elsewhere, another account) ends its key
const session_of = (sid) => new Promise((resolve) => {
  if(!store){ return resolve(undefined) }
  try { store.get(sid, (err, sess) => resolve(err ? undefined : (sess || null))) } catch (e) { resolve(undefined) }
})
const sweep = async () => {
  for (const [key, k] of [...keys]) {
    const sess = await session_of(k.sid)
    if(sess === undefined){ continue } // the store couldn't tell: next time
    const user = sess?.passport?.user
    if(!sess || sess.admin_key !== key || !user || String(user.steamid) !== k.steamid || k.steamid !== String(process.env.ADMIN_STEAMID || '')){
      end(key, 'signed out')
    }
  }
}
setInterval(() => { sweep().catch(() => {}) }, SWEEP_MS).unref()

export const status = () => ({ keys: keys.size })
