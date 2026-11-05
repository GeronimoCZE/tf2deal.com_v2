// Item lists that many page views share, kept in memory for a short while. Item pages, the /items pages, the item
// list API and the search modal then cost one small lookup each, instead of a pass over the whole item collection per
// request (search engines open thousands of item pages in a row). All of them come from one read of the items, at most
// once a minute, done in short steps (index); until the first read is done, the lists show what it has read so far.
//
//   similar(item)         the item page's "similar items": same name, same unusual effect, same type and quality
//   cards(filters, sort)  the /items list (/api/items and the plain-HTML /items pages): a card per item, plus a card per
//                         killstreak tier that is an item of its own (tier_listed), which opens that tier's page
//   names()               the search modal's suggestions: the items the bots trade (status 1) and the killstreak tiers
//                         they buy as items of their own, their stock limits, and a version that changes with either
//   stock()               { name: [copies, limit] } of every card in stock (killstreak tiers included): the search
//                         modal adds these names to the suggestions and shows "copies/limit" next to every name.
//                         Every suggestion opens a page (no 404s).
//   sitemap_names()       the items whose pages belong in the sitemap (fn.item_indexable), sorted by name
//   ks_page(name)         "Professional Killstreak Rocket Launcher" -> { bases: ['Rocket Launcher', ...], tier: 3 }
//   tiers_of(doc)         an item's killstreak tiers: Map tier -> { tier, buy, sell (ref), limit, source, buyorders, entry }
//   ks_items(doc)         true for a weapon whose killstreak tiers item_manager prices as items of their own
//   tier_indexable(...)   whether a killstreak tier's page belongs in search engines (and the sitemap)
//   collection(name)      the items of a TF2 collection (item_manager's item_collection), one per item, highest grade first
//   refresh()             read the items again now (at the start, and after the daily sweep marks old items inactive)
//   status()              how the reads go (for the logs and the "not ready" answers of the item APIs)

import crypto from 'crypto'
import { item_model } from '../model/Item.js'
import { display_name, to_ref } from './buy_link.js'
import * as fn from '../fn.js'

const TTL = 60 * 1000
const MAX_WAIT = 15 * 60 * 1000 // a slow database is read again at most this long after the last read
const FIRST_WAIT = 5 * 1000 // how long a page waits for the very first read before it is shown without the list
const STEP = 1000 // items per database query: the items are read a step at a time, never in one long query
const MIN_STEP = 100
const STEP_LIMIT = 60 * 1000 // the database gives up on one step after this long (the step is then made smaller)
const PARTIAL_EVERY = 2 * 1000 // during the very first read, the items read so far are shown, renewed this often
const SLOW = 5 * 1000 // reads slower than this are written to the log
const PROGRESS_EVERY = 30 * 1000 // a slow first read says how far it got this often

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

