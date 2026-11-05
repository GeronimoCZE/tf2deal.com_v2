import mongoose from 'mongoose'
import { flip_model as Flips } from '../model/Flip.js'
import { trade_model } from '../model/Trade.js'
import { display_name } from './buy_link.js'
import * as app from '../app.js'

// Admin -> Flips: what the bots make on each item copy they buy and sell again.
//
// Every 2 minutes the bots' new saved trades (the `trades` collection, written by the bot server) are read, and each
// item copy a bot gave away in a trade with a user (not between our bots) is saved as a flip (model/Flip.js) with
// what it sold for and, when it can be found, what the bots paid for it:
//   1. 'paid': the bot server remembers what it paid for every copy it holds (its `item_costs` collection, Admin ->
//      Bot manager -> "What we paid"), but forgets it when the copy leaves. So the site keeps a copy of that list,
//      read every 2 minutes, and a sold copy's price is still there when its sale comes in.
//   2. 'trade': otherwise (bought and sold within minutes, sold while the site was down, or sold before this started):
//      the oldest saved purchase of the same item and killstreak tier that no other flip and no copy still held
//      used. An estimate, since Steam gives a copy a new asset id in every trade.
//   3. neither: saved without a bought price, and left out of the averages.
// Copies under one scrap (the 0.055 ref weapons the bots use as change) aren't flips and are skipped.
// The bot server deletes saved trades after 3 weeks (TRADE_KEEP_DAYS), the flips stay.
//
// Prices are kept as the items were priced, keys + ref, so a key that went up or down between buying and selling
// isn't profit or loss: the profit is (keys sold for - keys paid) at today's key price + (ref sold for - ref paid).

const TICK_MS = 2 * 60 * 1000
const OVERLAP_MS = 30 * 60 * 1000       // trades are saved a moment after they happen: each pass re-reads the last 30 min
const GONE_KEEP_MS = 2 * 60 * 60 * 1000 // a bought price stays known this long after the bot server forgot it
const PURE = new Set(['keys', 'ref', 'rec', 'scrap', 'Mann Co. Supply Crate Key', 'Refined Metal', 'Reclaimed Metal', 'Scrap Metal'])
const DAY = 24 * 60 * 60 * 1000
// copies priced under one scrap (0.11 ref) are the 0.055 ref weapons the bots use as change, not flips
const MIN_REF = 0.1

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const round2 = (n) => Math.round(num(n) * 100) / 100
const db_ready = () => process.db_status?.connected === true
// ms from ms or seconds (older saved trades are in seconds)
const to_ms = (t) => { const n = num(t); return n > 0 && n < 1e11 ? n * 1000 : n }
const variant = (bp_sku, ks) => `${bp_sku}|${num(ks) > 0 ? num(ks) : 0}`

export const state = {
    running: null, primed: false, last: 0, scanned_to: 0, error: '', error_at: 0,
    paid: new Map(),   // asset id -> { cost, key, at, trade, bp_sku, ks }: what the bot server paid, as last read
    gone: new Map()    // asset id -> { rec, at }: no longer in the bot server's list (sold or moved), kept a while
}

// 63 ref with a key at 60 -> { keys: 1, metal: 3 }
export const split = (ref, key) => {
    const value = Math.max(0, num(ref))
    if (!(num(key) > 0)) return { keys: 0, metal: round2(value) }
    const keys = Math.floor((value + 0.001) / key)
    return { keys, metal: Math.max(0, round2(value - keys * key)) }
}

