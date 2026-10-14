import { trade_model } from '../model/Trade.js'

// "Latest trades" on the home page: /api/latest_trades for the first 15 and the site socket for new ones.
// The bot server writes the trade records. Only trades with something on both sides are shown, and each trade
// only once. A cleanup every 6 hours deletes records that are exact copies (same trade ID, partner and contents).

const LIMIT = 15          // the home page shows 5, then 5 more twice
const KEEP = 40           // kept in memory, also to recognise duplicates
const POLL_MS = 10 * 1000
const REFRESH_MS = 30 * 60 * 1000
const PENDING_MS = 15 * 60 * 1000   // a record that is still empty is checked again for this long
const DUPLICATE_MS = 5 * 60 * 1000
const CLEANUP_MS = 6 * 60 * 60 * 1000
const ROOM = 'latest_trades'
const FIELDS = { toGive: 1, toReceive: 1, timestamp: 1, key_value: 1, tradeID: 1, partnerSteamID: 1 }

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const db_ready = () => process.db_status?.connected == true

// a side counts when it has at least one item copy or some keys or metal
const side_has = (side) => (side?.items || []).some((item) => Array.isArray(item?.user_stock) && item.user_stock.length > 0)
    || num(side?.keys) > 0 || num(side?.ref) > 0 || num(side?.rec) > 0 || num(side?.scrap) > 0
const is_valid = (trade) => side_has(trade?.toGive) && side_has(trade?.toReceive)

// trade contents as text with sorted keys, so two copies of a record compare equal
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : (v && typeof v == 'object' && !(v instanceof Date)) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null)
const contents = (trade) => stable({ give: trade?.toGive ?? null, receive: trade?.toReceive ?? null })

// shown already: the same trade ID and partner, or the same partner and contents a few minutes apart
const is_duplicate = (trade, list) => list.some((other) => String(other._id) == String(trade._id) || (
    String(other.partnerSteamID ?? '') == String(trade.partnerSteamID ?? '') && (
        (trade.tradeID && String(other.tradeID) == String(trade.tradeID))
        || (Math.abs(num(other.timestamp) - num(trade.timestamp)) < DUPLICATE_MS && contents(other) == contents(trade)))))

// what the browser gets: no trade ID or partner Steam ID
const to_public = (trade) => ({ id: String(trade._id), toGive: trade.toGive, toReceive: trade.toReceive, timestamp: trade.timestamp, key_value: trade.key_value })

// the newest valid, unique trades, reading 50 records at a time
const pick = async (limit) => {
    const picked = []
    let before = null
    for (let page = 0; page < 8 && picked.length < limit; page++) {
        const batch = await trade_model.find(before === null ? {} : { timestamp: { $lt: before } }, FIELDS).sort({ timestamp: -1 }).limit(50).lean()
        for (const trade of batch) {
            if (picked.length < limit && is_valid(trade) && !is_duplicate(trade, picked)) { picked.push(trade) }
        }
        if (batch.length < 50) { break }
        before = batch[batch.length - 1].timestamp
    }
    return picked
}

const state = { list: [], loaded: 0, last_id: null, pending: new Map(), io: null, busy: false }

const refresh = async () => {
    state.list = await pick(KEEP)
    state.loaded = Date.now()
}

// new records since the last look (by _id, i.e. the order they were saved in), plus the empty ones from the last
// 15 minutes in case the bot server fills them in later
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
        const fresh = await trade_model.find(state.last_id ? { _id: { $gt: state.last_id } } : {}, FIELDS).sort({ _id: 1 }).limit(50).lean()
        if (fresh.length) { state.last_id = fresh[fresh.length - 1]._id }
        const again = state.pending.size ? await trade_model.find({ _id: { $in: [...state.pending.keys()] } }, FIELDS).lean() : []

        for (const trade of [...again, ...fresh]) {
            const id = String(trade._id)
            if (!is_valid(trade)) {
                if (!state.pending.has(id)) { state.pending.set(id, Date.now()) }
                continue
            }
            state.pending.delete(id)
            if (is_duplicate(trade, state.list)) { continue }
            state.list = [trade, ...state.list].sort((a, b) => num(b.timestamp) - num(a.timestamp)).slice(0, KEEP)
            state.io?.to(ROOM).emit('latest_trade', to_public(trade))
        }
        for (const [id, since] of state.pending) {
            if (Date.now() - since > PENDING_MS) { state.pending.delete(id) }
        }
        if (Date.now() - state.loaded > REFRESH_MS) { await refresh() }
    } finally {
        state.busy = false
    }
}

const latest = async () => {
    if (!state.loaded) { await refresh() }
    return state.list.slice(0, LIMIT).map(to_public)
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
            try { ack(await latest()) } catch (e) { ack([]) }
        })
    })
    setInterval(() => tick().catch((e) => console.log('latest trades:', e.message)), POLL_MS)
    setTimeout(cleanup, 60 * 1000)
    setInterval(cleanup, CLEANUP_MS)
}

export { start, latest, remove_duplicates, is_valid, is_duplicate, contents }
