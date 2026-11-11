import { item_model } from '../model/Item.js'
import { copy_detail_model } from '../model/CopyDetail.js'

// Item details of single copies for finished trades ("Latest trades" on the home page, Profile -> Trades).
//
// bot_manager saves trades compactly: each copy is a bp_sku and an asset id, without its paint, spells, parts,
// killstreaker or sheen. The bots' stock (item_instances stock.items) has all of that in each copy's `at`, but a copy
// the bots traded away is no longer there. So every PASS_EVERY the copies in stock that have details are remembered in
// `copy_details` (model/CopyDetail.js), and details_for() looks a trade's copies up in the stock first, then there.
//
// A copy a visitor gave the bots gets a new asset id from Steam in the trade. When bot_manager saves the copy's old id,
// only bot_manager can tell its details: it can save the copy's `at` (and icon_url) with each copy of a saved trade,
// which the site then reads first (docs/TRADE_DETAILS.md).

const PASS_EVERY = 5 * 60 * 1000
const REWRITE_EVERY = 7 * 24 * 60 * 60 * 1000 // a copy still held is saved again this often, so it doesn't expire
const CACHE_MS = 10 * 60 * 1000               // a looked up copy is kept in memory this long
const MISS_MS = 2 * 60 * 1000                 // a copy nothing was found for is asked again after this long
const CACHE_KEEP = 5000
const DETAIL_KEYS = ['killstreaker', 'sheen', 'paint', 'spells', 'strangeParts', 'customName', 'customDesc']

const db_ready = () => process.db_status?.connected == true
const filled = (v) => Array.isArray(v) ? v.some((x) => typeof x == 'string' && x.trim()) : (typeof v == 'string' && !!v.trim())

// the parts of a copy's `at` worth showing in a finished trade (not the inspect link: it names the owner then);
// null when there are none
const clean_at = (at) => {
    if (!at || typeof at != 'object') { return null }
    const out = {}
    for (const key of DETAIL_KEYS) {
        if (filled(at[key])) { out[key] = Array.isArray(at[key]) ? at[key].filter((x) => typeof x == 'string' && x.trim()) : at[key] }
    }
    return Object.keys(out).length ? out : null
}

// { at, icon_url } of one copy, or null when it has nothing to show
const details_of = (copy) => {
    const at = clean_at(copy?.at)
    const icon_url = typeof copy?.icon_url == 'string' && copy.icon_url.trim() ? copy.icon_url.trim() : ''
    return (at || icon_url) ? { ...(at ? { at } : {}), ...(icon_url ? { icon_url } : {}) } : null
}

// asset id -> [time saved, JSON of the details], so a pass only writes what is new or changed
const saved = new Map()
const state = { running: false, last: 0, kept: 0 }

// one pass over the bots' stock: remembers the details of every copy that has some
const remember = async () => {
    if (!db_ready() || state.running) { return }
    state.running = true
    try {
        const now = Date.now()
        const writes = []
        const held = { $or: [{ 'stock.items.a': { $gt: '' } }, { 'stock.items.a': { $gte: -Infinity } }] } // the index on stock.items.a
        const cursor = item_model.find(held, { _id: 0, 'stock.items.a': 1, 'stock.items.at': 1, 'stock.items.icon_url': 1 }).lean().batchSize(200).cursor()
        for await (const doc of cursor) {
            for (const copy of (Array.isArray(doc?.stock?.items) ? doc.stock.items : [])) {
                const id = copy?.a != null && copy.a !== '' ? String(copy.a) : ''
                const details = id ? details_of(copy) : null
                if (!details) { continue }
                const text = JSON.stringify(details)
                const before = saved.get(id)
                if (before && before[1] == text && now - before[0] < REWRITE_EVERY) { continue }
                saved.set(id, [now, text])
                writes.push({ updateOne: { filter: { _id: id }, update: { $set: { at: details.at || {}, icon_url: details.icon_url || '', seen: new Date(now) } }, upsert: true } })
                if (writes.length >= 500) { await copy_detail_model.bulkWrite(writes.splice(0), { ordered: false }) }
            }
        }
        if (writes.length) { await copy_detail_model.bulkWrite(writes, { ordered: false }) }
        state.last = now
        state.kept = saved.size
    } catch (e) {
        console.log('copy details: reading the stock failed', e.message)
    } finally {
        state.running = false
    }
}

// asset id -> [time, details or null]
const cache = new Map()
const cached = (id) => {
    const hit = cache.get(id)
    if (!hit) { return undefined }
    if (Date.now() - hit[0] > (hit[1] ? CACHE_MS : MISS_MS)) { cache.delete(id); return undefined }
    return hit[1]
}
const keep = (id, details) => {
    cache.set(id, [Date.now(), details])
    for (const key of cache.keys()) {
        if (cache.size <= CACHE_KEEP) { break }
        cache.delete(key)
    }
}

// Map(asset id -> { at, icon_url }) for the copies that have details: from the bots' stock now, else from copy_details
const details_for = async (asset_ids) => {
    const found = new Map()
    const ids = [...new Set((asset_ids || []).map((a) => a == null ? '' : String(a)).filter((a) => /^\d{1,20}$/.test(a)))]
    const wanted = []
    for (const id of ids) {
        const hit = cached(id)
        if (hit === undefined) { wanted.push(id) } else if (hit) { found.set(id, hit) }
    }
    if (!wanted.length || !db_ready()) { return found }

    try {
        // asset ids are text, or numbers in older stock
        const in_stock = await item_model.find({ 'stock.items.a': { $in: [...wanted, ...wanted.map(Number).filter(Number.isSafeInteger)] } },
            { _id: 0, 'stock.items.a': 1, 'stock.items.at': 1, 'stock.items.icon_url': 1 }).lean().maxTimeMS(10 * 1000)
        const wanted_set = new Set(wanted)
        for (const doc of in_stock) {
            for (const copy of (doc?.stock?.items || [])) {
                const id = String(copy?.a ?? '')
                if (!wanted_set.has(id) || found.has(id)) { continue }
                const details = details_of(copy)
                if (details) { found.set(id, details) }
            }
        }
        const rest = wanted.filter((id) => !found.has(id))
        if (rest.length) {
            for (const doc of await copy_detail_model.find({ _id: { $in: rest } }).lean().maxTimeMS(10 * 1000)) {
                const details = details_of(doc)
                if (details) { found.set(String(doc._id), details) }
            }
        }
        for (const id of wanted) { keep(id, found.get(id) || null) }
    } catch (e) {
        console.log('copy details: lookup failed', e.message)
    }
    return found
}

const start = () => {
    setTimeout(() => remember(), 30 * 1000)
    setInterval(() => remember(), PASS_EVERY)
}

export { start, details_for, details_of, clean_at, remember }
