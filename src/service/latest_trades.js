import { trade_model } from '../model/Trade.js'
import { site_shape, layout, record_time } from './trade_records.js'
import { public_bot, read_accounts } from './bot_names.js'

// "Latest trades" on the home page: today's trades, newest first. /api/latest_trades gives 5 at a time, as many times
// as the visitor asks, until today's trades run out (Nikolas 2026-11-27: "Show only trades made today and put no limit
// on how many 5 more trades user can view"), and the site socket sends new ones as they happen. "Today" starts at
// midnight UTC, the same day as the "N today" under the home page's trade total (service/stats.js).
// The bot server writes the trade records, in any of the layouts service/trade_records.js reads. Only trades with
// something on both sides are shown, never ones between our own bots, and each trade only once. Swaps of keys for
// metal (the key bank's /keys page, or any trade with only keys and metal: Nikolas 2026-11-25 "Dont include these key
// for metal or vice verca trades in latest trades feed") stay out; the trader still sees them in Profile -> Trades.
// A cleanup every 6 hours deletes records that are exact copies (same trade ID, partner and contents).
// Admin -> Trade records (check()) shows the newest records and why any of them isn't shown.

const PAGE = 5
const MAX = 5000          // today's trades kept in memory: a safety cap only, a day of trades is far fewer
const POLL_MS = 10 * 1000
const REFRESH_MS = 5 * 60 * 1000    // the whole day is read again, for records the bots fill in or change later
const RECENT_MS = 30 * 60 * 1000    // each poll also reads again the records from the last 30 minutes
const DUPLICATE_MS = 5 * 60 * 1000
const CLEANUP_MS = 6 * 60 * 60 * 1000
const ROOM = 'latest_trades'
const FIELDS = {
    toGive: 1, toReceive: 1, itemsToGive: 1, itemsToReceive: 1, internalTrade: 1, timestamp: 1, time: 1, created: 1, createdAt: 1, date: 1,
    key_value: 1, key_price: 1, tradeID: 1, offerID: 1, offer_id: 1, partnerSteamID: 1, partner: 1, bot: 1, keyBank: 1
}
const NOT_INTERNAL = { internalTrade: { $ne: true }, keyBank: { $ne: true } }

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const db_ready = () => process.db_status?.connected == true

// midnight UTC of the current day, in ms (as service/stats.js counts "today")
const start_of_day = (now = Date.now()) => {
    const d = new Date(now)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const is_today = (trade, since = start_of_day()) => num(trade?.timestamp) >= since

// a side counts when it has at least one item copy or some keys or metal
const side_has = (side) => (side?.items || []).some((item) => Array.isArray(item?.user_stock) && item.user_stock.length > 0)
    || num(side?.keys) > 0 || num(side?.ref) > 0 || num(side?.rec) > 0 || num(side?.scrap) > 0
// only keys and metal on both sides: a key swap
const item_count = (side) => (side?.items || []).reduce((n, item) => n + (Array.isArray(item?.user_stock) ? item.user_stock.length : 0), 0)
const pure_only = (trade) => item_count(trade?.toGive) == 0 && item_count(trade?.toReceive) == 0
// why a record from site_shape isn't a trade to show, or '' when it is
const skip_reason = (trade) => trade?.internalTrade ? 'a trade between our own bots'
    : trade?.keyBank ? 'a key bank swap (keys for metal, /keys)'
    : pure_only(trade) && (num(trade?.toGive?.keys) > 0 || num(trade?.toReceive?.keys) > 0) ? 'only keys and metal (a key swap)'
    : trade?.incomplete ? "some items couldn't be read (no name, and Steam didn't describe them)"
    : !side_has(trade?.toGive) ? 'nothing on our side'
    : !side_has(trade?.toReceive) ? "nothing on the user's side"
    : ''
const is_valid = (trade) => !skip_reason(trade)

// trade contents as text with sorted keys, so two copies of a record compare equal
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : (v && typeof v == 'object' && !(v instanceof Date)) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null)
const contents = (trade) => stable({ give: trade?.toGive ?? trade?.itemsToGive ?? null, receive: trade?.toReceive ?? trade?.itemsToReceive ?? null })

