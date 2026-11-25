import fetch from 'node-fetch'

// The key banking page (/keys): our bank bots swap keys for metal, 1 to 5 keys a trade (bot_manager bot/keyBank.js,
// KEY_BANK.md there). bot_manager pushes what the page shows ('keybank:status' on the bots socket, service/socket.js)
// and answers 'keybank:get'; open /keys pages join the socket room 'keybank' ('keybank:watch') and get every update.
// A trade request goes to bot_manager's POST /keys/trade; the offer then arrives like any site trade
// (sentOfferChanged / offer_status).

const ROOM = 'keybank'
const STALE_MS = 5 * 60 * 1000   // no push for this long: the page says the prices may be old
const state = { status: null, at: 0, io: null }

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : null
const ref = (n) => { const v = num(n); return v !== null && v > 0 && v < 10000 ? Math.round(v * 100) / 100 : null }
const count = (n) => { const v = num(n); return v !== null && v > 0 ? Math.min(999, Math.floor(v)) : 0 }
const text = (s, max = 64) => typeof s == 'string' ? s.trim().slice(0, max) : ''
const https = (s) => typeof s == 'string' && /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ''

// only what the page draws, checked (it goes into the HTML)
const clean = (s) => {
    if (!s || typeof s != 'object') { return null }
    const price = s.price && ref(s.price.buy) && ref(s.price.sell) ? { buy: ref(s.price.buy), sell: ref(s.price.sell) } : null
    return {
        at: num(s.at) || Date.now(),
        enabled: s.enabled === true,
        max_keys: Math.max(1, Math.min(10, count(s.max_keys) || 5)),
        price,
        market: s.market ? { buy: ref(s.market.buy), sell: ref(s.market.sell), updated: num(s.market.updated) || null } : null,
        bots: (Array.isArray(s.bots) ? s.bots : []).filter((b) => /^7656\d{13}$/.test(String(b?.steamid || ''))).slice(0, 10).map((b) => ({
            steamid: String(b.steamid), name: text(b.name) || null, avatar: https(b.avatar) || null, level: num(b.level),
            online: b.online === true, can_buy: count(b.can_buy), can_sell: count(b.can_sell)
        })),
        history: (Array.isArray(s.history) ? s.history : []).slice(-24 * 7).filter((h) => Array.isArray(h) && num(h[0]) && ref(h[1]))
            .map((h) => [num(h[0]), ref(h[1]), ref(h[2]) || ref(h[1]), ref(h[3]) || ref(h[1])])
    }
}

const update = (status) => {
    const c = clean(status)
    if (!c) { return }
    state.status = c
    state.at = Date.now()
    state.io?.to(ROOM).emit('keybank:status', c)
}

// the latest status for the page, null before bot_manager sent one; stale: no update for a while (bots server away)
const current = () => state.status ? { ...state.status, stale: Date.now() - state.at > STALE_MS } : null

const start = (io) => {
    state.io = io
    io.on('connection', (socket) => {
        socket.on('keybank:watch', (ack) => {
            socket.join(ROOM)
            if (typeof ack == 'function') { ack(current()) }
        })
    })
}

// the bots socket just connected: ask for the status at once
const ask = (bots_io) => {
    try { bots_io.emit('keybank:get', (status) => update(status)) } catch (e) { /* next push */ }
}

/**
 * A key swap for a signed-in user: { steamid, tradeurl, bot, side: 'buy' | 'sell' (the user's), keys, price (ref per
 * key the page showed) } → bot_manager's answer { success, status?, keys, price, total } or { success: 0, reason, error,
 * price?, status (the key bank's status then) }. Throws when bot_manager can't be reached.
 */
const request = async ({ steamid, tradeurl, bot, side, keys, price }) => {
    const res = await fetch(process.env.BOTS_ENDPOINT + '/keys/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            pass: process.env.PASSWORD,
            admin_password: process.env.ADMIN_PASSWORD,
            data: { partner_steamid: String(steamid), tradeurl, bot: String(bot), side, keys, price }
        }),
        timeout: 15000
    })
    const out = await res.json()
    if (out?.status && typeof out.status == 'object') { update(out.status) }
    return out
}

export { start, update, current, ask, request, clean }