// load() at most once per `wait` (ttl, or twice as long as the last read took when that is longer, so a slow database
// isn't read without a break), and nobody waits for it once there is a list: an older list is returned at once and
// read again in the background (a page that waited for a slow read could time out behind Nginx or Cloudflare, 504).
// Only before the first read does a call wait, at most FIRST_WAIT. Meanwhile the first read shows what it has read so
// far (a list marked partial); with nothing read yet the call throws and the caller does without.
// A failed read keeps the last list. .reload() reads again now; .state says how the reads go.
//
// load(read) gets { first, alive(), step(count), partial(result) }: first = no full list yet; alive() turns false when
// a newer read took over (the old one stops at its next step); step() after every query (a read that hasn't heard
// from the database for STEP_LIMIT + 30 s is taken over); partial() shows what the first read has so far.
const cached = (load, name, ttl = TTL) => {
  let value = null
  let time = 0
  let wait = ttl
  let pending = null
  let current = 0 // the newest read
  let heard = 0   // when the running read last heard from the database
  const state = { reading_since: 0, read_so_far: 0, last_read: 0, last_took: 0, last_error: '', failed_at: 0 }
  const reload = () => {
    // a read whose database stopped answering doesn't stop the next one
    if (pending && Date.now() - heard > STEP_LIMIT + 30 * 1000) {
      console.warn(`${name}: no answer from the database for ${seconds(Date.now() - heard)}, reading again`)
      pending = null
    }
    if (!pending) {
      const id = ++current
      const began = heard = state.reading_since = Date.now()
      state.read_so_far = 0
      const first = !value || Boolean(value.partial)
      const read = load({
        first,
        alive: () => id === current,
        step: (count) => { if (id === current) { heard = Date.now(); state.read_so_far = count } },
        partial: (result) => { if (id === current && (!value || value.partial)) { value = result; time = Date.now() } }
      })
        .then((result) => {
          const took = Date.now() - began
          value = result
          time = Date.now()
          wait = Math.min(Math.max(ttl, 2 * took), MAX_WAIT)
          Object.assign(state, { last_read: time, last_took: took, last_error: '' })
          if (first || took > SLOW) console.log(`${name}: ${result.items} items (${result.cards.length} cards) read in ${seconds(took)}`)
          return result
        }, (error) => {
          // a read a newer one took over stops quietly
          if (id === current) {
            const message = String(error?.message || error)
            Object.assign(state, { last_error: message, failed_at: Date.now() })
            console.error(`${name}: read failed after ${seconds(Date.now() - began)} (${state.read_so_far} items read), the last list stays:`, message)
          }
          throw error
        })
        .finally(() => {
          if (pending === read) { pending = null; state.reading_since = 0 }
        })
      pending = read
    }
    return pending
  }
  const get = async () => {
    if (value) {
      // a failed read is written to the log by reload()
      if (Date.now() - time >= wait) reload().catch(() => {})
      return value
    }
    let timer
    const waited = new Promise((resolve) => { timer = setTimeout(() => resolve(null), FIRST_WAIT) })
    try {
      const result = await Promise.race([reload(), waited])
      if (result || value) return result || value // the full list, or what the first read has so far
      throw new Error(`${name} is still being read`)
    } finally {
      clearTimeout(timer)
    }
  }
  get.reload = reload
  get.state = state
  get.current = () => value
  return get
}

/* ========================= SIMILAR ITEMS ========================= */

