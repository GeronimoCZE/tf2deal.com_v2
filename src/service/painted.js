// Painted cosmetics with a price of their own (item_manager writes painted_prices, model/PaintedPrice.js): a cosmetic
// with 2+ backpack.tf buy orders for one paint has that paint's own buy and sell. Where the site prices one copy (the
// item page, direct buy links, Admin -> Inventory value), a copy with such a paint is worth at least that paint's price,
// as a killstreak copy is worth its tier's price. The bot server prices each copy itself and sends that price with the
// copy (it gets the same painted prices from item_manager); these are the site's own fallback.
import { painted_price_model } from '../model/PaintedPrice.js'
import { item_model } from '../model/Item.js'

const db_ready = () => process.db_status?.connected === true
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0

// a copy's paint as the bot server sends it (at.paint: "Australium Gold", ["Australium Gold"] or
// "Paint Color: Australium Gold") -> its name, '' for none
export const paint_name = (value) => {
  const text = (Array.isArray(value) ? value : [value]).find((v) => typeof v == 'string' && v.trim())
  return text ? text.trim().replace(/^paint colou?r:\s*/i, '') : ''
}
// names compared without case and with straight apostrophes ("Zepheniah’s Greed")
export const paint_key = (name) => paint_name(name).replace(/[\u2018\u2019]/g, "'").toLowerCase()

export const is_cosmetic = (doc) => /^cosmetic/i.test(String(doc?.type || ''))

// bp_sku -> Map paint key -> { paint, buy, sell, limit, updated }, for the given items (all priced ones without a list)
export const prices_of = async (bp_skus = null) => {
  const out = new Map()
  if (!db_ready() || (Array.isArray(bp_skus) && bp_skus.length == 0)) return out
  const query = { status: 1, ...(Array.isArray(bp_skus) && { bp_sku: { $in: bp_skus.map(String) } }) }
  const docs = await painted_price_model.find(query, { _id: 0, bp_sku: 1, paint: 1, buy: 1, sell: 1, stock_limit: 1, updated: 1 }).lean().catch(() => [])
  for (const d of docs) {
    if (!(num(d.sell) > 0) && !(num(d.buy) > 0)) continue
    if (!out.has(d.bp_sku)) out.set(d.bp_sku, new Map())
    out.get(d.bp_sku).set(paint_key(d.paint), { paint: d.paint, buy: num(d.buy), sell: num(d.sell), limit: num(d.stock_limit), updated: num(d.updated) })
  }
  return out
}

// the painted price of one copy (from prices_of), or null
export const price_of = (prices, bp_sku, asset) => {
  const paint = paint_key(asset?.at?.paint)
  return paint ? prices?.get(bp_sku)?.get(paint) || null : null
}

// The item page's paint select (view/item_page.ejs, public/js/main.js): the cosmetic's priced paints, by name, with how
// many copies with that paint the bots hold. [] for other items.
export const for_page = async (doc) => {
  if (!is_cosmetic(doc) || !db_ready()) return []
  const prices = (await prices_of([doc.bp_sku])).get(doc.bp_sku)
  if (!prices || prices.size == 0) return []
  // copies held per paint (the page loads the item without stock.items)
  const held = new Map()
  const rows = await item_model.aggregate([
    { $match: { _id: doc._id } },
    { $unwind: '$stock.items' },
    { $group: { _id: '$stock.items.at.paint', n: { $sum: 1 } } }
  ]).catch(() => [])
  for (const row of rows) {
    const key = paint_key(row._id)
    if (key) held.set(key, (held.get(key) || 0) + num(row.n))
  }
  return [...prices.entries()]
    .map(([key, p]) => ({ paint: p.paint, buy: p.buy, sell: p.sell, limit: p.limit, held: held.get(key) || 0, updated: p.updated }))
    .sort((a, b) => a.paint.localeCompare(b.paint))
}
