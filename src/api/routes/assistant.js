// The chat helper's API (service/assistant.js, public/js/plugins/assistant.js):
//
//   POST /api/assistant/chat   { chat, message, page, lang } -> { status: 'ok', reply: { text, cards }, turns_left }
//                              or { status: 'error', reason, message } (message in the visitor's language)
//   POST /api/assistant/reset  { chat }: forget that chat (the "New chat" button)
//
// The first layer of the firewall: only the site's own pages may call it (another site can't make a visitor's
// browser chat or burn the daily limit with their sign-in), a few messages per minute and per hour for each visitor
// (signed-in users by account, visitors by address), small bodies. While the helper is off it answers 404.

import express from 'express'
import rateLimit from 'express-rate-limit'

import * as assistant from '../../service/assistant.js'
import * as trade_url from '../../service/trade_url.js'
import { same_origin } from '../../mw.js'
import { LANGS } from '../../i18n.js'

export const router = express.Router()

const visitor = (req) => req.user?.steamid ? `u:${req.user.steamid}` : `ip:${req.ip}`

const limited = (req, res) => {
  assistant.count('rate_limited')
  res.status(429).json({ status: 'error', reason: 'rate_limited', message: req.__('assistant.rate_limited') })
}
// bursts: 6 messages a minute
const burst = rateLimit({ windowMs: 60 * 1000, max: 6, keyGenerator: visitor, standardHeaders: true, legacyHeaders: false, handler: limited })
// and 40 an hour signed in, 20 an hour for visitors who aren't
const hourly = rateLimit({ windowMs: 60 * 60 * 1000, max: (req) => (req.user?.steamid ? 40 : 20), keyGenerator: visitor, standardHeaders: true, legacyHeaders: false, handler: limited })
const resets = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: visitor, standardHeaders: true, legacyHeaders: false })

// off (no API key, or switched off in the admin panel): as if the API wasn't there
const on = (req, res, next) => assistant.enabled() ? next() : res.status(404).json({ status: 'error', reason: 'off' })

const MAX_BODY = 4096 // a message is 600 characters at most; the site takes up to 1 MB elsewhere (app.js)

const from_site = (req, res, next) => {
  if (!same_origin(req) || !req.is('application/json')) {
    assistant.count('cross_site')
    return res.status(403).json({ status: 'error', reason: 'forbidden' })
  }
  if (Number(req.get('content-length')) > MAX_BODY) return res.status(413).json({ status: 'error', reason: 'too_long', message: req.__('assistant.too_long') })
  next()
}

// what each reason says to the visitor (locales: assistant.*)
const MESSAGES = {
  empty: 'assistant.empty', too_long: 'assistant.too_long', not_text: 'assistant.empty', bad_chat: 'assistant.restart',
  daily_limit: 'assistant.daily_limit', busy: 'assistant.busy', turns: 'assistant.turns', busy_api: 'assistant.busy_api',
  too_long_to_answer: 'assistant.unavailable', unavailable: 'assistant.unavailable', off: 'assistant.unavailable'
}
const STATUS = { empty: 400, too_long: 400, not_text: 400, bad_chat: 400, daily_limit: 429, busy: 429, turns: 409, busy_api: 503, too_long_to_answer: 503, unavailable: 503, off: 404 }

router.post('/chat', on, from_site, burst, hourly, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const body = req.body && typeof req.body == 'object' ? req.body : {}
  const steamid = req.user?.steamid ? String(req.user.steamid) : null
  const out = await assistant.chat({
    id: typeof body.chat == 'string' ? body.chat : '',
    text: body.message,
    user: steamid ? { steamid } : null,
    lang: LANGS.includes(body.lang) ? body.lang : (req.lang || 'en'),
    page: typeof body.page == 'string' ? body.page.slice(0, 400) : '',
    // the trade URL saved at sign-in (the same check as the trade URL window, app.js needs_trade_url)
    has_trade_url: Boolean(steamid && trade_url.is_set(req.cookies?.[`td_${steamid}`]?.user?.tradelink))
  })
  if (out.status === 'ok') {
    if (out.reply.refused) out.reply.text = req.__('assistant.refused')
    return res.json(out)
  }
  res.status(STATUS[out.reason] || 503).json({ status: 'error', reason: out.reason, message: req.__(MESSAGES[out.reason] || 'assistant.unavailable') })
})

router.post('/reset', on, from_site, resets, (req, res) => {
  res.set('Cache-Control', 'no-store')
  assistant.reset(req.body?.chat, req.user?.steamid ? { steamid: String(req.user.steamid) } : null)
  res.json({ status: 'ok' })
})
