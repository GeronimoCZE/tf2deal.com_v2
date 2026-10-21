import fetch from 'node-fetch'
import { inventory_value_model as Snapshots } from '../model/InventoryValue.js'
import { item_model as Items } from '../model/Item.js'
import { trade_model } from '../model/Trade.js'
import * as app from '../app.js'

// Admin -> Inventory value: how much everything the bots hold is worth, and how that changed over a period (profit).
// Every 15 minutes it measures
//   - every item copy the bots hold (item_instances stock.items) at the item's current price: the price the site
//     sells that copy for (its own price, its killstreak tier's or the item's, whichever is highest, as on the
//     trade page) and what the bots pay for it (buy)
//   - the keys and metal of all bots, from the bot server (the same answer the trade page gets)
// and saves it (model/InventoryValue.js). A measurement is skipped while the bot server or the database is down,
// so a missing answer never looks like a loss.

const SLOT_MS = 15 * 60 * 1000
const MAX_POINTS = 400            // points in one chart
const PURE_NAMES = new Set(['Mann Co. Supply Crate Key', 'Refined Metal', 'Reclaimed Metal', 'Scrap Metal'])

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const round2 = (n) => Math.round(num(n) * 100) / 100
const db_ready = () => process.db_status?.connected === true

export const state = { running: null, last: 0, error: '', error_at: 0 }

// {key, metal} or a plain number -> ref
const to_ref = (value, key_ref) => (value && typeof value == 'object')
    ? num(value.key ?? value.keys) * key_ref + num(value.metal)
    : num(value)

const tier_of = (doc, ks) => {
    const tiers = Array.isArray(doc.killstreak) ? doc.killstreak : (doc.killstreak?.killstreaks || [])
    return tiers.find((t) => Number(t?.ks_tier ?? t?.kt ?? t?.tier) == ks)
}

// one copy's value in ref: { sell, buy }
export const copy_value = (doc, copy, key_ref) => {
    const ks = Number(copy?.ks) || 0
    const tier = ks > 0 ? tier_of(doc, ks) : null
    const tier_sell = tier ? to_ref(tier.sell, key_ref) : 0
    const tier_buy = tier ? to_ref(tier.buy, key_ref) : 0
    return {
        sell: Math.max(num(copy?.sell), tier_sell, num(doc.sell)),
        buy: tier_buy > 0 ? tier_buy : num(doc.buy)
    }
}

// every copy the bots hold, valued; each copy (bot + assetid) once
export const value_items = async (key_price) => {
    const docs = await Items.find(
        { $or: [{ 'stock.items.0': { $exists: true } }, { 'stock.cur': { $gt: 0 } }] },
        { bp_sku: 1, buy: 1, sell: 1, stock: 1, killstreak: 1, 'bptf_data.update_key_price': 1 }
    ).lean()
    const items = { count: 0, sell: 0, buy: 0, unpriced: 0 }
    const bots = {}
    const seen = new Set()
    for (const doc of docs) {
        if (PURE_NAMES.has(doc.bp_sku)) continue // keys and metal are counted from the bot server
        const key_ref = num(doc.bptf_data?.update_key_price) || key_price
        const copies = Array.isArray(doc.stock?.items) && doc.stock.items.length > 0
            ? doc.stock.items
            : Array.from({ length: Math.max(0, Math.floor(num(doc.stock?.cur))) }, () => ({})) // older records: a count only
        for (const copy of copies) {
            if (copy?.a != null) {
                const id = `${copy.ownerId || ''}:${copy.a}`
                if (seen.has(id)) continue
                seen.add(id)
            }
            const v = copy_value(doc, copy, key_ref)
            items.count++
            items.sell += v.sell
            items.buy += v.buy
            if (!(v.sell > 0)) items.unpriced++
            const bot = String(copy?.ownerId || 'unknown')
            bots[bot] = bots[bot] || { count: 0, sell: 0, buy: 0 }
            bots[bot].count++
            bots[bot].sell += v.sell
            bots[bot].buy += v.buy
        }
    }
    items.sell = round2(items.sell)
    items.buy = round2(items.buy)
    for (const b of Object.values(bots)) { b.sell = round2(b.sell); b.buy = round2(b.buy) }
    return { items, bots }
}

// keys and metal of all bots, from the bot server: { keys, metal (ref) }
const count = (v) => Array.isArray(v) ? v.length : num(v)
export const bot_pure = async () => {
    if (!process.env.BOTS_ENDPOINT) throw new Error('BOTS_ENDPOINT is not set')
    const res = await fetch(process.env.BOTS_ENDPOINT + '/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            admin_password: process.env.ADMIN_PASSWORD,
            pass: process.env.PASSWORD,
            filters: { bot: null, quality: null, type: null, particle: null, classes: null, order: null, price: null, search: null, page: 0 }
        }),
        timeout: 20000
    })
    const data = await res.json().catch(() => null)
    const pure = data?.inventory?.pure
    if (!res.ok || !pure || typeof pure != 'object') throw new Error(`the bot server sent no keys and metal (${res.status})`)
    // scrap is the smallest unit: 1 ref = 3 rec = 9 scrap
    const scrap = count(pure.ref) * 9 + count(pure.rec) * 3 + count(pure.scrap)
    return { keys: count(pure.key ?? pure.keys), metal: round2(scrap / 9) }
}

