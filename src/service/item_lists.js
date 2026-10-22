// Item lists that many page views share, kept in memory for a short while. Item pages, the /items pages, the item
// list API and the search modal then cost one small lookup each, instead of a pass over the whole item collection per
// request (search engines open thousands of item pages in a row).
//
//   similar(item)         the item page's "similar items": same name, same unusual effect, same type and quality
//   cards(filters, sort)  the /items list (/api/items and the plain-HTML /items pages): a card per item, plus a card per
//                         killstreak tier the bots have in stock, which opens that tier's page
//   names()               the search modal's suggestions: the items the bots trade (status 1), and a version
//   stock()               { name: copies } of every card in stock (killstreak tiers included): the search modal adds
//                         these names to the suggestions with their counts. Every suggestion opens a page (no 404s).
//   ks_page(name)         "Professional Killstreak Rocket Launcher" -> { bases: ['Rocket Launcher', ...], tier: 3 }
//   refresh()             read the items again now (after the daily sweep marks old items inactive)

import crypto from 'crypto'
import { item_model } from '../model/Item.js'
import { display_name, to_ref } from './buy_link.js'

const TTL = 60 * 1000

// load() at most once per ttl; everyone asking meanwhile waits for the same load. A failed refresh keeps the last list.
// .reset() makes the next call load again.
const cached = (load, ttl = TTL) => {
  let value = null
  let time = 0
  let pending = null
  const get = async () => {
    if (value && Date.now() - time < ttl) return value
    if (!pending) {
      pending = load()
        .then((result) => { value = result; time = Date.now(); return result })
        .finally(() => { pending = null })
    }
    try {
      return await pending
    } catch (error) {
      if (value) return value
      throw error
    }
  }
  get.reset = () => { time = 0 }
  return get
}

/* ========================= SIMILAR ITEMS ========================= */

// The priced items the bots have in stock: the only ones the similar-item rows show
const in_stock = cached(async () => {
  const docs = await item_model.find({
    $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }],
    sell: { $gt: 0 },
    buy: { $gt: 0 },
    'stock.cur': { $gt: 0 }
  }, { _id: 0, bp_sku: 1, name: 1, image: 1, type: 1, qualityID: 1, effectID: 1, sell: 1, 'stock.cur': 1, 'bptf_data.update_key_price': 1, classes: 1 }).lean()

  const seen = new Set() // an item stored twice is shown once
  return docs.filter((doc) => doc.bp_sku && !seen.has(doc.bp_sku) && seen.add(doc.bp_sku))
})

// how many classes two items share
const shared_classes = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0
  const other = new Set(b)
  return new Set(a.filter((c) => other.has(c))).size
}

// up to 10, the ones made for the same classes first
const best = (docs, main) => docs
  .map((doc) => ({ doc, shared: shared_classes(doc.classes, main.classes) }))
  .sort((x, y) => y.shared - x.shared)
  .slice(0, 10)
  .map(({ doc }) => doc)

const similar = async (main) => {
  const docs = await in_stock()
  const others = docs.filter((doc) => doc.bp_sku !== main.bp_sku)

  const same_effect = Number(main.effectID) > 0 ? others.filter((doc) => Number(doc.effectID) === Number(main.effectID)) : []

  // other items of the same type and quality, one per name
  const names = new Set()
  const same_type = others.filter((doc) => doc.name !== main.name && doc.type === main.type && String(doc.qualityID) === String(main.qualityID) && !names.has(doc.name) && names.add(doc.name))

  return {
    sameName: best(others.filter((doc) => doc.name === main.name), main),
    sameEffect: best(same_effect, main),
    sameTypeQuality: best(same_type, main)
  }
}

/* ========================= /items + search modal ========================= */

