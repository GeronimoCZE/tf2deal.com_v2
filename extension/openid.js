// Steam's "Sign in through Steam" page, in the bot's window only, for backpack.tf only: confirms it, so backpack.tf
// opens logged in as the bot. Anywhere else (your own windows, other sites) the page is left alone.
(async () => {
  const q = new URLSearchParams(location.search)
  const realm = q.get('openid.realm') || q.get('openid.return_to') || ''
  if (!/^https:\/\/(www\.)?backpack\.tf(\/|$)/i.test(realm)) return
  const res = await chrome.runtime.sendMessage({ type: 'is_bot_tab' }).catch(() => null)
  if (!res?.yes) return
  // once in a while only, so a failed sign-in never turns into a loop
  const last = Number(sessionStorage.getItem('td_bot_openid') || 0)
  if (Date.now() - last < 30 * 1000) return
  sessionStorage.setItem('td_bot_openid', String(Date.now()))
  const button = document.querySelector('#imageLogin, #openidForm [type="submit"], #openidForm [type="image"]')
  if (button) button.click()
  else document.getElementById('openidForm')?.requestSubmit?.()
})()
