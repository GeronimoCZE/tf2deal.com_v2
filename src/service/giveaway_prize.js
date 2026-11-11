// Giveaway prizes on the bank bot (contract with bot_manager: docs/GIVEAWAY_PRIZES.md).
//
// 1. The admin picks the prize from the items on the bot accounts, unpriced ones too (admin:giveaway:items).
// 2. bot_manager moves it to the bank bot and keeps it out of every trade, listing and bot move: only the winner's
//    offer may take it (admin:giveaway:reserve). Its answer comes later as a `giveaway:prize` push (held / move_failed).
// 3. When the winner is drawn, the bank bot sends them an offer with only the prize in it (admin:giveaway:send).
//    No trade link yet, Steam down, bank bot offline: tried again every few minutes, and at once when the winner saves
//    a trade link. A declined or expired offer waits for "Send again" in the admin panel.
// 4. A cancelled giveaway, or one without entries, lets the item go (admin:giveaway:release): it stays on the bank
//    bot as a normal item and can be picked again.
//
// bot_manager answers over the socket the site keeps open to it (service/bot_manager.js ask()).
import * as bot_manager from './bot_manager.js'
import { giveaway_model } from '../model/Giveaway.js'
import { giveaway_archive_model } from '../model/GiveawayArchive.js'
import User from '../model/User.js'
import { notify } from './notifications.js'
import localEmitter from '../emitter.js'

const ITEMS_EVENT = 'admin:giveaway:items'
const HANDLERS_TTL = 5 * 60 * 1000
const RETRY_MS = [2, 5, 10, 30, 60].map((min) => min * 60 * 1000) // after a failed automatic send; then every hour
const NO_LINK_RETRY_MS = 10 * 60 * 1000

// bot_manager's error codes for giveaway prizes, in words (the rest go through bot_manager.js)
const ERRORS = {
    no_bank_bot: 'Pick the bank bot first.',
    bank_bot_offline: 'The bank bot is not running.',
    prize_not_found: 'That item is not on the bot any more.',
    prize_reserved: 'That item is the prize of another giveaway already.',
    prize_not_held: 'The prize is not on the bank bot (yet).',
    prize_pure: 'Keys and metal can\'t be giveaway prizes.',
    item_not_tradable: 'That item can\'t be traded.',
    no_trade_link: 'The winner has no trade link yet.',
    invalid_trade_link: 'The winner\'s trade link doesn\'t work.',
    trade_hold: 'The winner can\'t take trades right now (Steam trade hold or ban).',
    offer_open: 'An offer for this prize is open already.',
    send_failed: 'Steam didn\'t take the offer.'
}
const readable = (res) => ERRORS[res?.code] || res?.message || 'bot_manager error'

// does the connected bot_manager know the giveaway prize events? (admin:handlers, cached)
let handlers = { at: 0, ok: false }
const supported = async () => {
    if(!bot_manager.online()){ return false }
    if(handlers.ok && Date.now() - handlers.at < HANDLERS_TTL){ return true }
    if(!handlers.ok && Date.now() - handlers.at < 30 * 1000){ return false }
    const res = await bot_manager.ask('admin:handlers', {}, 'giveaways')
    const list = Array.isArray(res.data) ? res.data : []
    handlers = { at: Date.now(), ok: res.status == 'ok' && list.some((h) => h?.event == ITEMS_EVENT) }
    return handlers.ok
}
const forget_handlers = () => { handlers = { at: 0, ok: false } }

// 'offline' (not connected) | 'old' (doesn't know the events yet) | 'ready'
const status = async () => !bot_manager.online() ? 'offline' : (await supported()) ? 'ready' : 'old'
const not_ready = async () => {
    const s = await status()
    if(s == 'ready'){ return null }
    return s == 'offline'
        ? { status: 'error', offline: true, message: 'bot_manager is not connected to the site.' }
        : { status: 'error', old: true, message: 'bot_manager doesn\'t have giveaway prizes yet. It needs the events in docs/GIVEAWAY_PRIZES.md.' }
}

const ask = async (event, payload, admin) => {
    const blocked = await not_ready()
    if(blocked){ return blocked }
    const res = await bot_manager.ask(event, payload, admin)
    return res.status == 'ok' ? res : { ...res, message: readable(res) }
}

// ------------------------------------------------------------------ admin panel

// every tradable item on the bot accounts (not pure), unpriced ones too
const items = ({ query = '', offset = 0, limit = 60 } = {}, admin) =>
    ask(ITEMS_EVENT, { query: String(query).slice(0, 100), offset: Math.max(0, Number(offset) || 0), limit: Math.min(120, Math.max(1, Number(limit) || 60)) }, admin)

// { bank, candidates: [{ steamid, name, type, online }] }
const bank = (admin) => ask('admin:giveaway:bank', {}, admin)
const set_bank = (steamid, admin) => ask('admin:giveaway:bank:set', { steamid: String(steamid || '') }, admin)