// the item copies of one side of a saved trade, with their price: [{ bp_sku, a, ks, f, p, kr }], p = ref at the key
// price kr. Saved trades are compact ({ bp_sku, a, ks, f, p, k } per copy) or older (priced items with user_stock).
export const copies = (side, price_field, key_value) => {
    const out = []
    for (const item of (Array.isArray(side?.items) ? side.items : [])) {
        if (!item?.bp_sku || PURE.has(item.bp_sku)) continue
        if (!Array.isArray(item.user_stock)) {
            const ks = num(item.ks) > 0 ? num(item.ks) : 0
            const p = typeof item.p == 'number' ? item.p : (typeof item[price_field] == 'number' && !ks ? item[price_field] : 0)
            out.push({ bp_sku: item.bp_sku, a: String(item.a ?? item.assetid ?? ''), ks, f: item.f ? 1 : 0, p: num(p), kr: num(item.k ?? item.bptf_data?.update_key_price) || num(key_value) })
            continue
        }
        for (const c of item.user_stock) {
            const ks = num(c?.ks) > 0 ? num(c.ks) : 0
            const own = num(c?.[price_field]) > 0 ? num(c[price_field]) : 0
            const plain = !ks && num(item[price_field]) > 0 ? num(item[price_field]) : 0
            out.push({ bp_sku: item.bp_sku, a: String(c?.a ?? ''), ks, f: c?.f == 1 ? 1 : 0, p: own || plain, kr: num(item.bptf_data?.update_key_price) || num(key_value) })
        }
    }
    return out
}

// the bot server's bought prices, read again (fields as utils/holds.js in bot_manager saves them)
const read_paid = async () => {
    const docs = await mongoose.connection.db.collection('item_costs')
        .find({}, { projection: { _id: 0, assetid: 1, cost: 1, key: 1, at: 1, tradeID: 1, bp_sku: 1, ks: 1 } }).toArray()
    const now = Date.now()
    const fresh = new Map()
    for (const d of docs) {
        if (d?.assetid == null || !(num(d.cost) > 0)) continue
        fresh.set(String(d.assetid), { cost: num(d.cost), key: num(d.key), at: to_ms(d.at), trade: d.tradeID ? String(d.tradeID) : '', bp_sku: String(d.bp_sku || ''), ks: num(d.ks) })
    }
    for (const [id, rec] of state.paid) if (!fresh.has(id)) state.gone.set(id, { rec, at: now })
    for (const [id, g] of state.gone) if (fresh.has(id) || now - g.at > GONE_KEEP_MS) state.gone.delete(id)
    state.paid = fresh
}

// Saved purchases of these items from before `before` that nothing used yet, oldest first: variant -> [purchase]
const open_purchases = async (variants, before) => {
    const skus = [...new Set([...variants].map((v) => v.slice(0, v.lastIndexOf('|'))))]
    const trades = await trade_model.find(
        { internalTrade: { $ne: true }, timestamp: { $lt: before }, 'toReceive.items.bp_sku': { $in: skus } },
        { _id: 0, tradeID: 1, toReceive: 1, key_value: 1, timestamp: 1 }
    ).sort({ timestamp: 1 }).lean()
    if (!trades.length) return new Map()

    // copies of a purchase already accounted for: by a flip, or still held (the bot server knows what it paid)
    const taken = new Map()      // 'trade|variant' -> how many
    const taken_copies = new Set() // 'trade|asset id' (estimated flips name the copy)
    const take = (trade, v) => taken.set(`${trade}|${v}`, (taken.get(`${trade}|${v}`) || 0) + 1)
    const ids = trades.map((t) => String(t.tradeID))
    for (const f of await Flips.find({ buy_trade: { $in: ids } }, { _id: 0, buy_trade: 1, buy_a: 1, bp_sku: 1, ks: 1 }).lean()) {
        if (f.buy_a) taken_copies.add(`${f.buy_trade}|${f.buy_a}`)
        else take(f.buy_trade, variant(f.bp_sku, f.ks))
    }
    for (const rec of state.paid.values()) if (rec.trade) take(rec.trade, variant(rec.bp_sku, rec.ks))

    const open = new Map()
    for (const t of trades) {
        const trade = String(t.tradeID)
        for (const c of copies(t.toReceive, 'buy', t.key_value)) {
            const v = variant(c.bp_sku, c.ks)
            if (!variants.has(v) || !(c.p >= MIN_REF)) continue
            if (taken_copies.has(`${trade}|${c.a}`)) continue
            const left = taken.get(`${trade}|${v}`) || 0
            if (left > 0) { taken.set(`${trade}|${v}`, left - 1); continue }
            if (!open.has(v)) open.set(v, [])
            open.get(v).push({ trade, a: c.a, at: to_ms(t.timestamp), ...split(c.p, c.kr), key: c.kr })
        }
    }
    return open
}

