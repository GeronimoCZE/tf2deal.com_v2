// Steam trade URLs: the link our bots use to send a user trade offers.
//
//   https://steamcommunity.com/tradeoffer/new/?partner=<account id>&token=<token>
//
// A signed-in user without one sees the trade URL window on every page (views/partials/trade_url_modal.ejs,
// public/js/welcome.js) and can't load their inventory (api/routes/user.js) until they save their own.

import SteamID from 'steamid'

// a saved trade URL (the users collection keeps '' and older records 'null' for "none")
export const is_set = (link) => typeof link == 'string' && link !== '' && link !== 'null'

// the partner (account id) and token of a pasted trade URL, or null when it isn't one
export const parse = (text) => {
  if (typeof text != 'string') return null
  const value = text.trim()
  if (!value || value.length > 300) return null
  let url
  try { url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value) } catch (e) { return null }
  if (!/^(www\.)?steamcommunity\.com$/i.test(url.hostname)) return null
  if (!/^\/tradeoffer\/new\/?$/i.test(url.pathname)) return null
  const partner = url.searchParams.get('partner') || ''
  const token = url.searchParams.get('token') || ''
  if (!/^\d{1,10}$/.test(partner) || !/^[A-Za-z0-9_-]{6,16}$/.test(token)) return null
  return { partner: String(Number(partner)), token }
}

// the account id a trade URL of this Steam account carries as partner ('' when the steamid isn't one)
export const account_of = (steamid) => {
  try { return String(new SteamID(String(steamid)).accountid) } catch (e) { return '' }
}

// 'ok' with the URL in the one form we save, 'format' (not a trade URL) or 'other_account' (someone else's)
export const check = (text, steamid) => {
  const parsed = parse(text)
  if (!parsed) return { result: 'format' }
  const accountid = account_of(steamid)
  if (!accountid) return { result: 'format' }
  if (parsed.partner !== accountid) return { result: 'other_account' }
  return { result: 'ok', url: `https://steamcommunity.com/tradeoffer/new/?partner=${parsed.partner}&token=${parsed.token}` }
}

// pages a user without a trade URL can still read without the window: the terms and the cookie policy (linked from
// the window itself), the sign-in and sign-out steps, the admin panel
export const FREE_PAGES = /^\/(terms-of-service|cookies|logout|auth|get_userDB_|admin|login)(\/|$)/
