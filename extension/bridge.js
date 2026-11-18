// tf2deal admin pages ↔ the extension (background.js). The page (public/js/admin_bot_manager.js) sees that the
// extension is there by the data-td-bot-browser attribute (its version) and asks for a bot's window with
//   window.postMessage({ type: 'td-bot-browser:open', id, bot: { steamid, name, cookies, expires }, targets }, origin)
// and gets back { type: 'td-bot-browser:done', id, ok, error? }.
const mark = () => { if (document.documentElement) document.documentElement.dataset.tdBotBrowser = chrome.runtime.getManifest().version }
mark()
document.addEventListener('DOMContentLoaded', mark)

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin) return
  const m = e.data
  if (!m || m.type !== 'td-bot-browser:open' || typeof m.id !== 'string') return
  const res = await chrome.runtime.sendMessage({ type: 'open', bot: m.bot, targets: m.targets })
    .catch((err) => ({ ok: false, error: String(err?.message || err) }))
  window.postMessage({ type: 'td-bot-browser:done', id: m.id, ...(res || { ok: false, error: 'no_answer' }) }, location.origin)
})