const KS_TIERS = { 1: 'Killstreak', 2: 'Specialized Killstreak', 3: 'Professional Killstreak' }
const KS_WORDS = /^(Strange |Genuine |Vintage |Haunted |Collector's |Unusual |Decorated |Community |Self-Made |Normal )?(?:Festivized )?((?:Professional |Specialized )?Killstreak) (.+)$/

const ks_tier = (value) => {
  if (value === undefined || value === null || value === '') return 0
  if (!isNaN(Number(value))) return Number(value)
  const name = String(value).trim().toLowerCase()
  if (name.startsWith('pro')) return 3
  if (name.startsWith('spec')) return 2
  if (name.startsWith('kill')) return 1
  return 0
}

// "Strange Professional Killstreak Rocket Launcher" -> { bases: ['Strange Rocket Launcher'], tier: 3 }; null for other
// names. Without a quality word the item may be stored as "The ..." (buy_link.js display_name leaves "The" out).
const ks_page = (name) => {
  const match = String(name || '').match(KS_WORDS)
  if (!match) return null
  const tier = Number(Object.keys(KS_TIERS).find((t) => KS_TIERS[t] == match[2]))
  const base = (match[1] || '') + match[3]
  return { bases: match[1] ? [base] : [base, 'The ' + base], tier }
}

// tools that are never craftable are shown without "Non-Craftable"
const shown_name = (name, type) => ['unusualifier', 'strange filter', 'tool kit'].some((t) => String(type || '').toLowerCase().includes(t)) ? name.replace('Non-Craftable ', '') : name

// The cards of one item: the item itself, and each killstreak tier (item.killstreak) the bots have copies of.
// A tier's copies count on its own card; copies of a tier the item has no entry for count on the item's card, as on
// the item page (public/js/plugins/trade.js tier_visible).
const item_cards = (doc) => {
  if (typeof doc.bptf_data?.update_key_price != 'number') return []
  const key_price = doc.bptf_data.update_key_price
  const copies = Array.isArray(doc.stock?.items) ? doc.stock.items : []
  const limit = Number(doc.stock?.limit) || 0
  const raw = Array.isArray(doc.killstreak) ? doc.killstreak : (doc.killstreak?.killstreaks || [])
  const tiers = new Map()
  for (const entry of raw) {
    const tier = ks_tier(entry?.ks_tier ?? entry?.kt ?? entry?.tier)
    if (tier >= 1 && tier <= 3 && !tiers.has(tier)) {
      // the pricing server keeps each tier's own limit next to it ({ stock: 0, limit: 1 } or { stock: { cur, limit } })
      const tier_limit = Number(entry?.limit ?? entry?.stock?.limit)
      tiers.set(tier, { sell: to_ref(entry?.sell, key_price), buy: to_ref(entry?.buy, key_price), limit: Number.isFinite(tier_limit) ? tier_limit : null })
    }
  }
  const count = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const copy of copies) {
    const tier = Number(copy?.ks) || 0
    count[tiers.has(tier) ? tier : 0]++
  }

  const shared = {
    type: doc.type, qualityID: doc.qualityID, effectID: doc.effectID, image: doc.image,
    item_name: doc.name, classes: Array.isArray(doc.classes) ? doc.classes : [], buyorders: Number(doc.bptf_data?.buyorders) || 0,
    key_price, total: copies.length, limit
  }
  const list = []
  // an item that is only listed because the bots hold killstreak copies of it shows just those
  if (doc.status == 1 || count[0] > 0) {
    list.push({ ...shared, bp_sku: doc.bp_sku, ks: 0, sell: Number(doc.sell), buy: Number(doc.buy), count: count[0] })
  }
  for (const [tier, price] of tiers) {
    if (count[tier] == 0) continue
    list.push({
      ...shared,
      bp_sku: display_name(doc.bp_sku, { ks: tier }),
      base: doc.bp_sku,
      ks: tier,
      // what a copy of that tier costs at least: the tier's price, never under the item's (trade.js copy_price)
      sell: Math.max(price.sell, Number(doc.sell) || 0),
      buy: Math.max(price.buy, Number(doc.buy) || 0),
      count: count[tier],
      tier_limit: price.limit
    })
  }
  // the list leaves out prices that can't be right (as public/js/plugins/items.js always did)
  return list.filter((card) => !(card.sell / card.buy > 30) && !(card.sell > 100000 * 100))
}

// every priced item whose page opens (routes/router.js find_page_item), read at most once a minute
const index = cached(async () => {
  // without the database the last list stays (cached keeps it), and a request doesn't wait for a reconnect
  if (process.db_status?.connected !== true) throw new Error('no database')
  const docs = await item_model.find({
    $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }],
    sell: { $gt: 0 },
    buy: { $gt: 0 }
  }, {
    _id: 0, bp_sku: 1, name: 1, type: 1, classes: 1, qualityID: 1, effectID: 1, image: 1, status: 1, buy: 1, sell: 1,
    'bptf_data.update_key_price': 1, 'bptf_data.buyorders': 1, 'stock.limit': 1, 'stock.items.ks': 1,
    // the tiers without their sales history (item.killstreak, or item.killstreak.killstreaks in older records)
    ...Object.fromEntries(['ks_tier', 'kt', 'tier', 'buy', 'sell', 'limit', 'stock'].flatMap((field) => [[`killstreak.${field}`, 1], [`killstreak.killstreaks.${field}`, 1]]))
  }).lean()

  // an item stored twice is shown once, the copy with stock
  const by_name = new Map()
  for (const doc of docs) {
    const kept = by_name.get(doc.bp_sku)
    if (doc.bp_sku && (!kept || (doc.stock?.items?.length || 0) > (kept.stock?.items?.length || 0))) by_name.set(doc.bp_sku, doc)
  }
  const pages = [...by_name.values()]
  // the /items list: active items and the ones the bots hold copies of (status 2 items only have a page)
  const cards = pages.filter((doc) => doc.status == 1 || (doc.stock?.items?.length || 0) > 0).flatMap(item_cards)
  // the items the bots trade; what's in stock (other items and killstreak versions too) comes with stock(), which the
  // browser asks for every time the search opens, so the names (a long list) only change when items go (in)active
  const names = pages.filter((doc) => doc.status == 1).map((doc) => doc.bp_sku)
  const stock = Object.fromEntries(cards.filter((card) => card.count > 0).map((card) => [card.bp_sku, card.count]))
  return {
    cards,
    names,
    names_version: crypto.createHash('sha1').update(names.join('\n')).digest('hex').slice(0, 12),
    stock,
    built: Date.now()
  }
})