// shown already: the same trade ID and partner, or the same partner and contents a few minutes apart
const same_trade = (trade, other) => String(other._id) == String(trade._id) || (
    String(other.partnerSteamID ?? '') == String(trade.partnerSteamID ?? '') && (
        (trade.tradeID && String(other.tradeID) == String(trade.tradeID))
        || (Math.abs(num(other.timestamp) - num(trade.timestamp)) < DUPLICATE_MS && contents(other) == contents(trade))))
const is_duplicate = (trade, list) => list.some((other) => same_trade(trade, other))

// The same check for a whole day of trades: only the trades of the same partner can be the same trade, so they are
// kept by partner (a day can hold hundreds of trades, and each one is checked against all the others).
const trade_index = (list = []) => {
    const ids = new Set()
    const by_partner = new Map()
    const add = (trade) => {
        ids.add(String(trade._id))
        const partner = String(trade.partnerSteamID ?? '')
        if (!by_partner.has(partner)) { by_partner.set(partner, []) }
        by_partner.get(partner).push(trade)
    }
    list.forEach(add)
    const has = (trade) => ids.has(String(trade._id)) || is_duplicate(trade, by_partner.get(String(trade.partnerSteamID ?? '')) || [])
    return { add, has }
}

// One side of a trade as everyone may see it: the trader stays anonymous. Only the fields the page draws are kept (a
// record may carry more, like an owner's Steam ID). Asset IDs become 0, 1, 2...: a real one can be looked up on
// backpack.tf (item history), which names the copy's owners. Custom names and descriptions, and the inspect link
// (it names the owner), are left out for the same reason; the trader sees them in Profile -> Trades.
const PUBLIC_AT = ['killstreaker', 'sheen', 'paint', 'spells', 'strangeParts']
const public_at = (at) => {
    if (!at || typeof at != 'object') { return undefined }
    const out = Object.fromEntries(PUBLIC_AT.filter((k) => at[k] != null && at[k] !== '').map((k) => [k, at[k]]))
    return Object.keys(out).length ? out : undefined
}
const public_side = (side) => {
    let n = 0
    return {
        keys: num(side?.keys), ref: num(side?.ref), rec: num(side?.rec), scrap: num(side?.scrap),
        items: (side?.items || []).map((item) => ({
            bp_sku: item?.bp_sku, qualityID: item?.qualityID, effectID: item?.effectID, type: item?.type, image: item?.image,
            kit_image: item?.kit_image || undefined,
            buy: item?.buy, sell: item?.sell,
            user_stock: (Array.isArray(item?.user_stock) ? item.user_stock : []).map((copy) => ({
                a: String(n++), ks: copy?.ks, f: copy?.f, buy: copy?.buy, sell: copy?.sell,
                at: public_at(copy?.at), icon_url: typeof copy?.icon_url == 'string' ? copy.icon_url : undefined
            }))
        }))
    }
}

// what the browser gets: no trade ID, partner Steam ID or asset IDs (public_side); the bot's Steam ID and name (bots are
// public), for its label
const to_public = (trade) => ({
    id: String(trade._id), toGive: public_side(trade.toGive), toReceive: public_side(trade.toReceive),
    timestamp: trade.timestamp, key_value: trade.key_value, bot: public_bot(trade.bot)
})

const newest_first = (a, b) => b.timestamp - a.timestamp

// Today's valid, unique trades, newest first. The records are read 50 at a time in the order they were saved (_id),
// not by timestamp: some records have their timestamp in seconds, or keep their time in another field
// (trade_records.js record_time). Reading stops at the first 50 with nothing from today.
const pick = async (since = start_of_day()) => {
    const picked = []
    const seen = trade_index()
    let before = null
    while (picked.length < MAX) {
        const batch = await trade_model.find(before === null ? NOT_INTERNAL : { ...NOT_INTERNAL, _id: { $lt: before } }, FIELDS).sort({ _id: -1 }).limit(50).lean()
        const today = batch.filter((record) => record_time(record) >= since)
        for (const trade of today.length ? await site_shape(today) : []) {
            if (picked.length < MAX && is_today(trade, since) && is_valid(trade) && !seen.has(trade)) {
                picked.push(trade)
                seen.add(trade)
            }
        }
        if (batch.length < 50 || !today.length) { break }
        before = batch[batch.length - 1]._id
    }
    return picked.sort(newest_first)
}