// reads the trades saved since the last pass and saves their sold copies as flips; returns how many it saved
export const collect = async () => {
    if (!db_ready()) throw new Error('The database is not connected.')
    const started = Date.now()
    const since = state.scanned_to ? state.scanned_to - OVERLAP_MS : 0
    const trades = await trade_model.find(
        { internalTrade: { $ne: true }, timestamp: { $gte: since }, 'toGive.items.0': { $exists: true } },
        { _id: 0, tradeID: 1, bot: 1, toGive: 1, key_value: 1, timestamp: 1 }
    ).sort({ timestamp: 1 }).lean()

    const sales = []
    for (const t of trades) {
        for (const c of copies(t.toGive, 'sell', t.key_value)) {
            if (!c.a || !(c.p >= MIN_REF)) continue
            sales.push({ ...c, trade: String(t.tradeID || ''), bot: String(t.bot || ''), sold_at: to_ms(t.timestamp), key: num(t.key_value) || c.kr })
        }
    }
    const known = new Set()
    for (let i = 0; i < sales.length; i += 1000) {
        const ids = sales.slice(i, i + 1000).map((s) => s.a)
        for (const f of await Flips.find({ _id: { $in: ids } }, { _id: 1 }).lean()) known.add(f._id)
    }
    // each copy once (a trade saved twice names the same copies)
    const todo = sales.filter((s) => !known.has(s.a) && (known.add(s.a), true))

    // 1. what the bot server paid for that copy
    const docs = []
    const estimate = []
    for (const s of todo) {
        const rec = state.paid.get(s.a) || state.gone.get(s.a)?.rec
        const sold = split(s.p, s.kr)
        const doc = { _id: s.a, bp_sku: s.bp_sku, ks: s.ks, f: s.f, bot: s.bot, trade: s.trade, sold_at: s.sold_at, key: s.key, sell_keys: sold.keys, sell_metal: sold.metal }
        if (rec) {
            const cost_key = rec.key || s.key
            const paid = split(rec.cost, cost_key)
            Object.assign(doc, { cost_keys: paid.keys, cost_metal: paid.metal, cost_key, bought_at: rec.at, source: 'paid', buy_trade: rec.trade })
        } else {
            estimate.push(doc)
        }
        docs.push(doc)
    }
    // 2. the oldest open purchase of the same item, for the rest
    if (estimate.length) {
        const open = await open_purchases(new Set(estimate.map((d) => variant(d.bp_sku, d.ks))), Math.max(...estimate.map((d) => d.sold_at)))
        for (const doc of estimate) {
            const list = open.get(variant(doc.bp_sku, doc.ks)) || []
            const i = list.findIndex((b) => b.at <= doc.sold_at)
            if (i < 0) continue
            const [b] = list.splice(i, 1)
            Object.assign(doc, { cost_keys: b.keys, cost_metal: b.metal, cost_key: b.key, bought_at: b.at, source: 'trade', buy_trade: b.trade, buy_a: b.a })
        }
    }
    if (docs.length) {
        try {
            await Flips.insertMany(docs, { ordered: false })
        } catch (e) {
            // a flip another pass saved first: kept as it is
            if (!(e?.code == 11000 || e?.writeErrors?.every?.((w) => w.code == 11000))) throw e
        }
    }
    state.scanned_to = started
    return docs.length
}

const tick = async () => {
    if (state.running || !db_ready()) return
    state.running = (async () => {
        try {
            if (!state.primed) { await read_paid(); state.primed = true }
            const saved = await collect()
            await read_paid()
            state.last = Date.now()
            if (saved) console.log(`Flips: ${saved} sold cop${saved == 1 ? 'y' : 'ies'} saved`)
        } catch (e) {
            state.error = e?.message || String(e)
            state.error_at = Date.now()
            console.log('Flips:', state.error)
        }
    })()
    try { await state.running } finally { state.running = null }
}