const key_price_now = () => num(app.key_price?.metal) || num(global.key_price?.metal)

// what everything is worth right now (not saved)
export const measure = async () => {
    if (!db_ready()) throw new Error('the database is not connected')
    const key_price = key_price_now()
    if (!(key_price > 0)) throw new Error('the key price is not known yet')
    const [pure, { items, bots }] = await Promise.all([bot_pure(), value_items(key_price)])
    return { t: Date.now(), key_price, keys: pure.keys, metal: pure.metal, items, bots }
}

// measure and save; one at a time
export const snapshot = () => {
    state.running = state.running || measure()
        .then((doc) => Snapshots.create(doc))
        .then((doc) => { state.last = doc.t; state.error = ''; return doc.toObject() })
        .catch((error) => {
            state.error = error?.message || String(error)
            state.error_at = Date.now()
            console.log('Inventory value: not measured:', state.error)
            return null
        })
        .finally(() => { state.running = null })
    return state.running
}

// a measurement in each 15-minute slot
const tick = async () => {
    if (!db_ready() || state.running) return
    const slot = Math.floor(Date.now() / SLOT_MS)
    if (Math.floor(state.last / SLOT_MS) == slot) return
    if (!state.last) { // after a restart: the newest saved one
        const newest = await Snapshots.findOne({}, { t: 1 }).sort({ t: -1 }).lean().catch(() => null)
        state.last = num(newest?.t)
        if (Math.floor(state.last / SLOT_MS) == slot) return
    }
    // after a failed try, wait a few minutes before the next one
    if (state.error && Date.now() - state.error_at < 3 * 60 * 1000) return
    await snapshot()
}

export const start = () => {
    setTimeout(() => tick().catch(() => {}), 30 * 1000)
    setInterval(() => tick().catch((e) => console.log('Inventory value:', e.message)), 60 * 1000)
}

// total value in ref of a saved measurement, at sell or buy prices
export const total = (s, basis = 'sell') => round2(num(s?.items?.[basis]) + num(s?.keys) * num(s?.key_price) + num(s?.metal))

const point = (s) => ({ t: s.t, key_price: s.key_price, keys: s.keys, metal: s.metal, items: s.items, sell: total(s, 'sell'), buy: total(s, 'buy') })

// trades with users (not between our bots) in [from, to]; trade times may be in ms or in seconds
const trades_between = (from, to) => trade_model.countDocuments({
    internalTrade: { $ne: true },
    $or: [{ timestamp: { $gte: from, $lte: to } }, { timestamp: { $gte: Math.floor(from / 1000), $lte: Math.floor(to / 1000) } }]
}).catch(() => null)

// The measurements in [from, to], at most MAX_POINTS (the last one of each stretch), and the first and the last one,
// whose difference is the profit of the period.
export const history = async ({ from, to }) => {
    to = Math.min(num(to) || Date.now(), Date.now())
    from = Math.max(0, num(from) || to - 24 * 60 * 60 * 1000)
    if (from >= to) throw new Error('The start has to be before the end.')
    const docs = await Snapshots.find({ t: { $gte: from, $lte: to } }, { t: 1, key_price: 1, keys: 1, metal: 1, items: 1 }).sort({ t: 1 }).lean()
    const first_ever = await Snapshots.findOne({}, { t: 1 }).sort({ t: 1 }).lean()
    if (!state.last) { // right after a restart
        const newest_ever = await Snapshots.findOne({}, { t: 1 }).sort({ t: -1 }).lean()
        state.last = Math.max(state.last, num(newest_ever?.t))
    }
    const newest = docs.length ? await Snapshots.findOne({ t: docs[docs.length - 1].t }).lean() : null

    const step = (to - from) / MAX_POINTS
    const points = []
    for (const doc of docs) {
        const p = point(doc)
        const last = points[points.length - 1]
        if (last && Math.floor((p.t - from) / step) == Math.floor((last.t - from) / step)) points[points.length - 1] = p
        else points.push(p)
    }
    if (docs.length && points[0].t != docs[0].t) points.unshift(point(docs[0])) // the chart starts at the period's start

    return {
        from, to,
        first_ever: first_ever?.t || null,
        start: docs.length ? point(docs[0]) : null,
        end: docs.length ? point(docs[docs.length - 1]) : null,
        bots: newest?.bots || {},
        unpriced: newest?.items?.unpriced || 0,
        trades: docs.length ? await trades_between(docs[0].t, docs[docs.length - 1].t) : null,
        points,
        state: { last: state.last, error: state.error, error_at: state.error_at, every_min: SLOT_MS / 60000 }
    }
}
