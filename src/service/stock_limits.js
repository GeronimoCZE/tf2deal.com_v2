// Stock limits in the admin panel (js/admin.js -> #stock, routes: api/routes/admin.js -> /stock/*).
//
// How many of an item the bots hold at most is `stock.limit` on the item; each killstreak tier has its own `limit`
// in `item.killstreak`. The item server (item_manager) sets them again every time it prices an item:
//   - global rules: its live settings stock_limit_* and ks_stock_limit*. They are read and changed here over the
//     items socket (admin:get_settings / admin:update_settings), then applied to every item (admin:apply_stock_limits).
//   - single items: the limit is written straight onto the items, so it counts at once, together with a copy in
//     `stock.manual_limit` / `stock.manual_ks_limit`. The item server keeps those until they are cleared here.
import { item_model } from '../model/Item.js'
import { item_socket } from './socket.js'

export const GLOBAL_KEYS = ['stock_limit_default', 'stock_limit_unusual', 'stock_limit_unusual_min_pure', 'stock_limit_collectors',
  'stock_limit_collectors_min_pure', 'ks_stock_limit', 'ks_stock_limit_high_demand', 'ks_high_demand_buyorders']
export const MAX_LIMIT = 1000
const PER_PAGE = 100

const str = (value, max) => (typeof value == 'string') ? value.trim().slice(0, max) : ''
const escape_regex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const is_manual = (value) => typeof value == 'number' && Number.isFinite(value) && value >= 0

// one admin event to the item server, answered through the ack ({ success, ... })
const ask = (event, payload = {}, timeout = 10000) => new Promise((resolve) => {
  const socket = item_socket.socket
  if(!socket?.connected){ return resolve({ success: false, offline: true, error: 'The item server is not connected.' }) }
  socket.timeout(timeout).emit(event, payload, (err, res) => {
    resolve(err ? { success: false, error: 'The item server did not answer.' } : (res || { success: false, error: 'The item server sent no answer.' }))
  })
})

/* ---------- global limits (item server settings) ---------- */

export const get_global = async () => {
  const res = await ask('admin:get_settings')
  if(!res.success){ return { status: 'error', offline: !!res.offline, message: res.error || 'The item server refused.' } }
  const schema = res.schema || {}
  return {
    status: 'ok',
    limits: GLOBAL_KEYS.filter((key) => schema[key]).map((key) => ({
      key, value: res.settings?.[key] ?? schema[key].value, default: schema[key].default, min: schema[key].min, max: schema[key].max, desc: schema[key].desc
    })),
    // an item server from before the stock_limit_* settings only has the killstreak ones
    missing: GLOBAL_KEYS.filter((key) => !schema[key]),
    meta: res.meta || null
  }
}

export const set_global = async (patch, by) => {
  const values = {}
  for (const [key, value] of Object.entries((patch && typeof patch == 'object') ? patch : {})) {
    if(!GLOBAL_KEYS.includes(key)){ continue }
    const number = (typeof value == 'string' && value.trim() !== '') ? Number(value) : value
    if(typeof number != 'number' || !Number.isFinite(number)){ return { status: 'error', message: `${key} must be a number.` } }
    values[key] = number
  }
  if(Object.keys(values).length == 0){ return { status: 'error', message: 'Nothing to save.' } }

  const res = await ask('admin:update_settings', { settings: values, by })
  if(!res.success){
    return { status: 'error', message: [res.error, ...(Array.isArray(res.errors) ? res.errors : [])].filter(Boolean).join(' ') || 'The item server refused the change.' }
  }
  return { status: 'ok', changed: res.changed || [], ...(await apply_everywhere(res.settings)) }
}

// The settings reach an item at its next price update; this applies them to every item now. Item servers from
// before admin:apply_stock_limits don't answer it, so it is only asked when the stock_limit_* settings exist.
const apply_everywhere = async (settings) => {
  if(!settings || !('stock_limit_default' in settings)){ return { applied: null } }
  const res = await ask('admin:apply_stock_limits', {}, 120000)
  return res.success ? { applied: { checked: res.checked, changed: res.changed } } : { applied: null, apply_error: res.error }
}