const escape_regex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// "strasse" also finds "Straße" and the other way round, like the old database search
const german = (text) => escape_regex(text).split('').map((ch) => ({ a: '[aä]', o: '[oö]', u: '[uü]', s: '[sß]' }[ch.toLowerCase()] || ch)).join('')

// the /api/items filters (api/routes/items.js reads them from the request)
const matches = (filters) => {
  const tests = []
  const words = String(filters.name || '').toLowerCase().trim().split(/\s+/).filter(Boolean).map((w) => new RegExp(german(w), 'i'))
  if (words.length) tests.push((c) => words.every((re) => re.test(c.bp_sku)))
  if (filters.qualityID !== undefined) tests.push((c) => String(c.qualityID) === String(filters.qualityID))
  if (filters.type !== undefined) {
    const re = new RegExp(filters.type == 'War Paint' ? 'warpaint' : escape_regex(String(filters.type)).slice(0, 100), 'i')
    tests.push((c) => re.test(String(c.type || '')))
  }
  if (filters.particle !== undefined) tests.push((c) => Number(c.effectID) === Number(filters.particle))
  if (filters.warpaint !== undefined) {
    const re = new RegExp(escape_regex(String(filters.warpaint)).slice(0, 100), 'i')
    tests.push((c) => re.test(String(c.item_name || '')))
  }
  if (filters.classes?.length) tests.push((c) => filters.classes.every((cl) => c.classes.includes(cl)))
  // can sell: the bots take more of it (a tier with its own limit counts its own copies); can buy: copies in stock
  if (filters.stock === 'Can sell') tests.push((c) => c.ks > 0 && c.tier_limit !== null ? c.count < c.tier_limit : c.total < c.limit)
  if (filters.stock === 'Can buy') tests.push((c) => c.count > 0)
  return (card) => tests.every((test) => test(card))
}

const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0)
// The default order: most copies in stock first, and among the same number of copies the dearest first.
// A price or popularity order picked in the filters comes first; stock and price then only break ties.
const ORDERS = {
  'Price (asc)': (a, b) => a.sell - b.sell || b.count - a.count || desc(a.bp_sku, b.bp_sku),
  'Price (desc)': (a, b) => b.sell - a.sell || b.count - a.count || desc(a.bp_sku, b.bp_sku),
  'Popular (desc)': (a, b) => b.buyorders - a.buyorders || b.count - a.count || b.sell - a.sell || desc(a.bp_sku, b.bp_sku),
  default: (a, b) => b.count - a.count || b.sell - a.sell || desc(a.bp_sku, b.bp_sku)
}

// the cards for one set of filters, sorted; the same filters ask again while scrolling, so the result is kept
// until the item list is read again
const sorted = new Map()
const cards = async (filters = {}, sort) => {
  const all = await index()
  const key = JSON.stringify([filters, sort])
  const kept = sorted.get(key)
  if (kept && kept.built === all.built) return kept.list
  const list = all.cards.filter(matches(filters)).sort(ORDERS[sort] || ORDERS.default)
  if (sorted.size > 100) sorted.clear()
  sorted.set(key, { built: all.built, list })
  return list
}

// what the list shows of a card (/api/items sends the same fields as before: the browser's list builds the card)
const public_card = (card) => ({
  bp_sku: card.bp_sku,
  name: shown_name(card.bp_sku, card.type),
  ...(card.ks > 0 && { base: card.base, ks: card.ks }),
  type: card.type, buy: card.buy, sell: card.sell, qualityID: card.qualityID, effectID: card.effectID, image: card.image,
  bptf_data: { update_key_price: card.key_price },
  stock: { items_length: card.count, limit: card.limit }
})

const names = async () => {
  const all = await index()
  return { names: all.names, version: all.names_version }
}

const stock = async () => {
  const all = await index()
  return { stock: all.stock, names_version: all.names_version }
}

const refresh = () => { index.reset(); return index().catch(() => null) }

export { similar, cards, public_card, names, stock, ks_page, ks_tier, refresh }
