// Item lists that many page views share, kept in memory for a minute. Item pages and the /items pages then cost
// one small lookup each, instead of a pass over the whole item collection per page view (search engines open
// thousands of item pages in a row).
//
//   similar(item)  the item page's "similar items": same name, same unusual effect, same type and quality
//   listed()       the /items list: the same items in the same order as /api/items without filters

import { item_model } from '../model/Item.js'

const TTL = 60 * 1000

// load() at most once per TTL; everyone asking meanwhile waits for the same load. A failed refresh keeps the last list.
const cached = (load) => {
  let value = null
  let time = 0
  let pending = null
  return async () => {
    if (value && Date.now() - time < TTL) return value
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

/* ========================= /items ========================= */

// Same filter and order as /api/items (api/routes/items.js) without filters, so the plain-HTML pages and the
// pages the browser loads while scrolling line up.
const listed = cached(() => item_model.aggregate([
  {
    $match: {
      $or: [{ status: 1 }, { 'stock.items': { $exists: true, $not: { $size: 0 } } }],
      sell: { $gt: 0 },
      buy: { $gt: 0 }
    }
  },
  {
    $project: {
      _id: 0, bp_sku: 1, type: 1, buy: 1, sell: 1, qualityID: 1, effectID: 1, image: 1,
      key_price: '$bptf_data.update_key_price',
      stock_count: { $size: { $ifNull: ['$stock.items', []] } }
    }
  },
  { $sort: { stock_count: -1, bp_sku: -1 } }
]).exec())

export { similar, listed }
