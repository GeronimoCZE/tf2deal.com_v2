// tf2deal admin: bot browser (docs/BOT_BROWSER.md)
//
// Nikolas 2026-11-18: "open new browser where the selected steam account would login on steam and open the bot's steam
// profile, also allow login on backpack.tf". A website can't log a browser into steamcommunity.com, an extension can:
// Admin → Bot manager → Bots → "Open in Chrome" gets the bot's web login from bot_manager (admin:steam:cookies, admin
// session only) and hands it to this extension through bridge.js. We open a private window (Chrome incognito, Edge
// InPrivate: the same extension works in both), put the login cookies into the private window's cookie jar only, and
// open the bot's Steam profile and backpack.tf there (openid.js confirms backpack.tf's "Sign in through Steam" there).
//
// - Your own Steam login in normal windows is never touched: everything goes into the private windows' jar.
// - All private windows share one jar, so one bot at a time: opening another bot closes the first bot's window.
// - While the bot's window is open, Steam's log out, deauthorize, revoke and remove-authenticator addresses are blocked
//   (in every window, since Chrome can't tell the rule which window): logging out there would log the bot itself out.
// - When the window closes, the Steam and backpack.tf cookies of the private jar are deleted and the block ends.
// - The window closes by itself once the admin logs out of tf2deal.com or locks the admin panel (Nikolas 2026-11-20:
//   "disable proxies windows with logged bots once admin is logged out"): the site gives every window a lease, checked
//   every 30 seconds and whenever a tf2deal.com page loads (bridge.js). If the site can't be reached for 10 minutes
//   the window closes too.

const STEAM_HOSTS = ['steamcommunity.com', 'store.steampowered.com', 'help.steampowered.com']
const CLEAR_DOMAINS = ['steamcommunity.com', 'steampowered.com', 'backpack.tf']
const COOKIE_NAMES = ['steamLoginSecure', 'sessionid']
// what logs the bot itself out, anywhere in a Steam address (any case), is blocked: Chrome shows "blocked by an
// extension" instead of the page. Plain text filters, not one regular expression: Chrome refuses a regex that big.
// (A page of our own can't be shown instead: an extension's pages don't open in private windows.)
const BLOCKED = ['logout', 'deauthorize', 'revoke', 'removeauthenticator', 'twofactor/remove', 'twofactor/manage_action', 'phone/remove']
const STEAM_DOMAINS = ['steamcommunity.com', 'steampowered.com']
const OTHER_TYPES = ['sub_frame', 'xmlhttprequest', 'ping', 'script', 'image', 'stylesheet', 'font', 'media', 'object', 'websocket', 'other']
const BLOCK_RULES = BLOCKED.map((text, i) => ({ id: 1 + i, priority: 1, action: { type: 'block' }, condition: { urlFilter: text, requestDomains: STEAM_DOMAINS, resourceTypes: ['main_frame', ...OTHER_TYPES] } }))
const BLOCK_IDS = BLOCK_RULES.map((r) => r.id)

const LEASE = /^[A-Za-z0-9_-]{32}$/
const LEASE_ALARM = 'lease'
const LEASE_GRACE_MS = 10 * 60 * 1000   // the site unreachable this long: the window closes anyway

const state = async () => (await chrome.storage.session.get('bot')).bot || null
const save = (bot) => bot ? chrome.storage.session.set({ bot }) : chrome.storage.session.remove('bot')

const valid = (bot) => bot && /^\d{17}$/.test(String(bot.steamid)) && LEASE.test(String(bot.lease || '')) && Array.isArray(bot.cookies) && bot.cookies.length > 0 && bot.cookies.length <= 12 &&
  bot.cookies.every((c) => c && STEAM_HOSTS.includes(c.host) && COOKIE_NAMES.includes(c.name) && typeof c.value == 'string' && c.value.length <= 4096 && /^[\w%.\-|~]+$/.test(c.value)) &&
  bot.cookies.some((c) => c.name == 'steamLoginSecure')

const block = (on) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: BLOCK_IDS, addRules: on ? BLOCK_RULES : [] })