// moves the picked item to the bank bot for this giveaway; the result arrives as a `giveaway:prize` push
const reserve = async (giveaway_id, pick, admin) => {
    const res = await ask('admin:giveaway:reserve', { giveaway: String(giveaway_id), bot: String(pick.bot), assetid: String(pick.assetid) }, admin)
    if(res.status != 'ok'){ return res }
    const data = res.data || {}
    // a `giveaway:prize` push that came before this answer wins (it has the bank bot's new asset id)
    await giveaway_model.updateOne({ _id: giveaway_id, 'prize.state': { $in: ['moving', 'move_failed'] } }, { $set: {
        'prize.state': data.state == 'held' ? 'held' : 'moving',
        'prize.bank': String(data.bank || ''),
        'prize.bot': String(data.bot || pick.bot),
        'prize.assetid': String(data.assetid || pick.assetid),
        'prize.error': '',
        'prize.updated': Date.now()
    } })
    return res
}

// lets the item go: it stays on the bank bot as a normal item
const release = async (giveaway_id, admin) => {
    const giveaway = await giveaway_model.findById(giveaway_id, { prize: 1 }).lean()
    if(!giveaway?.prize?.state || ['accepted', 'released'].includes(giveaway.prize.state)){ return { status: 'ok' } }
    const res = await ask('admin:giveaway:release', { giveaway: String(giveaway_id) }, admin)
    if(res.status == 'ok' || res.code == 'prize_not_found'){
        await set_prize(giveaway_id, { state: 'released', error: '' })
    }
    return res
}

// ------------------------------------------------------------------ sending the prize to the winner

const set_prize = async (giveaway_id, fields) => {
    const set = { 'prize.updated': Date.now() }
    for (const [key, value] of Object.entries(fields)) { set[`prize.${key}`] = value }
    await giveaway_model.updateOne({ _id: giveaway_id }, { $set: set })
    archive_prize(giveaway_id).catch(() => {})
}

// keeps the archive record's prize in step with the giveaway
const archive_prize = async (giveaway_id) => {
    const g = await giveaway_model.findById(giveaway_id, { prize: 1, prize_sent: 1 }).lean()
    if(g){ await giveaway_archive_model.updateOne({ giveaway: g._id }, { $set: { prize: g.prize || null, prize_sent: Boolean(g.prize_sent), updated: Date.now() } }) }
}

const offer_link = (id) => id ? `https://steamcommunity.com/tradeoffer/${id}/` : ''

// the bank bot sends the winner an offer with only the prize. `admin` = sent from the panel (no backoff, any state
// but delivered); otherwise the automatic try (held, or a failed send whose wait is over).
const send = async (giveaway_id, admin = null) => {
    const giveaway = await giveaway_model.findById(giveaway_id).lean()
    if(!giveaway || giveaway.status != 'ended'){ return { status: 'error', message: 'That giveaway has not ended.' } }
    if(!giveaway.winner?.steamid){ return { status: 'error', message: 'That giveaway has no winner.' } }
    const prize = giveaway.prize
    if(!prize?.state){ return { status: 'error', message: 'This giveaway\'s prize is not on the bank bot. Send it yourself.' } }
    if(prize.state == 'accepted' || giveaway.prize_sent){ return { status: 'error', message: 'The winner has the prize already.' } }
    if(['moving', 'move_failed', 'released'].includes(prize.state) && !admin){ return { status: 'error', message: ERRORS.prize_not_held } }
    if(prize.state == 'sending' && Date.now() - (prize.updated || 0) < 2 * 60 * 1000){ return { status: 'error', message: 'Sending already.' } }

    const steamid = giveaway.winner.steamid
    const user = await User.findOne({ steamid }, { tradelink: 1 }).lean()
    const tradelink = String(user?.tradelink || '')
    if(!tradelink){
        // the winner gets one reminder; sent at once when they save a trade link (user route → winner_saved_tradelink)
        if(prize.error != 'no_trade_link'){
            notify({ to: steamid, type: 'giveaway_tradelink', vars: { item: giveaway.item?.bp_sku || prize.name }, link: '/profile' })
        }
        await set_prize(giveaway._id, { error: 'no_trade_link', next_try: Date.now() + NO_LINK_RETRY_MS })
        return { status: 'error', code: 'no_trade_link', message: ERRORS.no_trade_link }
    }

    await set_prize(giveaway._id, { state: 'sending', error: '' })
    const res = await ask('admin:giveaway:send', {
        giveaway: String(giveaway._id),
        steamid,
        tradelink,
        message: `Congratulations! You won the TF2Deal.com giveaway: ${giveaway.item?.bp_sku || prize.name}.`
    }, admin || 'giveaways')

    if(res.status != 'ok'){
        const tries = admin ? (prize.tries || 0) : (prize.tries || 0) + 1
        await set_prize(giveaway._id, {
            state: res.code == 'prize_not_held' ? prize.state : 'send_failed',
            error: res.message,
            tries,
            next_try: Date.now() + RETRY_MS[Math.max(0, Math.min(tries, RETRY_MS.length) - 1)]
        })
        if(!admin){ console.log(`giveaway: sending the prize to ${steamid} failed (${res.code || res.message}), trying again later`) }
        return res
    }

    const offer_id = String(res.data?.offerID || res.data?.offer_id || '')
    await set_prize(giveaway._id, { state: 'sent', offer_id, sent: Date.now(), error: '' })
    notify({ to: steamid, type: 'giveaway_prize_sent', vars: { item: giveaway.item?.bp_sku || prize.name }, link: offer_link(offer_id) || '/profile/giveaways' })
    return { status: 'ok', offer_id }
}

