// Steam as a bot, for the admin (Bot manager → Bots → "Open Steam", route: app.js → /steam-view/<token>/<host>/<path>).
//
// Nikolas 2026-11-15: "proxy browser that would allow me as admin to use web browser on steam logged into selected
// acount in new window". The window shows Steam on this site's address. Every request of it comes here and goes to
// bot_manager over the admin socket (admin:steam:fetch); bot_manager asks Steam from its own server with the bot's
// live web session and sends the page back. The bot's login and its Steam cookies never reach this site or the browser.
//
// Safety:
// - Only the admin opens a window (POST /api/admin/steam_browser/open, admin session). It gets a random token in its
//   address, valid 30 minutes after the last request and 4 hours at most (bot_manager ends the view the same way).
//   With TRUST_PROXY set, the token only works from the address that opened it.
// - Steam's pages run on this site's address, so every answer carries `Content-Security-Policy: sandbox` without
//   allow-same-origin: the page gets an origin of its own and can't read this site's cookies, storage or admin API.
//   A small script (shim below) gives Steam's scripts what the sandbox takes away (document.cookie, localStorage) and
//   sends their requests through the window's address.
// - Set-Cookie from Steam is never passed to the browser.
// - Referrer-Policy same-origin: Steam's pictures (its CDN) never see the token.
import crypto from 'crypto'
import * as bot_manager from './bot_manager.js'

export const BASE = '/steam-view'
const HOSTS = { c: 'steamcommunity.com', s: 'store.steampowered.com', h: 'help.steampowered.com', l: 'login.steampowered.com', a: 'api.steampowered.com', cp: 'checkout.steampowered.com' }
const KEY_OF = Object.fromEntries(Object.entries(HOSTS).map(([k, h]) => [h, k]))
export const ROUTE = new RegExp(`^${BASE}/([A-Za-z0-9_-]{32})(?:/(${Object.keys(HOSTS).join('|')})(/.*)?|/(end))?$`)

const IDLE_MS = 30 * 60 * 1000
const MAX_MS = 4 * 60 * 60 * 1000
const PASS_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent', 'x-requested-with', 'x-prototype-version', 'range', 'if-none-match', 'if-modified-since']
const TEXT = /^(text\/|application\/(json|javascript|x-javascript|xml|xhtml\+xml|rss\+xml)|image\/svg)/i
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

const sessions = new Map() // token -> { view, steamid, name, accountName, admin, ip, opened, used, last (Steam page shown last) }

const bind_ip = () => /^\d+$/.test(String(process.env.TRUST_PROXY || '').trim())
const expired = (s, now = Date.now()) => now - s.used > IDLE_MS || now - s.opened > MAX_MS
setInterval(() => { for (const [t, s] of sessions) { if (expired(s)) { sessions.delete(t) } } }, 60 * 1000).unref()