/* ---------- items ---------- */

// filters from the admin panel -> a query on item_instances
//   q: part of the name, bp_sku: one exact item, type: "tool kit" or "group:tool" (every type starting with "tool"),
//   quality: qualityID, craftable: 'yes' | 'no', in_stock: true, killstreak: true (has tier prices),
//   manual: 'yes' | 'no' (a limit set by hand)
export const filter_query = (filters) => {
  const f = (filters && typeof filters == 'object') ? filters : {}
  const and = []

  const bp_sku = str(f.bp_sku, 300)
  if(bp_sku){ and.push({ bp_sku }) }
  const q = str(f.q, 100)
  if(q){ and.push({ bp_sku: { $regex: escape_regex(q), $options: 'i' } }) }

  const type = str(f.type, 80)
  if(type.startsWith('group:') && type.length > 6){ and.push({ type: { $regex: `^${escape_regex(type.slice(6))}( |$)`, $options: 'i' } }) }
  else if(type){ and.push({ type }) }

  const quality = str(String(f.quality ?? ''), 4)
  if(/^\d{1,3}$/.test(quality)){ and.push({ qualityID: quality }) }

  if(f.craftable === 'no'){ and.push({ bp_sku: { $regex: '^Non-Craftable ' } }) }
  if(f.craftable === 'yes'){ and.push({ bp_sku: { $not: /^Non-Craftable / } }) }
  if(f.in_stock === true){ and.push({ 'stock.cur': { $gt: 0 } }) }
  if(f.killstreak === true){ and.push({ 'killstreak.0': { $exists: true } }) }
  if(f.manual === 'yes'){ and.push({ $or: [{ 'stock.manual_limit': { $gte: 0 } }, { 'stock.manual_ks_limit': { $gte: 0 } }] }) }
  if(f.manual === 'no'){ and.push({ 'stock.manual_limit': { $not: { $gte: 0 } } }, { 'stock.manual_ks_limit': { $not: { $gte: 0 } } }) }

  return and.length ? { $and: and } : {}
}

const tier_limits = (killstreak) => {
  const limits = (Array.isArray(killstreak) ? killstreak : []).map((k) => k?.limit).filter((l) => typeof l == 'number')
  return limits.length ? [...new Set(limits)] : []
}

const row = (doc) => ({
  bp_sku: doc.bp_sku,
  type: doc.type || '',
  qualityID: doc.qualityID,
  effectID: Number(doc.effectID) > 0 ? Number(doc.effectID) : 0,
  image: doc.image || '',
  cur: Number(doc.stock?.cur) || 0,
  limit: (typeof doc.stock?.limit == 'number') ? doc.stock.limit : null,
  manual: is_manual(doc.stock?.manual_limit) ? doc.stock.manual_limit : null,
  tiers: Array.isArray(doc.killstreak) ? doc.killstreak.length : 0,
  tier_limits: tier_limits(doc.killstreak),
  manual_ks: is_manual(doc.stock?.manual_ks_limit) ? doc.stock.manual_ks_limit : null
})

export const find_items = async (filters, page = 0) => {
  const query = filter_query(filters)
  const skip = Math.max(0, Math.min(Number(page) || 0, 1000)) * PER_PAGE
  const [total, docs] = await Promise.all([
    item_model.countDocuments(query),
    item_model.find(query, { _id: 0, bp_sku: 1, type: 1, qualityID: 1, effectID: 1, image: 1, 'stock.cur': 1, 'stock.limit': 1,
      'stock.manual_limit': 1, 'stock.manual_ks_limit': 1, 'killstreak.limit': 1 }) // not stock.items: keys have thousands of copies
      .sort({ bp_sku: 1 }).skip(skip).limit(PER_PAGE).lean()
  ])
  return { status: 'ok', total, page: skip / PER_PAGE, per_page: PER_PAGE, items: docs.map(row) }
}