// list: today's trades (since `day`), newest first
const state = { list: [], day: 0, loaded: 0, last_id: null, io: null, busy: false }

// a new day (UTC) leaves yesterday's trades out
const trim = () => {
    const since = start_of_day()
    if (state.day == since) { return }
    state.day = since
    state.list = state.list.filter((trade) => is_today(trade, since))
}

// shows a trade on open home pages when it is newer than all of them
const announce = (trade, newest) => {
    if (trade.timestamp > newest) { state.io?.to(ROOM).emit('latest_trade', to_public(trade)) }
}

const refresh = async () => {
    const before = state.list
    const newest = before.length ? before[0].timestamp : Infinity
    const since = start_of_day()
    const list = await pick(since)
    state.day = since
    state.list = list
    state.loaded = Date.now()
    const known = new Set(before.map((old) => String(old._id)))
    for (const trade of [...list].reverse()) {
        if (!known.has(String(trade._id))) { announce(trade, newest) }
    }
}

// new records since the last look (by _id, i.e. the order they were saved in), plus the ones from the last 30 minutes
// again, in case the bot server fills them in later
const tick = async () => {
    if (!db_ready() || state.busy) { return }
    state.busy = true
    try {
        if (state.last_id === null) {
            const newest = await trade_model.findOne({}, { _id: 1 }).sort({ _id: -1 }).lean()
            state.last_id = newest?._id ?? 0
            await refresh()
            return
        }
        trim()
        if (Date.now() - state.loaded > REFRESH_MS) { await refresh() }

        const fresh = await trade_model.find(state.last_id ? { _id: { $gt: state.last_id } } : {}, FIELDS).sort({ _id: 1 }).limit(50).lean()
        if (fresh.length) { state.last_id = fresh[fresh.length - 1]._id }
        const recent_since = Date.now() - RECENT_MS
        const recent = await trade_model.find({ ...NOT_INTERNAL, $or: [{ timestamp: { $gte: recent_since } }, { timestamp: { $gte: Math.floor(recent_since / 1000), $lt: 1e11 } }] }, FIELDS)
            .sort({ timestamp: -1 }).limit(50).lean()
        const ids = new Set(fresh.map((r) => String(r._id)))

        const newest = state.list.length ? state.list[0].timestamp : 0
        const since = start_of_day() // today only
        const shaped = await site_shape([...fresh, ...recent.filter((r) => !ids.has(String(r._id)))].filter((r) => record_time(r) >= since))
        const seen = trade_index(state.list)
        for (const trade of shaped.sort((a, b) => a.timestamp - b.timestamp)) { // oldest first, so open pages end up in order
            if (!is_today(trade, since) || !is_valid(trade) || seen.has(trade)) { continue }
            seen.add(trade)
            state.list = [trade, ...state.list].sort(newest_first).slice(0, MAX)
            announce(trade, newest)
        }
    } finally {
        state.busy = false
    }
}

// Up to PAGE of today's trades: the newest ones, or the ones after the trade with id `after` (older than `before`, a ms
// timestamp, when that trade has left the list since). { trades, more, count, day, now }: more is true while today has
// more trades after these, count is how many trades today has, day when today started (midnight UTC) and now the
// server's time, so the page can tell when the day is over even when the visitor's clock is off.
const latest = async ({ after = '', before = 0, limit = PAGE } = {}) => {
    if (!state.loaded) { await refresh() }
    trim()
    await read_accounts() // the bots' names (at once when they were read in the last 10 minutes)
    const list = state.list
    let start = 0
    if (after) {
        const index = list.findIndex((trade) => String(trade._id) == String(after))
        start = index >= 0 ? index + 1 : (num(before) > 0 ? list.findIndex((trade) => trade.timestamp < num(before)) : list.length)
        if (start < 0) { start = list.length }
    }
    const count = Math.min(Math.max(1, Math.floor(num(limit)) || PAGE), PAGE)
    return { trades: list.slice(start, start + count).map(to_public), more: start + count < list.length, count: list.length, day: state.day, now: Date.now() }
}