// sends of winners waiting for the prize: held (just drawn), or a failed / no-trade-link try whose wait is over
const send_due = async () => {
    if(!bot_manager.online()){ return }
    const due = await giveaway_model.find({
        status: 'ended', 'winner.steamid': { $ne: null }, prize_sent: { $ne: true },
        'prize.state': { $in: ['held', 'send_failed'] },
        $or: [{ 'prize.next_try': { $lte: Date.now() } }, { 'prize.next_try': { $exists: false } }]
    }, { _id: 1 }).limit(10).lean()
    for (const g of due) { await send(g._id).catch((error) => console.log('giveaway: sending the prize failed', error.message)) }
}

// the winner saved a trade link: their waiting prize goes out now
const winner_saved_tradelink = async (steamid) => {
    const waiting = await giveaway_model.find({
        status: 'ended', 'winner.steamid': String(steamid), prize_sent: { $ne: true },
        'prize.state': { $in: ['held', 'send_failed'] }
    }, { _id: 1 }).lean()
    for (const g of waiting) { await send(g._id).catch(() => {}) }
}

// ------------------------------------------------------------------ bot_manager pushes

// `giveaway:prize` { giveaway, state, bot, assetid, offerID, error }
const STATES = new Set(['moving', 'held', 'move_failed', 'sent', 'accepted', 'declined', 'canceled', 'expired', 'send_failed', 'released'])
const on_update = async (data) => {
    const id = String(data?.giveaway || '')
    if(!/^[a-f0-9]{24}$/i.test(id) || !STATES.has(data?.state)){ return }
    const giveaway = await giveaway_model.findById(id, { prize: 1, winner: 1, item: 1, prize_sent: 1, status: 1 }).lean()
    if(!giveaway?.prize){ return }

    const state = ['canceled', 'expired'].includes(data.state) ? 'declined' : data.state
    const fields = { state, error: String(data.error || '') }
    if(data.bot){ fields.bot = String(data.bot) }
    if(data.assetid){ fields.assetid = String(data.assetid) }
    if(data.offerID){ fields.offer_id = String(data.offerID) }

    if(state == 'held' && giveaway.status == 'ended' && giveaway.winner?.steamid){ fields.next_try = 0 } // drawn while moving: send now
    if(state == 'sent' && giveaway.prize.state != 'sent'){ fields.sent = Date.now() }
    if(state == 'accepted'){
        fields.delivered = Date.now()
        await giveaway_model.updateOne({ _id: id }, { $set: { prize_sent: true } })
    }
    if(state == 'declined' && data.state != 'declined'){ fields.error = data.state == 'expired' ? 'The offer expired.' : 'The offer was canceled.' }
    if(state == 'declined' && data.state == 'declined'){ fields.error = 'The winner declined the offer.' }
    await set_prize(id, fields)

    if(state == 'move_failed'){ console.log(`giveaway: moving the prize to the bank bot failed: ${fields.error || 'no reason given'}`) }
    if(state == 'held' && fields.next_try === 0){ send(id).catch(() => {}) }
}

// after a (re)connect: bot_manager's view of every prize it holds wins over ours
const sync = async () => {
    forget_handlers()
    if(!(await supported())){ return }
    const res = await bot_manager.ask('admin:giveaway:prizes', {}, 'giveaways')
    for (const p of (Array.isArray(res.data) ? res.data : [])) {
        await on_update(p).catch(() => {})
    }
    await send_due().catch(() => {})
}

localEmitter.on('bot_manager:giveaway_prize', (data) => { on_update(data).catch((error) => console.log('giveaway: prize update failed', error.message)) })
localEmitter.on('bots:connected', () => { setTimeout(() => sync().catch((error) => console.log('giveaway: prize sync failed', error.message)), 5000) })

// admin panel / profile wording of the prize state
const PRIZE_TEXT = {
    moving: 'Moving to the bank bot',
    held: 'On the bank bot',
    move_failed: 'Moving to the bank bot failed',
    sending: 'Sending the offer',
    sent: 'Offer sent',
    send_failed: 'Sending failed, trying again',
    declined: 'Offer declined or expired',
    accepted: 'Delivered',
    released: 'Released (normal item on the bank bot)'
}

export { status, supported, items, bank, set_bank, reserve, release, send, send_due, winner_saved_tradelink, on_update, sync, offer_link, PRIZE_TEXT }