// the Steam and backpack.tf cookies of one jar
const clear = async (storeId) => {
  for (const domain of CLEAR_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain, storeId }).catch(() => [])
    await Promise.all(cookies.map((c) => chrome.cookies.remove({ url: `https://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, storeId }).catch(() => {})))
  }
}

// the bot's window is gone: its cookies go, the block ends
const ended = async () => {
  const bot = await state()
  if (!bot) return
  await save(null)
  await chrome.alarms.clear(LEASE_ALARM).catch(() => {})
  await clear(bot.storeId)
  await block(false)
}

// is the admin panel that opened the window still unlocked? 410 = the admin logged out or locked it: close it now
let checking = null
const check_lease = () => checking || (checking = (async () => {
  const bot = await state()
  if (!bot?.lease || !bot.origin) return
  let dead = false
  try {
    const res = await fetch(`${bot.origin}/api/bot_browser/lease/${bot.lease}`, { credentials: 'omit', cache: 'no-store' })
    if (res.status === 410) dead = true
    else if (res.ok) { if (bot.failingSince) await save({ ...bot, failingSince: 0 }) }
    else throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    const since = bot.failingSince || Date.now()
    if (!bot.failingSince) await save({ ...bot, failingSince: since })
    dead = Date.now() - since > LEASE_GRACE_MS
  }
  if (dead) {
    await chrome.windows.remove(bot.windowId).catch(() => {})
    await ended()
  }
})().finally(() => { checking = null }))

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === LEASE_ALARM) check_lease() })

chrome.windows.onRemoved.addListener(async (windowId) => {
  const bot = await state()
  if (bot && bot.windowId === windowId) await ended()
})

// The private window, its first tab and its cookie jar. windows.create usually hands back the window with its tab, but
// for a private window a browser may answer with no window at all while it still opens one (w3c/webextensions#407), or
// with a window whose tab and jar aren't listed yet (Nikolas 2026-11-19: "doesn't work in Edge"). So the new private
// window is also caught by windows.onCreated, and the tab and jar are looked up for up to 2 seconds, not read once.
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const private_window = async () => {
  const before = new Set((await chrome.windows.getAll().catch(() => [])).map((w) => w.id))
  let on
  const seen = new Promise((resolve) => {
    on = (w) => { if (w.incognito && !before.has(w.id)) resolve(w) }
    chrome.windows.onCreated.addListener(on)
  })
  const create = (extra) => chrome.windows.create({ incognito: true, url: 'about:blank', focused: true, ...extra })
  try {
    // maximized where the browser allows it; if it refuses that, plain (the first call opened nothing then)
    let win = await create({ state: 'maximized' }).catch(() => create({}))
    if (!win?.id) win = await Promise.race([seen, later(5000).then(() => null)])
    if (!win?.id) {
      const now = await chrome.windows.getAll().catch(() => [])
      win = now.find((w) => w.incognito && !before.has(w.id)) || null
    }
    if (!win?.id) return { error: 'window_hidden' }
    let tab = win.tabs?.[0], storeId
    for (let i = 0; i < 20 && !(tab && storeId); i++) {
      if (i) await later(100)
      tab = tab || (await chrome.tabs.query({ windowId: win.id }).catch(() => []))[0]
      const stores = await chrome.cookies.getAllCookieStores().catch(() => [])
      storeId = (tab && stores.find((s) => s.tabIds.includes(tab.id)))?.id
    }
    // a private tab's jar is never the normal one ('0'); if the lookup found none, the one jar that isn't normal
    if (!storeId || storeId == '0') storeId = (await chrome.cookies.getAllCookieStores().catch(() => [])).find((s) => s.id != '0')?.id
    if (!tab || !storeId || storeId == '0') {
      await chrome.windows.remove(win.id).catch(() => {})
      return { error: 'window_failed' }
    }
    return { win, tab, storeId }
  } finally {
    chrome.windows.onCreated.removeListener(on)
  }
}

const open = async (bot, targets, origin) => {
  if (!valid(bot)) return { ok: false, error: 'bad_request' }
  if (!(await chrome.extension.isAllowedIncognitoAccess())) return { ok: false, error: 'incognito_off' }

  // one bot at a time (all private windows share one cookie jar)
  const before = await state()
  if (before) {
    await chrome.windows.remove(before.windowId).catch(() => {})
    await ended()
  }

  const got = await private_window()
  if (got.error) return { ok: false, error: got.error }
  const { win, tab: first, storeId } = got

  // the block first, the login after: if anything fails on the way, the window closes and its cookies go
  await save({ windowId: win.id, storeId, steamid: String(bot.steamid), name: String(bot.name || '').slice(0, 64), opened: Date.now(), lease: String(bot.lease), origin })
  await chrome.alarms.create(LEASE_ALARM, { periodInMinutes: 0.5 })
  try {
    await block(true)
    await clear(storeId)
    const expires = Number(bot.expires) > Date.now() ? Math.floor(Number(bot.expires) / 1000) : undefined
    for (const c of bot.cookies) {
      await chrome.cookies.set({
        url: `https://${c.host}/`, name: c.name, value: c.value, path: '/', secure: true, sameSite: 'no_restriction', storeId,
        httpOnly: c.name == 'steamLoginSecure', expirationDate: c.name == 'steamLoginSecure' ? expires : undefined
      })
    }
  } catch (e) {
    await chrome.windows.remove(win.id).catch(() => {})
    await ended()
    throw e
  }

  const urls = []
  if (!Array.isArray(targets) || targets.includes('profile')) urls.push(`https://steamcommunity.com/profiles/${bot.steamid}/`)
  if (Array.isArray(targets) && targets.includes('backpack')) urls.push('https://backpack.tf/login')
  await chrome.tabs.update(first.id, { url: urls[0] })
  for (const url of urls.slice(1)) await chrome.tabs.create({ windowId: win.id, url, active: false })
  return { ok: true, name: bot.name || bot.steamid }
}

const SITE = /^(https:\/\/(www\.)?tf2deal\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/|$)/
const ADMIN_PAGE = /^(https:\/\/(www\.)?tf2deal\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/admin(\/|[?#]|$)/

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type == 'open') {
    // only the admin panel (bridge.js) opens a window; its lease is checked on the same site
    if (!sender.tab || !ADMIN_PAGE.test(sender.url || '')) { reply({ ok: false, error: 'bad_request' }); return false }
    open(msg.bot, msg.targets, new URL(sender.url).origin).then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }))
    return true
  }
  if (msg?.type == 'check') {
    // a tf2deal page loaded (bridge.js): maybe the admin just logged out
    if (sender.tab && SITE.test(sender.url || '')) check_lease()
    return false
  }
  if (msg?.type == 'is_bot_tab') {
    state().then((bot) => reply({ yes: Boolean(bot && sender.tab && sender.tab.windowId === bot.windowId) }))
    return true
  }
  return false
})

// the toolbar icon: back to the bot's window, or to the admin panel
chrome.action.onClicked.addListener(async () => {
  const bot = await state()
  if (bot) {
    const ok = await chrome.windows.update(bot.windowId, { focused: true }).then(() => true, () => false)
    if (ok) return
    await ended()
  }
  chrome.tabs.create({ url: 'https://tf2deal.com/admin' })
})
