import { trade_model } from '../model/Trade.js'
import { site_shape, layout } from './trade_records.js'

// "Latest trades" on the home page: /api/latest_trades gives 5 at a time (15 at most) and the site socket new ones.
// The bot server writes the trade records, in any of the layouts service/trade_records.js reads. Only trades with
// something on both sides are shown, never ones between our own bots, and each trade only once. A cleanup every 6 hours
// deletes records that are exact copies (same trade ID, partner and contents). Admin -> Trade records (check()) shows
// the newest records and why any of them isn't shown.

const LIMIT = 15          // the home page shows 5, then 5 more twice
const PAGE = 5
const KEEP = 40           // kept in memory, also to recognise duplicates
const POLL_MS = 10 * 1000
const REFRESH_MS = 2 * 60 * 1000    // the whole list is read again, for records the bots fill in or change later
const RECENT_MS = 30 * 60 * 1000    // each poll also reads again the records from the last 30 minutes
const DUPLICATE_MS = 5 * 60 * 1000
const CLEANUP_MS = 6 * 60 * 60 * 1000
const ROOM = 'latest_trades'
const FIELDS = {
    toGive: 1, toReceive: 1, itemsToGive: 1, itemsToReceive: 1, internalTrade: 1, timestamp: 1, time: 1, created: 1, createdAt: 1, date: 1,
    key_value: 1, key_price: 1, tradeID: 1, offerID: 1, offer_id: 1, partnerSteamID: 1, partner: 1, bot: 1
}
const NOT_INTERNAL = { internalTrade: { $ne: true } }

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const db_ready = () => process.db_status?.connected == true

// a side counts when it has at least one item copy or some keys or metal
const side_has = (side) => (side?.items || []).some((item) => Array.isArray(item?.user_stock) && item.user_stock.length > 0)
    || num(side?.keys) > 0 || num(side?.ref) > 0 || num(side?.rec) > 0 || num(side?.scrap) > 0
// why a record from site_shape isn't a trade to show, or '' when it is
const skip_reason = (trade) => trade?.internalTrade ? 'a trade between our own bots'
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
const is_duplicate = (trade, list) => list.some((other) => String(other._id) == String(trade._id) || (
    String(other.partnerSteamID ?? '') == String(trade.partnerSteamID ?? '') && (
        (trade.tradeID && String(other.tradeID) == String(trade.tradeID))
        || (Math.abs(num(other.timestamp) - num(trade.timestamp)) < DUPLICATE_MS && contents(other) == contents(trade)))))

// what the browser gets: no trade ID or partner Steam ID
const to_public = (trade) => ({ id: String(trade._id), toGive: trade.toGive, toReceive: trade.toReceive, timestamp: trade.timestamp, key_value: trade.key_value })

const newest_first = (a, b) => b.timestamp - a.timestamp

// the newest valid, unique trades, reading 50 records at a time in the order they were saved (_id): some records have
// their timestamp in seconds, which would sort them below all the others
const pick = async (limit) => {
    const picked = []
    let before = null
    for (let page = 0; page < 8 && picked.length < limit; page++) {
        const batch = await trade_model.find(before === null ? NOT_INTERNAL : { ...NOT_INTERNAL, _id: { $lt: before } }, FIELDS).sort({ _id: -1 }).limit(50).lean()
        for (const trade of await site_shape(batch)) {
            if (picked.length < limit && is_valid(trade) && !is_duplicate(trade, picked)) { picked.push(trade) }
        }
        if (batch.length < 50) { break }
        before = batch[batch.length - 1]._id
    }
    return picked.sort(newest_first)
}

const state = { list: [], loaded: 0, last_id: null, io: null, busy: false }

// shows a trade on open home pages when it is newer than all of them
const announce = (trade, newest) => {
    if (trade.timestamp > newest) { state.io?.to(ROOM).emit('latest_trade', to_public(trade)) }
}

const refresh = async () => {
    const before = state.list
    const newest = before.length ? before[0].timestamp : Infinity
    state.list = await pick(KEEP)
    state.loaded = Date.now()
    for (const trade of [...state.list.slice(0, LIMIT)].reverse()) {
        if (!before.some((old) => String(old._id) == String(trade._id))) { announce(trade, newest) }
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
        if (Date.now() - state.loaded > REFRESH_MS) { await refresh() }

        const fresh = await trade_model.find(state.last_id ? { _id: { $gt: state.last_id } } : {}, FIELDS).sort({ _id: 1 }).limit(50).lean()
        if (fresh.length) { state.last_id = fresh[fresh.length - 1]._id }
        const since = Date.now() - RECENT_MS
        const recent = await trade_model.find({ ...NOT_INTERNAL, $or: [{ timestamp: { $gte: since } }, { timestamp: { $gte: Math.floor(since / 1000), $lt: 1e11 } }] }, FIELDS)
            .sort({ timestamp: -1 }).limit(50).lean()
        const ids = new Set(fresh.map((r) => String(r._id)))

        const newest = state.list.length ? state.list[0].timestamp : 0
        const shaped = await site_shape([...fresh, ...recent.filter((r) => !ids.has(String(r._id)))])
        for (const trade of shaped.sort((a, b) => a.timestamp - b.timestamp)) { // oldest first, so open pages end up in order
            if (!is_valid(trade) || is_duplicate(trade, state.list)) { continue }
            state.list = [trade, ...state.list].sort(newest_first).slice(0, KEEP)
            announce(trade, newest)
        }
    } finally {
        state.busy = false
    }
}

// Up to PAGE trades: the newest ones, or the ones after the trade with id `after` (older than `before`, a ms timestamp,
// when that trade has left the list since). { trades, more }: more is true while there are more within the first LIMIT.
const latest = async ({ after = '', before = 0, limit = PAGE } = {}) => {
    if (!state.loaded) { await refresh() }
    const list = state.list.slice(0, LIMIT)
    let start = 0
    if (after) {
        const index = list.findIndex((trade) => String(trade._id) == String(after))
        start = index >= 0 ? index + 1 : (num(before) > 0 ? list.findIndex((trade) => trade.timestamp < num(before)) : list.length)
        if (start < 0) { start = list.length }
    }
    const count = Math.min(Math.max(1, Math.floor(num(limit)) || PAGE), PAGE)
    return { trades: list.slice(start, start + count).map(to_public), more: start + count < list.length }
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
// (status shown / skipped / duplicate / older, with the reason).
const check = async (count = 20) => {
    if (!state.loaded) { await refresh() }
    const records = await trade_model.find({}).sort({ _id: -1 }).limit(count).lean()
    const shaped = await site_shape(records)
    const shown = state.list.slice(0, LIMIT)
    return records.map((record, i) => {
        const trade = shaped[i]
        const id = String(record._id)
        const reason = skip_reason(trade)
        const others = state.list.filter((t) => String(t._id) != id)
        const status = shown.some((t) => String(t._id) == id) ? 'shown' : reason ? 'skipped' : is_duplicate(trade, others) ? 'duplicate' : 'older'
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
        // the home page asks once its list is loaded (and again after reconnecting) and gets the current list back,
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

export { start, latest, check, remove_duplicates, is_valid, skip_reason, is_duplicate, contents }
