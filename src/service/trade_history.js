import { trade_model } from '../model/Trade.js'
import { item_model } from '../model/Item.js'

// Each item's sales per day, from the finished trades (the bots' side, toGive: items the bots sold). Stored on the item:
//   item_instances.trade_history                 the clean item (no killstreak)
//   item_instances.killstreak[i].trade_history   each killstreak tier on its own
// as [{ date: 'YYYY-MM-DD', volume, price, key }]: copies sold that day, the most common sell price that day in ref
// (the latest sale's price when no price repeats) and the key price in ref that day, to show prices in keys.
// Days are UTC. Every night the last 3 finished days are built again (the last 30 when the site starts), so a day
// that was missed, or written over by another app saving the item, is fixed by the next run.

const DAY = 24 * 60 * 60 * 1000
const KEEP_DAYS = 730          // entries kept per item / tier
const NIGHTLY_DAYS = 3
const START_DAYS = 30

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const day_of = (ms) => new Date(ms).toISOString().slice(0, 10)
const db_ready = () => process.db_status?.connected == true

// ref rounded to whole scrap, written like TF2 prices (91.33)
const ref = (value) => {
    const scrap = Math.round(num(value) * 9)
    return Math.trunc(scrap / 9) + (scrap % 9) * 0.11
}

const side_has = (side) => (side?.items || []).some((item) => Array.isArray(item?.user_stock) && item.user_stock.length > 0)
    || num(side?.keys) > 0 || num(side?.ref) > 0 || num(side?.rec) > 0 || num(side?.scrap) > 0
const pure_ref = (side, key_value) => num(side?.keys) * num(key_value) + num(side?.ref) + num(side?.rec) / 3 + num(side?.scrap) / 9

// Item prices in a trade record are the prices when the trade was requested; the bot prices the offer again when it
// sends it. When the other side is only keys and metal, scale the recorded prices to what was really paid
// (same rule as the "Latest trades" tooltip, public/js/plugins/trades_render.js).
const price_factor = (side, other, field, key_value) => {
    if (!(side?.items?.length > 0) || other?.items?.length > 0) { return 1 }
    if ((num(side?.keys) > 0 || num(other?.keys) > 0) && !(num(key_value) > 0)) { return 1 }
    const recorded = side.items.reduce((sum, item) => sum + (item?.user_stock || []).reduce((s, asset) => s + num(asset?.[field] || item?.[field]), 0), 0)
    const paid = pure_ref(other, key_value) - pure_ref(side, key_value)
    return (recorded > 0 && paid > 0) ? paid / recorded : 1
}

// most common price; on a tie the one sold last
const mode = (sales) => {
    const counts = new Map()
    for (const sale of sales) { counts.set(sale.price, (counts.get(sale.price) || 0) + 1) }
    const top = Math.max(...counts.values())
    for (let i = sales.length - 1; i >= 0; i--) {
        if (counts.get(sales[i].price) == top) { return sales[i].price }
    }
    return 0
}

// sales of the days [from, to) grouped as "bp_sku" -> tier -> date -> [{ price, time, key }]
const collect = async (from, to) => {
    const sales = new Map()
    const seen = new Set()
    const cursor = trade_model.find({ timestamp: { $gte: from, $lt: to } }, { tradeID: 1, partnerSteamID: 1, toGive: 1, toReceive: 1, key_value: 1, timestamp: 1 })
        .sort({ timestamp: 1 }).lean().cursor()
    for await (const trade of cursor) {
        if (!side_has(trade.toGive) || !side_has(trade.toReceive)) { continue }
        // the same trade saved twice counts once
        const id = trade.tradeID ? `${trade.tradeID}|${trade.partnerSteamID}` : String(trade._id)
        if (seen.has(id)) { continue }
        seen.add(id)

        const factor = price_factor(trade.toGive, trade.toReceive, 'sell', trade.key_value)
        const date = day_of(trade.timestamp)
        for (const item of (trade.toGive?.items || [])) {
            if (!item?.bp_sku) { continue }
            for (const asset of (item.user_stock || [])) {
                const tier = [1, 2, 3].includes(Number(asset?.ks)) ? Number(asset.ks) : 0
                const price = ref(num(asset?.sell || item?.sell) * factor)
                if (!(price > 0)) { continue }
                const by_tier = sales.get(item.bp_sku) || new Map()
                const by_date = by_tier.get(tier) || new Map()
                const list = by_date.get(date) || []
                list.push({ price, time: num(trade.timestamp), key: num(trade.key_value) })
                by_date.set(date, list)
                by_tier.set(tier, by_date)
                sales.set(item.bp_sku, by_tier)
            }
        }
    }
    return sales
}