const esc_re = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const js_value = (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const esc_html = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** admin: open a window as this bot → { url, name } */
export const open = async (p = {}, admin, ip) => {
  const bot = String(p.bot || '').trim()
  if(!bot){ return { status: 'error', message: 'Pick a bot.' } }
  const res = await bot_manager.ask('admin:steam:open', { bot }, admin)
  if(res.status != 'ok'){
    const why = { not_logged_in: 'That bot is not logged in yet.', no_web_session: 'That bot has no Steam web session right now. Try "New web session" first.' }[res.code]
    return { ...res, message: why || res.message }
  }
  const token = crypto.randomBytes(24).toString('base64url') // 32 characters
  const now = Date.now()
  sessions.set(token, { view: res.data.view, steamid: res.data.steamid, name: res.data.name, accountName: res.data.accountName, admin: String(admin || ''), ip: bind_ip() ? ip : null, opened: now, used: now })
  console.log(`steam view: ${res.data.name} opened by ${admin || 'admin'}`)
  return { status: 'ok', url: `${BASE}/${token}/c/profiles/${res.data.steamid}/`, name: res.data.name, idleMin: IDLE_MS / 60000, maxMin: MAX_MS / 60000 }
}

const end = async (token) => {
  const s = sessions.get(token)
  if(!s){ return }
  sessions.delete(token)
  await bot_manager.ask('admin:steam:close', { view: s.view }, s.admin)
  console.log(`steam view: ${s.name} closed`)
}

// ---------------------------------------------------------------- rewriting

// a Steam address (absolute, or a path on `key`'s host) → the same page in this window; anything else unchanged
const to_view = (prefix, key, value) => {
  const v = String(value || '')
  if(v.startsWith(prefix)){ return v }
  if(/^\/(?!\/)/.test(v)){ return `${prefix}/${key}${v}` }
  const m = v.match(/^(?:https?:)?\/\/([^/?#]+)(.*)$/i)
  if(m && KEY_OF[m[1].toLowerCase()]){ return `${prefix}/${KEY_OF[m[1].toLowerCase()]}${m[2] || '/'}` }
  return v
}

// this window's address (Referer) → the Steam page it shows
const to_steam = (referer, token) => {
  try {
    const u = new URL(String(referer || ''))
    const m = u.pathname.match(ROUTE)
    if(!m || m[1] != token || !m[2]){ return null }
    return `https://${HOSTS[m[2]]}${m[3] || '/'}${u.search}`
  } catch (e) { return null }
}

const HOST_PATTERNS = Object.entries(HOSTS).map(([k, h]) => [k,
  new RegExp(`(?:https?:)?//${esc_re(h)}(?![\\w.-])`, 'gi'),
  new RegExp(`(?:https?:)?\\\\/\\\\/${esc_re(h)}(?![\\w.-])`, 'gi')])

const rewrite = (text, prefix, key, type) => {
  const escaped = prefix.replace(/\//g, '\\/')
  for (const [k, plain, json] of HOST_PATTERNS) {
    text = text.replace(plain, `${prefix}/${k}`).replace(json, `${escaped}\\/${k}`)
  }
  const base = BASE.slice(1)
  if(/html|xml/i.test(type)){
    // paths on the page's own host: href="/market/" → href="<prefix>/c/market/"
    text = text.replace(new RegExp(`(\\s(?:href|src|action|data-src|data-href|poster|formaction)\\s*=\\s*["'])/(?!/|${esc_re(base)}/)`, 'gi'), `$1${prefix}/${key}/`)
  }
  if(/html|css/i.test(type)){
    text = text.replace(new RegExp(`(url\\(\\s*["']?)/(?!/|${esc_re(base)}/)`, 'gi'), `$1${prefix}/${key}/`)
  }
  return text
}

// runs first on every page: what the sandbox takes away, and Steam's own requests through this window
const shim = (prefix, key, name, cookies) => `<script>(function(){
var P=${js_value(prefix)},K=${js_value(key)},H=${js_value(KEY_OF)},N=${js_value(esc_html(name))};
function map(u){try{if(typeof u!=='string'){return u}if(u.indexOf(P)===0){return u}if(/^\\/(?!\\/)/.test(u)){return P+'/'+K+u}var m=u.match(/^(?:https?:)?\\/\\/([^\\/?#]+)(.*)$/i);if(m&&H[m[1].toLowerCase()]){return P+'/'+H[m[1].toLowerCase()]+(m[2]||'/')}}catch(e){}return u}
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=[].slice.call(arguments);a[1]=map(String(u));return xo.apply(this,a)};
if(window.fetch){var fo=window.fetch;window.fetch=function(i,o){if(typeof i==='string'||i instanceof URL){i=map(String(i))}else if(i&&i.url){var n=map(i.url);if(n!==i.url){i=new Request(n,i)}}return fo.call(this,i,o)}}
var wo=window.open;window.open=function(u){var a=[].slice.call(arguments);if(u){a[0]=map(String(u))}return wo.apply(this,a)};
var jar=${js_value(cookies || {})};
try{document.cookie}catch(e){try{Object.defineProperty(document,'cookie',{configurable:true,get:function(){return Object.keys(jar).map(function(k){return k+'='+jar[k]}).join('; ')},set:function(v){v=String(v);var p=v.split(';')[0],i=p.indexOf('=');if(i>0){var n=p.slice(0,i).trim();if(/max-age=(0|-)|expires=[^;]*1970/i.test(v)){delete jar[n]}else{jar[n]=p.slice(i+1).trim()}}}})}catch(e2){}}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){var d={},s={getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(d).length}});try{Object.defineProperty(window,n,{configurable:true,value:s})}catch(e2){}}});
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a){var h=a.getAttribute('href'),m=map(h);if(m!==h){a.setAttribute('href',m)}}},true);
document.addEventListener('submit',function(e){var f=e.target,a=f&&f.getAttribute&&f.getAttribute('action');if(a){var m=map(a);if(m!==a){f.setAttribute('action',m)}}},true);
document.addEventListener('DOMContentLoaded',function(){var b=document.createElement('div');b.setAttribute('style','position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#1b1530;color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:8px 10px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.5);display:flex;gap:10px;align-items:center');b.innerHTML='<span>Steam as '+N+'</span><a href="'+P+'/end" style="color:#c9b6ff;text-decoration:underline">End</a>';document.body.appendChild(b)});
})();</script>`

// ---------------------------------------------------------------- the window

const page = (res, status, title, text) => {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': SANDBOX })
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc_html(title)}</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;background:#14111f;color:#e8e4f4">
<h1 style="font-size:20px">${esc_html(title)}</h1><p>${esc_html(text)}</p></body>`)
}

/** app.js: every request of a Steam window */
export const handler = async (req, res) => {
  const m = req.path.match(ROUTE)
  if(!m){ return page(res, 404, 'Not found', 'This is not a Steam window address.') }
  const [, token, key, path_part, end_word] = m
  const s = sessions.get(token)
  if(!s || expired(s)){
    sessions.delete(token)
    return page(res, 410, 'This Steam window has ended', 'Open it again from the admin panel (Bot manager → Bots → Open Steam).')
  }
  if(s.ip && s.ip != req.ip){ return page(res, 403, 'Not from here', 'This Steam window was opened from another address. Open it again from the admin panel.') }
  if(end_word){
    await end(token)
    return page(res, 200, 'Steam window ended', `You are no longer browsing Steam as ${s.name}. You can close this window.`)
  }
  if(!key){ return res.redirect(302, `${BASE}/${token}/c/profiles/${s.steamid}/`) }

  // Steam's scripts run in a sandbox with an origin of its own, so their requests here are cross-origin
  res.set({ 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin' })
  if(req.method == 'OPTIONS'){
    res.set({ 'Access-Control-Allow-Methods': 'GET, HEAD, POST', 'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] || '').slice(0, 500), 'Access-Control-Max-Age': '600' })
    return res.status(204).end()
  }
  s.used = Date.now()

  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
  const headers = {}
  for (const h of PASS_HEADERS) { if(typeof req.headers[h] == 'string'){ headers[h] = req.headers[h] } }
  const result = await bot_manager.ask('admin:steam:fetch', {
    view: s.view,
    method: req.method,
    host: key,
    path: (path_part || '/') + query,
    headers,
    body: Buffer.isBuffer(req.body) && req.body.length ? req.body : null,
    // the sandboxed page sends no Referer of its own, so the page last shown in this window stands in for it
    // (Steam wants it, e.g. accepting a trade offer from its page)
    referer: to_steam(req.headers.referer, token) || s.last || null
  }, s.admin)
  if(result.status != 'ok'){
    if(result.code == 'view_expired'){ sessions.delete(token); return page(res, 410, 'This Steam window has ended', 'Open it again from the admin panel.') }
    return page(res, result.offline ? 503 : 502, 'Steam did not answer', result.message || 'bot_manager could not load this page.')
  }

  const d = result.data || {}
  const prefix = `${BASE}/${token}`
  const type = String(d.headers?.['content-type'] || '')
  res.status(Number(d.status) || 502)
  for (const [k, v] of Object.entries(d.headers || {})) {
    if(k == 'location'){ res.set('Location', to_view(prefix, key, v)) }
    else if(k != 'content-type'){ res.set(k, v) }
  }
  res.set({
    'Content-Security-Policy': SANDBOX,
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  })
  if(type){ res.set('Content-Type', type) }

  if(/text\/html/i.test(type) && Number(d.status) == 200 && (req.method == 'GET') && !req.headers['x-requested-with']){
    s.last = `https://${HOSTS[key]}${path_part || '/'}${query}`
  }

  let body = d.body ? Buffer.from(d.body) : Buffer.alloc(0)
  if(TEXT.test(type) && body.length){
    let text = rewrite(body.toString('utf8'), prefix, key, type)
    if(/text\/html/i.test(type)){
      const script = shim(prefix, key, s.name, d.cookies)
      text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (h) => h + script) : script + text
    }
    body = Buffer.from(text, 'utf8')
  }
  res.end(req.method == 'HEAD' ? undefined : body)
}
