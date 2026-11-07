// Versions of an item with a price of their own (item_manager writes variant_prices, model/VariantPrice.js): a painted
// cosmetic, a festivized weapon or an item with one spell, each with 2+ backpack.tf buy orders for that version. Where the
// site prices one copy (the item page, direct buy links, Admin -> Inventory value), a copy of such a version is worth at
// least its price, as a killstreak copy is worth its tier's price:
//   - a painted copy: its paint's buy / sell
//   - a festivized copy (no killstreak): the festivized buy / sell
//   - a copy with a spell: never sold under that spell's price (a reference only, the buy isn't raised)
// The bot server prices each copy itself and sends that price with the copy (it gets the same prices from item_manager);
// these are the site's own fallback.
import { variant_price_model } from '../model/VariantPrice.js'
import { item_model } from '../model/Item.js'

const db_ready = () => process.db_status?.connected === true
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const list = (value) => (Array.isArray(value) ? value : [value]).filter((v) => typeof v == 'string' && v.trim())

// a copy's paint as the bot server sends it (at.paint: "Australium Gold", ["Australium Gold"] or
// "Paint Color: Australium Gold") -> its name, '' for none
export const paint_name = (value) => {
  const text = list(value)[0]
  return text ? text.trim().replace(/^paint colou?r:\s*/i, '') : ''
}
// a spell as Steam writes it ("Halloween: Exorcism (spell only active during event)") -> "Exorcism"
export const spell_name = (value) => String(value || '').trim().replace(/^halloween:\s*/i, '').replace(/\s*\(spell only active during event\)\s*$/i, '')
// names compared without case and with straight apostrophes ("Zepheniah’s Greed")
const key = (name) => String(name || '').trim().replace(/[\u2018\u2019]/g, "'").toLowerCase()
export const paint_key = (value) => key(paint_name(value))
export const spell_key = (value) => key(spell_name(value))

export const is_cosmetic = (doc) => /^cosmetic/i.test(String(doc?.type || ''))

// bp_sku -> { paint: Map key -> entry, spell: Map key -> entry, festivized: entry | null } for the given items (every
// priced one without a list). entry: { kind, name, buy, sell, limit, updated }
export const prices_of = async (bp_skus = null) => {
  const out = new Map()
  if (!db_ready() || (Array.isArray(bp_skus) && bp_skus.length == 0)) return out
  const query = { status: 1, ...(Array.isArray(bp_skus) && { bp_sku: { $in: bp_skus.map(String) } }) }
  const docs = await variant_price_model.find(query, { _id: 0, bp_sku: 1, kind: 1, name: 1, buy: 1, sell: 1, stock_limit: 1, updated: 1 }).lean().catch(() => [])
  for (const d of docs) {
    if (!(num(d.sell) > 0) && !(num(d.buy) > 0)) continue
    if (!out.has(d.bp_sku)) out.set(d.bp_sku, { paint: new Map(), spell: new Map(), festivized: null })
    const entry = { kind: d.kind, name: d.name, buy: num(d.buy), sell: num(d.sell), limit: num(d.stock_limit), updated: num(d.updated) }
    const item = out.get(d.bp_sku)
    if (d.kind == 'festivized') item.festivized = entry
    else if (d.kind == 'paint') item.paint.set(key(d.name), entry)
    else if (d.kind == 'spell') item.spell.set(key(d.name), entry)
  }
  return out
}

// One copy's version price from prices_of: { buy, sell } (0 where none). ks: its killstreak tier (a festivized price
// is the festivized weapon's without a killstreak).
export const price_of = (prices, bp_sku, asset) => {
  const item = prices?.get(bp_sku)
  if (!item) return { buy: 0, sell: 0 }
  const own = (!(Number(asset?.ks) > 0) && Number(asset?.f) > 0 && item.festivized) || item.paint.get(paint_key(asset?.at?.paint)) || null
  const spell_sell = Math.max(0, ...list(asset?.at?.spells).map((s) => item.spell.get(spell_key(s))?.sell || 0))
  return { buy: own?.buy || 0, sell: Math.max(own?.sell || 0, spell_sell) }
}

// The item page (view/item_page.ejs, public/js/main.js, js/plugins/trade.js): the item's versions with a price,
// [{ kind, name, buy, sell, limit, held, updated }]. Paints (by name) with how many copies with that paint the bots
// hold, for the paint select.
export const for_page = async (doc) => {
  if (!doc || !db_ready()) return []
  const item = (await prices_of([doc.bp_sku])).get(doc.bp_sku)
  if (!item) return []
  const held = new Map()
  if (is_cosmetic(doc) && item.paint.size > 0) {
    // copies held per paint (the page loads the item without stock.items)
    const rows = await item_model.aggregate([
      { $match: { _id: doc._id } },
      { $unwind: '$stock.items' },
      { $group: { _id: '$stock.items.at.paint', n: { $sum: 1 } } }
    ]).catch(() => [])
    for (const row of rows) {
      const k = paint_key(row._id)
      if (k) held.set(k, (held.get(k) || 0) + num(row.n))
    }
  }
  const row = (e, k) => ({ kind: e.kind, name: e.name, buy: e.buy, sell: e.sell, limit: e.limit, held: k ? held.get(k) || 0 : 0, updated: e.updated })
  return [
    ...(is_cosmetic(doc) ? [...item.paint.entries()].map(([k, e]) => row(e, k)).sort((a, b) => a.name.localeCompare(b.name)) : []),
    ...(item.festivized ? [row(item.festivized)] : []),
    ...[...item.spell.values()].map((e) => row(e))
  ]
}