// what one side of a shaped trade holds, in words: "2 items, 1 key, 11.11 ref"
const side_words = (side) => {
    const copies = (side?.items || []).reduce((n, item) => n + (item?.user_stock?.length || 0), 0)
    const metal = num(side?.ref) + num(side?.rec) / 3 + num(side?.scrap) / 9
    const parts = [
        ...(copies ? [`${copies} item${copies == 1 ? '' : 's'}`] : []),
        ...(num(side?.keys) ? [`${num(side.keys)} key${num(side.keys) == 1 ? '' : 's'}`] : []),
        ...(metal ? [`${Math.round(metal * 100) / 100} ref`] : [])
    ]
    return parts.length ? parts.join(', ') : 'nothing'
}

// Admin -> Trade records: the newest `count` records as the bots saved them, and whether the home page shows each one
// (status shown / skipped / duplicate / older (from before today, UTC), with the reason).
const check = async (count = 20) => {
    if (!state.loaded) { await refresh() }
    trim()
    const records = await trade_model.find({}).sort({ _id: -1 }).limit(count).lean()
    const shaped = await site_shape(records)
    const shown = state.list
    return records.map((record, i) => {
        const trade = shaped[i]
        const id = String(record._id)
        const reason = skip_reason(trade)
        const others = state.list.filter((t) => String(t._id) != id)
        const status = shown.some((t) => String(t._id) == id) ? 'shown' : reason ? 'skipped'
            : (is_today(trade) && is_duplicate(trade, others)) ? 'duplicate' : 'older'
        const raw = JSON.stringify(record, null, 2)
        return {
            id, status,
            reason: status == 'skipped' ? reason : status == 'duplicate' ? 'the same trade as one already shown' : '',
            time: trade.timestamp || null,
            bot: trade.bot ?? null,
            partner: trade.partnerSteamID ?? null,
            gave: side_words(trade.toGive),
            got: side_words(trade.toReceive),
            layout: layout(record),
            raw: raw.length > 20000 ? raw.slice(0, 20000) + '\n…' : raw
        }
    })
}

// Deletes records that are exact copies of another one (same trade ID, partner, and what was given and received),
// keeping the oldest. Returns how many were deleted.
const remove_duplicates = async () => {
    const groups = await trade_model.aggregate([
        { $match: { tradeID: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: { tradeID: '$tradeID', partner: '$partnerSteamID' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } }
    ]).allowDiskUse(true)

    let removed = 0
    for (const group of groups) {
        const records = await trade_model.find({ tradeID: group._id.tradeID, partnerSteamID: group._id.partner }).sort({ timestamp: 1, _id: 1 }).lean()
        const kept = []
        const copies = []
        for (const record of records) {
            if (kept.some((k) => contents(k) == contents(record))) { copies.push(record._id) }
            else { kept.push(record) }
        }
        if (copies.length) {
            await trade_model.deleteMany({ _id: { $in: copies } })
            removed += copies.length
        }
    }
    if (removed) {
        console.log(`latest trades: deleted ${removed} duplicate trade record(s)`)
        await refresh()
    }
    return removed
}

const cleanup = () => {
    if (!db_ready()) { return }
    remove_duplicates().catch((e) => console.log('latest trades: cleanup failed', e.message))
}

const start = (io) => {
    state.io = io
    io.on('connection', (socket) => {
        // the home page asks once its list is loaded (and again after reconnecting) and gets today's newest trades back,
        // so trades that came in while it was away are not missed
        socket.on('latest_trades:watch', async (ack) => {
            socket.join(ROOM)
            if (typeof ack != 'function') { return }
            try { ack((await latest()).trades) } catch (e) { ack([]) }
        })
    })
    setInterval(() => tick().catch((e) => console.log('latest trades:', e.message)), POLL_MS)
    setTimeout(cleanup, 60 * 1000)
    setInterval(cleanup, CLEANUP_MS)
}

export { start, latest, check, remove_duplicates, is_valid, skip_reason, is_duplicate, contents, start_of_day }