const entries = (by_date) => [...(by_date || new Map()).entries()].map(([date, list]) => ({
    date,
    volume: list.length,
    price: mode(list),
    key: ref(list[list.length - 1].key)
}))

// the item's history with the rebuilt days replaced
const merge = (existing, dates, fresh) => [...(Array.isArray(existing) ? existing : []).filter((e) => !dates.has(e?.date)), ...fresh]
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-KEEP_DAYS)

const tier_of = (entry) => Number(entry?.kt ?? entry?.ks_tier ?? entry?.tier) || 0

// Builds the days [today - days, today) again. Returns how many items changed.
const rebuild = async (days) => {
    const today = Date.parse(day_of(Date.now()))
    const from = today - days * DAY
    const dates = new Set()
    for (let t = from; t < today; t += DAY) { dates.add(day_of(t)) }

    const sales = await collect(from, today)
    // items that sold in these days, and items that have entries for them (to drop entries that no longer apply)
    const items = await item_model.find({ $or: [
        { bp_sku: { $in: [...sales.keys()] } },
        { 'trade_history.date': { $in: [...dates] } },
        { 'killstreak.trade_history.date': { $in: [...dates] } }
    ] }, { bp_sku: 1, trade_history: 1, killstreak: 1 }).lean()

    const ops = []
    for (const item of items) {
        const by_tier = sales.get(item.bp_sku) || new Map()
        const set = {}
        const filter = { _id: item._id }

        const base = merge(item.trade_history, dates, entries(by_tier.get(0)))
        if (JSON.stringify(base) != JSON.stringify(item.trade_history || [])) { set.trade_history = base }

        if (Array.isArray(item.killstreak)) {
            item.killstreak.forEach((entry, i) => {
                const tier = tier_of(entry)
                if (!(tier >= 1 && tier <= 3)) { return }
                const history = merge(entry?.trade_history, dates, entries(by_tier.get(tier)))
                if (JSON.stringify(history) == JSON.stringify(entry?.trade_history || [])) { return }
                set[`killstreak.${i}.trade_history`] = history
                // only if that place in the array still holds the same tier
                const field = (entry?.kt != null) ? 'kt' : 'ks_tier'
                filter[`killstreak.${i}.${field}`] = entry[field]
            })
        }

        if (Object.keys(set).length) { ops.push({ updateOne: { filter, update: { $set: set } } }) }
    }
    for (let i = 0; i < ops.length; i += 500) {
        await item_model.bulkWrite(ops.slice(i, i + 500), { ordered: false })
    }
    return ops.length
}

let built_on = null   // UTC day of the last build that worked
let running = false

const run = async (days) => {
    running = true
    try {
        const changed = await rebuild(days)
        console.log(`trade history: ${days} day(s) built, ${changed} item(s) updated`)
        return true
    } catch (e) {
        console.log('trade history: failed', e.message)
        return false
    } finally {
        running = false
    }
}

// a while after the site starts (the last 30 days), then each day just after midnight UTC (the last 3 days);
// a build that fails is tried again 5 minutes later
const check = async () => {
    const today = day_of(Date.now())
    if (built_on == today || running || !db_ready()) { return }
    if (await run(built_on === null ? START_DAYS : NIGHTLY_DAYS)) { built_on = today }
}

const start = () => {
    setTimeout(check, 2 * 60 * 1000)
    setInterval(check, 5 * 60 * 1000)
}

export { start, rebuild, mode, price_factor }
