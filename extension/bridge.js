// tf2deal pages ↔ the extension (background.js).
// - Admin pages: the page (public/js/admin_bot_manager.js) sees that the extension is there by the data-td-bot-browser
//   attribute (its version) and asks for a bot's window with
//     window.postMessage({ type: 'td-bot-browser:open', id, bot: { steamid, name, cookies, expires, lease }, targets }, origin)
//   and gets back { type: 'td-bot-browser:done', id, ok, error? }.
// - Every tf2deal page: tells the extension to check the open bot window's lease now, so the window closes as soon as
//   the admin has logged out or locked the panel (the page after that is a tf2deal page too), not only on the
//   30-second check.
const ADMIN = location.pathname === '/admin' || location.pathname.startsWith('/admin/')
const mark = () => { if (document.documentElement) document.documentElement.dataset.tdBotBrowser = chrome.runtime.getManifest().version }
if (ADMIN) {
  mark()
  document.addEventListener('DOMContentLoaded', mark)
}
chrome.runtime.sendMessage({ type: 'check' }).catch(() => {})

window.addEventListener('message', async (e) => {
  if (!ADMIN || e.source !== window || e.origin !== location.origin) return
  const m = e.data
  if (!m || m.type !== 'td-bot-browser:open' || typeof m.id !== 'string') return
  const res = await chrome.runtime.sendMessage({ type: 'open', bot: m.bot, targets: m.targets })
    .catch((err) => ({ ok: false, error: String(err?.message || err) }))
  window.postMessage({ type: 'td-bot-browser:done', id: m.id, ...(res || { ok: false, error: 'no_answer' }) }, location.origin)
})
