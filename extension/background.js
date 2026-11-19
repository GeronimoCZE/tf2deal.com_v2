// tf2deal admin: bot browser (docs/BOT_BROWSER.md)
//
// Nikolas 2026-11-18: "open new browser where the selected steam account would login on steam and open the bot's steam
// profile, also allow login on backpack.tf". A website can't log a browser into steamcommunity.com, an extension can:
// Admin → Bot manager → Bots → "Open in Chrome" gets the bot's web login from bot_manager (admin:steam:cookies, admin
// session only) and hands it to this extension through bridge.js. We open a private (incognito) window, put the login
// cookies into the private window's cookie jar only, and open the bot's Steam profile and backpack.tf there
// (openid.js confirms backpack.tf's "Sign in through Steam" in that window).
//
// - Your own Steam login in normal windows is never touched: everything goes into the private windows' jar.
// - All private windows share one jar, so one bot at a time: opening another bot closes the first bot's window.
// - While the bot's window is open, Steam's log out, deauthorize, revoke and remove-authenticator addresses are blocked
//   (in every window, since Chrome can't tell the rule which window): logging out there would log the bot itself out.
// - When the window closes, the Steam and backpack.tf cookies of the private jar are deleted and the block ends.

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

const state = async () => (await chrome.storage.session.get('bot')).bot || null
const save = (bot) => bot ? chrome.storage.session.set({ bot }) : chrome.storage.session.remove('bot')

const valid = (bot) => bot && /^\d{17}$/.test(String(bot.steamid)) && Array.isArray(bot.cookies) && bot.cookies.length > 0 && bot.cookies.length <= 12 &&
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
  await clear(bot.storeId)
  await block(false)
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const bot = await state()
  if (bot && bot.windowId === windowId) await ended()
})

const open = async (bot, targets) => {
  if (!valid(bot)) return { ok: false, error: 'bad_request' }
  if (!(await chrome.extension.isAllowedIncognitoAccess())) return { ok: false, error: 'incognito_off' }

  // one bot at a time (all private windows share one cookie jar)
  const before = await state()
  if (before) {
    await chrome.windows.remove(before.windowId).catch(() => {})
    await ended()
  }

  const win = await chrome.windows.create({ incognito: true, url: 'about:blank', focused: true, state: 'maximized' }).catch(() => null)
  const first = win?.tabs?.[0]
  if (!first) return { ok: false, error: 'window_failed' }
  const stores = await chrome.cookies.getAllCookieStores()
  const storeId = (stores.find((s) => s.tabIds.includes(first.id)) || stores.find((s) => s.id != '0'))?.id
  if (!storeId || storeId == '0') { await chrome.windows.remove(win.id).catch(() => {}); return { ok: false, error: 'window_failed' } }

  // the block first, the login after: if anything fails on the way, the window closes and its cookies go
  await save({ windowId: win.id, storeId, steamid: String(bot.steamid), name: String(bot.name || '').slice(0, 64), opened: Date.now() })
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

const ADMIN_PAGE = /^(https:\/\/(www\.)?tf2deal\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/admin/

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type == 'open') {
    // only the admin panel (bridge.js) opens a window
    if (!sender.tab || !ADMIN_PAGE.test(sender.url || '')) { reply({ ok: false, error: 'bad_request' }); return false }
    open(msg.bot, msg.targets).then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }))
    return true
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