// what a similar-item card shows of an item the bots have in stock (index() keeps one per such item)
const similar_entry = (doc) => ({
  bp_sku: doc.bp_sku, name: doc.name, image: doc.image, type: doc.type, qualityID: doc.qualityID, effectID: doc.effectID,
  sell: doc.sell, stock: { cur: doc.stock.cur }, bptf_data: { update_key_price: doc.bptf_data?.update_key_price }, classes: doc.classes
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

const NO_SIMILAR = { sameName: [], sameEffect: [], sameTypeQuality: [] }

const similar = async (main) => {
  // the item page doesn't wait for the first read: it is shown without similar items instead
  const all = await index().catch(() => null)
  if (!all) return NO_SIMILAR
  // the priced items the bots have in stock: the only ones the similar-item rows show
  const others = all.in_stock.filter((doc) => doc.bp_sku !== main.bp_sku)

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

/* ========================= COLLECTIONS ========================= */

// item_manager writes each item's TF2 collection to item_collection ("Concealed Killer Collection"; its
// services/collections.js, from TF2's own game files): cosmetics, taunts and weapons by defindex (so every quality,
// effect and killstreak version of an item has it), decorated weapons by their paint kit, war paints and war-painted
// weapons by their war paint. The item page lists the collection: each item once, in its plainest version.
const GRADES = { civilian: 1, freelance: 2, mercenary: 3, commando: 4, assassin: 5, elite: 6 }
const WEARS = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle Scarred']

// "Elite", "Elite Grade", "elite" -> "elite"; null for none ('false' in older records)
const grade_of = (value) => {
  const grade = String(value ?? '').replace(/\s*grade$/i, '').trim().toLowerCase()
  return GRADES[grade] ? grade : null
}

// lower = plainer: no unusual effect, craftable, not Australium, not Strange, no killstreak, not Festivized, the best
// wear, Unique or Decorated quality
const plain_rank = (doc) => {
  const sku = String(doc.bp_sku || '')
  const wear = WEARS.findIndex((w) => sku.includes(`(${w})`))
  return (Number(doc.effectID) > 0 ? 1000 : 0) + (/^Non-Craftable /.test(sku) ? 500 : 0) + (/australium/i.test(String(doc.type || '')) ? 300 : 0) +
    (/^(Non-Craftable )?Strange /.test(sku) ? 200 : 0) + (/Killstreak /.test(sku) ? 100 : 0) + (/Festivized /.test(sku) ? 50 : 0) +
    Math.max(wear, 0) * 10 + ([6, 15].includes(Number(doc.qualityID)) ? 0 : 5)
}

// what the collection list keeps of an item. A war-painted weapon ("Sweet Dreams Sniper Rifle") is in its war paint's
// collection, but the list shows the war paint itself ("Sweet Dreams War Paint"), as TF2 does.
const collection_entry = (doc) => {
  const collection = typeof doc.item_collection === 'string' ? doc.item_collection.trim() : ''
  if (!collection || /warpaint skin/i.test(String(doc.type || ''))) return null
  return {
    collection, name: String(doc.name || doc.bp_sku), bp_sku: doc.bp_sku, image: doc.image, type: doc.type,
    qualityID: doc.qualityID, effectID: doc.effectID, grade: grade_of(doc.grade), sell: Number(doc.sell) || 0,
    key_price: Number(doc.bptf_data?.update_key_price) || 0, stock: Number(doc.stock?.cur) || 0, rank: plain_rank(doc)
  }
}

// collection name -> its items: one per item name (the plainest version, then the one in stock), highest grade first
const collection_lists = (pages) => {
  const groups = new Map()
  for (const { collection: entry } of pages) {
    if (!entry) continue
    let group = groups.get(entry.collection)
    if (!group) groups.set(entry.collection, group = new Map())
    const kept = group.get(entry.name)
    if (!kept || entry.rank < kept.rank || (entry.rank === kept.rank && (entry.stock > kept.stock || (entry.stock === kept.stock && entry.bp_sku < kept.bp_sku)))) {
      group.set(entry.name, entry)
    }
  }
  return new Map([...groups].map(([name, group]) => [name, [...group.values()].sort(collection_order)]))
}
// highest grade first, then by name
const collection_order = (a, b) => (GRADES[b.grade] || 0) - (GRADES[a.grade] || 0) || String(a.name).localeCompare(String(b.name))

// the items of a collection; [] while the list isn't read yet (the item page then names the collection only)
const collection = async (name) => {
  if (!name) return []
  const all = await index().catch(() => null)
  return all?.collections?.get(String(name)) || []
}

/* ========================= /items + search modal ========================= */

const KS_TIERS = { 1: 'Killstreak', 2: 'Specialized Killstreak', 3: 'Professional Killstreak' }
const KS_WORDS = /^(Non-Craftable )?(Strange |Genuine |Vintage |Haunted |Collector's |Unusual |Decorated |Community |Self-Made |Normal )?(?:Festivized )?((?:Professional |Specialized )?Killstreak) (.+)$/

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
// "Non-Craftable" comes first, as on backpack.tf ("Non-Craftable Strange Professional Killstreak Rocket Launcher").
const ks_page = (name) => {
  const match = String(name || '').match(KS_WORDS)
  if (!match) return null
  const [, craft = '', quality = '', words, rest] = match
  const tier = Number(Object.keys(KS_TIERS).find((t) => KS_TIERS[t] == words))
  const base = craft + quality + rest
  return { bases: quality ? [base] : [base, craft + 'The ' + rest], tier }
}

// The item's killstreak tiers (item.killstreak, or item.killstreak.killstreaks in older records), prices in ref.
// The pricing server keeps each tier's own limit next to it ({ stock: 0, limit: 1 } or { stock: { cur, limit } }).
const tiers_of = (doc) => {
  const key_price = Number(doc?.bptf_data?.update_key_price) || 0
  const raw = Array.isArray(doc?.killstreak) ? doc.killstreak : (doc?.killstreak?.killstreaks || [])
  const tiers = new Map()
  for (const entry of raw) {
    const tier = ks_tier(entry?.ks_tier ?? entry?.kt ?? entry?.tier)
    if (tier < 1 || tier > 3 || tiers.has(tier)) continue
    const limit = Number(entry?.limit ?? entry?.stock?.limit)
    tiers.set(tier, {
      tier,
      entry,
      sell: to_ref(entry?.sell, key_price),
      buy: to_ref(entry?.buy, key_price),
      limit: Number.isFinite(limit) ? limit : null,
      source: entry?.source,
      buyorders: Number(entry?.buyorders) || 0
    })
  }
  return tiers
}

// Killstreak weapons as items of their own. Since 2026-11-02 item_manager prices every killstreak tier of a weapon
// (not skins / war paints) from that tier's own backpack.tf listings, like any other item (its utils/ksItems.js; this is
// the same test as its `applies`). A tier its listings can't price keeps the kit estimate (source 'kit' / 'tier median').
// Skins keep the estimate, so their tiers stay versions of the skin: a card only while in stock, and the skin's page.
const ks_items = (doc) => /weapon/i.test(String(doc?.type || '')) && !/skin|warpaint/i.test(String(doc?.type || ''))
// priced from its own listings, and the bots buy it: the weapon is traded and the tier has room (limit 0 = no buy order)
const tier_traded = (doc, t) => ks_items(doc) && t.source === 'bptf' && doc.status == 1 && t.buy > 0 && t.sell > 0 && t.limit > 0
// A tier is on the /items list while the bots hold copies of it, or buy it as an item of its own (an unusual weapon's
// only while in stock, as fn.item_indexable). Such a tier of a weapon also has its own page in search engines.
const tier_listed = (doc, t, copies) => copies > 0 || (tier_traded(doc, t) && !(Number(doc.effectID) > 0))
const tier_indexable = (doc, t, copies) => Boolean(t) && ks_items(doc) && tier_listed(doc, t, copies)

// tools that are never craftable are shown without "Non-Craftable"
// Non-Craftable left out of the shown name of unusualifiers, strange filters, kits, kit fabricators and chemistry sets
// (they are all Non-Craftable)
const shown_name = (name, type) => ['unusualifier', 'strange filter', 'tool kit', 'chemistry set'].some((t) => String(type || '').toLowerCase().includes(t)) ? name.replace('Non-Craftable ', '') : name

// The cards of one item: the item itself, and each killstreak tier (item.killstreak) on the list (tier_listed).
// A tier's copies count on its own card; copies of a tier the item has no entry for count on the item's card, as on
// the item page (public/js/plugins/trade.js tier_visible).
const item_cards = (doc) => {
  if (typeof doc.bptf_data?.update_key_price != 'number') return []
  const key_price = doc.bptf_data.update_key_price
  const copies = Array.isArray(doc.stock?.items) ? doc.stock.items : []
  const limit = Number(doc.stock?.limit) || 0
  const tiers = tiers_of(doc)
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
  for (const [tier, t] of tiers) {
    if (!tier_listed(doc, t, count[tier])) continue
    const own = t.source === 'bptf'
    list.push({
      ...shared,
      bp_sku: display_name(doc.bp_sku, { ks: tier }),
      base: doc.bp_sku,
      ks: tier,
      // what a copy of that tier costs at least: the tier's price, never under the item's (trade.js copy_price)
      sell: Math.max(t.sell, Number(doc.sell) || 0),
      buy: Math.max(t.buy, Number(doc.buy) || 0),
      // "Popular": a tier priced from its own listings counts its own buy orders
      buyorders: own ? t.buyorders : shared.buyorders,
      count: count[tier],
      tier_limit: t.limit,
      traded: tier_traded(doc, t), // in the search suggestions with its limit, like the items the bots trade
      indexable: tier_indexable(doc, t, count[tier])
    })
  }
  // the list leaves out prices that can't be right (as public/js/plugins/items.js always did)
  return list.filter((card) => !(card.sell / card.buy > 30) && !(card.sell > 100000 * 100))
}

// every priced item whose page opens (routes/router.js find_page_item)
const ITEMS_QUERY = {
  $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }],
  sell: { $gt: 0 },
  buy: { $gt: 0 }
}
// only what the lists need of each item: with whole items loaded, every read made the site's memory jump by hundreds of MB
const FIELDS = {
  _id: 1, bp_sku: 1, name: 1, type: 1, classes: 1, qualityID: 1, effectID: 1, image: 1, status: 1, buy: 1, sell: 1,
  'bptf_data.update_key_price': 1, 'bptf_data.buyorders': 1, 'stock.limit': 1, 'stock.cur': 1, 'stock.items.ks': 1,
  item_collection: 1, grade: 1, // the item page's collection list (collection_entry)
  // the tiers without their sales and price history (item.killstreak, or item.killstreak.killstreaks in older records)
  ...Object.fromEntries(['ks_tier', 'kt', 'tier', 'buy', 'sell', 'limit', 'stock', 'source', 'buyorders'].flatMap((field) => [[`killstreak.${field}`, 1], [`killstreak.killstreaks.${field}`, 1]]))
}

const timed_out = (error) => error?.code === 50 || /MaxTimeMS|time ?limit|timed out/i.test(String(error?.message || ''))

// one item into the lists being read (an item stored twice is shown once, the copy with stock)
const add_item = (by_name, doc) => {
  if (!doc.bp_sku) return
  const copies = doc.stock?.items?.length || 0
  const kept = by_name.get(doc.bp_sku)
  // the page belongs in the sitemap when any record of the item does (as ITEMS_QUERY in service/sitemap.js)
  const indexable = fn.item_indexable(doc) || Boolean(kept?.indexable)
  if (kept && copies <= kept.copies) { kept.indexable = indexable; return }
  by_name.set(doc.bp_sku, {
    copies,
    indexable,
    active: doc.status == 1,
    limit: Number(doc.stock?.limit) || 0,
    // the /items list: active items and the ones the bots hold copies of (status 2 items only have a page)
    cards: doc.status == 1 || copies > 0 ? item_cards(doc) : [],
    // the item page's similar items: the ones in stock
    similar: Number(doc.stock?.cur) > 0 ? similar_entry(doc) : null,
    // the item page's collection list
    collection: collection_entry(doc)
  })
}

// the lists from the items read; partial: the first read isn't done yet (the sitemap waits for a whole list)
const build = (by_name, partial = false) => {
  const pages = [...by_name.values()]
  const cards = pages.flatMap((page) => page.cards)
  const tier_cards = cards.filter((card) => card.ks > 0)
  // how many copies the bots keep at most: a killstreak tier with its own limit counts on its own (as the Can sell filter)
  const card_limit = (card) => card.ks > 0 && card.tier_limit !== null ? card.tier_limit : card.limit
  // the items the bots trade, and the killstreak tiers they buy as items of their own; what's in stock (other items and
  // killstreak versions too) comes with stock(), which the browser asks for every time the search opens, so the names
  // (a long list) only change when items go (in)active
  const active = [...by_name].filter(([, page]) => page.active)
  const traded_tiers = tier_cards.filter((card) => card.traded)
  const names = [...active.map(([name]) => name), ...traded_tiers.map((card) => card.bp_sku)]
  const limits = Object.fromEntries([...active.map(([name, page]) => [name, page.limit]), ...traded_tiers.map((card) => [card.bp_sku, card_limit(card)])])
  const stock = Object.fromEntries(cards.filter((card) => card.count > 0).map((card) => [card.bp_sku, [card.count, card_limit(card)]]))
  return {
    items: by_name.size,
    partial,
    cards,
    names,
    limits,
    names_version: crypto.createHash('sha1').update(JSON.stringify([names, limits])).digest('hex').slice(0, 12),
    stock,
    in_stock: pages.map((page) => page.similar).filter(Boolean),
    collections: collection_lists(pages),
    // item pages, and the pages of killstreak tiers that are items of their own (tier_indexable)
    indexable: [...[...by_name].filter(([, page]) => page.indexable).map(([name]) => name), ...tier_cards.filter((card) => card.indexable).map((card) => card.bp_sku)].sort(),
    built: Date.now()
  }
}

// The items, read a step (STEP items) at a time in _id order, each step a short query of its own. One query over the
// whole collection had to finish within 2 minutes, and on a busy or slow database it never did, so the list was never
// ready and /items showed no cards. A step the database can't answer within STEP_LIMIT is tried again smaller; a read
// that a newer one took over stops at its next step, so two reads never pile up in memory.
const index = cached(async (read) => {
  const by_name = new Map()
  let last_id = null
  let count = 0
  let size = STEP
  let shown = Date.now()
  let told = Date.now()
  const began = Date.now()
  for (;;) {
    // without the database the last list stays (cached keeps it), and a request doesn't wait for a reconnect
    if (process.db_status?.connected !== true) throw new Error('no database')
    if (!read.alive()) throw new Error('a newer read took over')
    let docs
    try {
      docs = await item_model.find(last_id === null ? ITEMS_QUERY : { ...ITEMS_QUERY, _id: { $gt: last_id } }, FIELDS)
        .sort({ _id: 1 }).limit(size).maxTimeMS(STEP_LIMIT).lean()
    } catch (error) {
      if (timed_out(error) && size > MIN_STEP) {
        size = Math.max(MIN_STEP, Math.floor(size / 4))
        console.warn(`Item list: the database is slow, reading ${size} items at a time`)
        read.step(count)
        continue
      }
      throw error
    }
    for (const doc of docs) add_item(by_name, doc)
    count += docs.length
    read.step(count)
    if (docs.length < size) break
    last_id = docs[docs.length - 1]._id
    if (read.first && Date.now() - shown >= PARTIAL_EVERY) {
      read.partial(build(by_name, true))
      shown = Date.now()
    }
    if (read.first && Date.now() - told >= PROGRESS_EVERY) {
      console.log(`Item list: still reading, ${count} items so far (${seconds(Date.now() - began)})`)
      told = Date.now()
    }
  }
  return build(by_name)
}, 'Item list')

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
// until the item list is read again. Then all of them go: a kept list from an older read kept that whole read in memory.
const SORTED_MAX = 50
const sorted = { built: 0, lists: new Map() }
const cards = async (filters = {}, sort) => {
  const all = await index()
  if (all.built > sorted.built) {
    sorted.lists.clear()
    sorted.built = all.built
  }
  const key = JSON.stringify([filters, sort])
  const kept = all.built === sorted.built && sorted.lists.get(key)
  if (kept) return kept
  const list = all.cards.filter(matches(filters)).sort(ORDERS[sort] || ORDERS.default)
  if (all.built === sorted.built) {
    if (sorted.lists.size >= SORTED_MAX) sorted.lists.delete(sorted.lists.keys().next().value) // the oldest goes
    sorted.lists.set(key, list)
  }
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
  return { names: all.names, limits: all.limits, version: all.names_version }
}

const stock = async () => {
  const all = await index()
  return { stock: all.stock, names_version: all.names_version }
}

// the sitemap waits for a whole list (meanwhile service/sitemap.js reads the names from the database)
const sitemap_names = async () => {
  const all = await index()
  if (all.partial) throw new Error('the item list is still being read')
  return all.indexable
}

// how the item list reads go: { ready, partial, items, cards, reading_for_s, read_so_far, last_read_s_ago, last_read_took_s,
// last_error }. The item APIs send it when they answer 503, so a look at /api/item_stock says why the list isn't there.
const status = () => {
  const value = index.current()
  const state = index.state
  const ago = (time) => time > 0 ? Math.round((Date.now() - time) / 1000) : null
  return {
    ready: Boolean(value) && !value.partial,
    partial: Boolean(value?.partial),
    items: value?.items ?? 0,
    cards: value?.cards.length ?? 0,
    reading_for_s: ago(state.reading_since),
    read_so_far: state.reading_since > 0 ? state.read_so_far : null,
    last_read_s_ago: ago(state.last_read),
    last_read_took_s: state.last_took > 0 ? Math.round(state.last_took / 100) / 10 : null,
    last_error: state.last_error || null,
    last_error_s_ago: state.last_error ? ago(state.failed_at) : null
  }
}

// reads the lists again now; the old lists are used until the new ones are ready

const refresh = () => index.reload().catch(() => null) // a failed read is written to the log by cached()

export { similar, cards, public_card, names, stock, sitemap_names, ks_page, ks_tier, tiers_of, ks_items, tier_indexable, collection, collection_order, grade_of, refresh, status }