export const run_now = async () => {
    if (state.running) await state.running
    await tick()
    return !state.error || state.error_at < state.last
}

export const start = () => {
    setTimeout(() => tick(), 45 * 1000)
    setInterval(() => tick(), TICK_MS)
}

// ---------------------------------------------------------------- Admin -> Flips

// the flips sold in [from, to], valued at today's key price
export const stats = async ({ from, to }) => {
    const now = Date.now()
    to = Number.isFinite(to) && to > 0 ? Math.min(to, now) : now
    from = Number.isFinite(from) && from >= 0 && from < to ? from : to - 7 * DAY
    const docs = await Flips.find({ sold_at: { $gte: from, $lte: to } }, { trade: 0, buy_a: 0 }).sort({ sold_at: -1 }).lean()
    const key = num(app.key_price?.metal) || num(docs[0]?.key)

    const sum = { flips: 0, unknown: 0, profit: 0, cost: 0, sold: 0, wins: 0, losses: 0, held_ms: 0, held_n: 0, paid: 0, estimated: 0 }
    const items = new Map()
    const rows = []
    for (const d of docs) {
        const name = display_name(d.bp_sku, d)
        const sold = d.sell_keys * key + d.sell_metal
        const has_cost = d.cost_keys != null && d.cost_metal != null
        const cost = has_cost ? d.cost_keys * key + d.cost_metal : null
        const profit = has_cost ? (d.sell_keys - d.cost_keys) * key + (d.sell_metal - d.cost_metal) : null
        const held = has_cost && d.bought_at > 0 && d.bought_at <= d.sold_at ? d.sold_at - d.bought_at : null
        if (!items.has(name)) items.set(name, { name, bp_sku: d.bp_sku, ks: d.ks, flips: 0, unknown: 0, profit: 0, cost: 0, held_ms: 0, held_n: 0 })
        const item = items.get(name)
        if (has_cost) {
            sum.flips++; sum.profit += profit; sum.cost += cost; sum.sold += sold
            if (profit > 0.005) sum.wins++
            else if (profit < -0.005) sum.losses++
            sum[d.source == 'paid' ? 'paid' : 'estimated']++
            item.flips++; item.profit += profit; item.cost += cost
            if (held != null) { sum.held_ms += held; sum.held_n++; item.held_ms += held; item.held_n++ }
        } else {
            sum.unknown++; item.unknown++
        }
        if (rows.length < 100) rows.push({ name, ks: d.ks, sold_at: d.sold_at, bot: d.bot, sold: round2(sold), cost: cost == null ? null : round2(cost), profit: profit == null ? null : round2(profit), held, source: d.source })
    }
    const avg = (total, n) => n ? round2(total / n) : null
    return {
        from, to, key_price: key,
        summary: {
            flips: sum.flips, unknown: sum.unknown, wins: sum.wins, losses: sum.losses, paid: sum.paid, estimated: sum.estimated,
            profit: round2(sum.profit), average: avg(sum.profit, sum.flips), margin: sum.cost > 0 ? Math.round(sum.profit / sum.cost * 1000) / 10 : null,
            held: sum.held_n ? Math.round(sum.held_ms / sum.held_n) : null
        },
        items: [...items.values()].filter((i) => i.flips > 0)
            .sort((a, b) => b.flips - a.flips || b.profit - a.profit).slice(0, 100)
            .map((i) => ({ name: i.name, bp_sku: i.bp_sku, ks: i.ks, flips: i.flips, unknown: i.unknown, profit: round2(i.profit), average: avg(i.profit, i.flips), margin: i.cost > 0 ? Math.round(i.profit / i.cost * 1000) / 10 : null, held: i.held_n ? Math.round(i.held_ms / i.held_n) : null })),
        recent: rows,
        state: { last: state.last, error: state.error, error_at: state.error_at, paid_known: state.paid.size }
    }
}