// item types for the filter, with "group:<first word>" for types that share their first word (tool, tool kit, ...)
export const options = async () => {
  const types = (await item_model.distinct('type')).filter((t) => typeof t == 'string' && t.trim()).sort()
  const firsts = types.map((t) => t.split(' ')[0])
  const groups = [...new Set(firsts)].filter((word) => firsts.filter((w) => w == word).length > 1 || !types.includes(word))
  const qualities = (await item_model.distinct('qualityID')).map(String).filter((q) => /^\d{1,3}$/.test(q)).sort((a, b) => a - b)
  return { status: 'ok', types, groups, qualities }
}

// Sets (or, with limit null, clears) the limit of every item the filters match.
//   target 'item':       stock.limit + stock.manual_limit
//   target 'killstreak': each killstreak tier's limit + stock.manual_ks_limit (only items with tier prices)
// Cleared limits go back to the item server's rules: right away when it can apply them, else at the next price update.
export const apply = async ({ filters, target, limit }, by) => {
  if(!['item', 'killstreak'].includes(target)){ return { status: 'error', message: 'Pick what to set: the items or their killstreak tiers.' } }
  const clear = (limit === null)
  if(!clear && !(Number.isInteger(limit) && limit >= 0 && limit <= MAX_LIMIT)){
    return { status: 'error', message: `The limit must be a whole number from 0 to ${MAX_LIMIT}.` }
  }

  const base = filter_query(filters)
  const query = (target == 'killstreak') ? { $and: [...(base.$and || []), { 'killstreak.0': { $exists: true } }] } : base
  const field = (target == 'item') ? 'stock.manual_limit' : 'stock.manual_ks_limit'
  let result

  if(clear){
    const res = await item_model.updateMany(query, { $unset: { [field]: '' } })
    result = { matched: res.n ?? res.matchedCount ?? 0, changed: res.nModified ?? res.modifiedCount ?? 0 }
    const applied = await apply_everywhere((await ask('admin:get_settings')).settings)
    result = { ...result, ...applied }
  } else if(target == 'item'){
    const res = await item_model.updateMany(query, { $set: { 'stock.limit': limit, [field]: limit } })
    result = { matched: res.n ?? res.matchedCount ?? 0, changed: res.nModified ?? res.modifiedCount ?? 0 }
  } else {
    result = await set_tier_limits(query, limit)
  }

  console.log(`[stock limits] ${by}: ${clear ? 'cleared' : `set ${limit}`} (${target}) on ${result.matched} item(s)`, JSON.stringify(base))
  return { status: 'ok', ...result }
}

// The tier limits live inside item.killstreak, which the item server rewrites when it prices the item. Each item is
// written only if it wasn't priced in between (same `updated`); a price update in between already used manual_ks_limit.
const set_tier_limits = async (query, limit) => {
  const res = await item_model.updateMany(query, { $set: { 'stock.manual_ks_limit': limit } })
  const result = { matched: res.n ?? res.matchedCount ?? 0, changed: 0 }
  let ops = []
  const flush = async () => {
    if(ops.length == 0){ return }
    const out = await item_model.bulkWrite(ops, { ordered: false })
    result.changed += out.nModified ?? out.modifiedCount ?? 0
    ops = []
  }
  const cursor = item_model.find(query, { _id: 0, bp_sku: 1, updated: 1, killstreak: 1 }).lean().cursor()
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    if(!doc.killstreak.some((k) => k?.limit !== limit)){ continue }
    ops.push({ updateOne: { filter: { bp_sku: doc.bp_sku, updated: doc.updated ?? null }, update: { $set: { killstreak: doc.killstreak.map((k) => ({ ...k, limit })) } } } })
    if(ops.length >= 500){ await flush() }
  }
  await flush()
  return result
}
