// Prices set by hand in the admin panel (js/admin_bot_manager.js → Bot manager → Prices, routes: api/routes/admin.js
// → /manual_prices/*).
//
// The price goes straight onto the item, like a price from item_manager: `sell` / `buy` in ref at today's key price
// (`bptf_data.update_key_price`), `status` 1 and a new `updated`, so the site shows it at once and bot_manager reads it
// from the database within a minute (sooner: admin:prices:check_db below). A copy is kept in `manual_price`
// { locked, sell, buy, keys, ref, buy_keys, buy_ref, at, by }. While `locked` is true item_manager doesn't price the
// item (item_manager src/utils/manualPrice.js), so the price only changes here; unlocked, its next price round
// replaces it. "List it" asks bot_manager to always list the item for sale (admin:listings:pin), which starts a
// listing sync.
import { item_model } from '../model/Item.js'
import * as app from '../app.js'
import * as bot_manager from './bot_manager.js'
import { refresh as refresh_item_lists } from './item_lists.js'

const MAX_KEYS = 100000
const FIELDS = { _id: 0, bp_sku: 1, name: 1, image: 1, qualityID: 1, status: 1, buy: 1, sell: 1, updated: 1, manual_price: 1,
  'bptf_data.update_key_price': 1, 'stock.items.a': 1 }

const r2 = (n) => Math.round(n * 100) / 100
const escape_regex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const amount = (value, max) => {
  if(value === '' || value === null || value === undefined){ return 0 }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null
}
const key_now = (doc) => Number(app.key_price?.metal) || Number(doc?.bptf_data?.update_key_price) || 0

const row = (doc) => ({
  bp_sku: doc.bp_sku,
  image: doc.image,
  qualityID: doc.qualityID,
  status: doc.status,
  buy: Number(doc.buy) || 0,
  sell: Number(doc.sell) || 0,
  key_price: Number(doc.bptf_data?.update_key_price) || null,
  stock: Array.isArray(doc.stock?.items) ? doc.stock.items.length : 0,
  updated: doc.updated || 0,
  manual: doc.manual_price || null
})

// every item with a price set by hand, newest first
export const list = async () => {
  const docs = await item_model.find({ manual_price: { $exists: true } }, FIELDS).sort({ 'manual_price.at': -1 }).limit(500).lean()
  return { status: 'ok', key_price: Number(app.key_price?.metal) || null, items: docs.map(row) }
}

// items by name for the form (exact name first)
export const search = async (q) => {
  const text = String(q || '').trim().slice(0, 200)
  if(text.length < 2){ return { status: 'ok', items: [] } }
  const [exact, more] = await Promise.all([
    item_model.findOne({ bp_sku: text }, FIELDS).lean(),
    item_model.find({ bp_sku: new RegExp(escape_regex(text), 'i') }, FIELDS).sort({ 'stock.cur': -1 }).limit(12).lean()
  ])
  const docs = [exact, ...more.filter((d) => d.bp_sku !== exact?.bp_sku)].filter(Boolean).slice(0, 12)
  return { status: 'ok', key_price: Number(app.key_price?.metal) || null, items: docs.map(row) }
}

// { bp_sku, sell: { keys, ref }, buy: { keys, ref } | null (keep the buy price), locked, list }
export const set = async (p = {}, admin) => {
  const bp_sku = String(p.bp_sku || '').trim()
  const doc = bp_sku ? await item_model.findOne({ bp_sku }, FIELDS).lean() : null
  if(!doc){ return { status: 'error', message: 'No item with that name.' } }
  const key = key_now(doc)
  const sell_keys = amount(p.sell?.keys, MAX_KEYS), sell_ref = amount(p.sell?.ref, MAX_KEYS)
  if(sell_keys === null || sell_ref === null || !Number.isInteger(sell_keys)){ return { status: 'error', message: 'The sell price is not valid: whole keys and ref.' } }
  if((sell_keys > 0 || p.buy?.keys > 0) && !key){ return { status: 'error', message: 'The key price isn\'t known yet, so a price in keys can\'t be saved. Try again in a minute.' } }
  const sell = r2(sell_keys * key + sell_ref)
  if(!(sell > 0)){ return { status: 'error', message: 'Enter a sell price.' } }

  let buy, buy_keys = null, buy_ref = null
  if([p.buy?.keys, p.buy?.ref].some((v) => v !== '' && v != null)){
    buy_keys = amount(p.buy.keys, MAX_KEYS)
    buy_ref = amount(p.buy.ref, MAX_KEYS)
    if(buy_keys === null || buy_ref === null || !Number.isInteger(buy_keys)){ return { status: 'error', message: 'The buy price is not valid: whole keys and ref.' } }
    buy = r2(buy_keys * key + buy_ref)
  } else {
    // the buy price stays: in ref at the item's old key price, so it's moved to today's
    const old_key = Number(doc.bptf_data?.update_key_price) || key
    buy = r2((Number(doc.buy) || 0) * (old_key ? key / old_key : 1))
  }
  if(buy >= sell){ return { status: 'error', message: `The sell price has to be above the buy price (${r2(buy)} ref), or the bots would buy it for more than they sell it. Set a lower buy price too.` } }

  const locked = p.locked !== false
  const now = Date.now()
  const manual_price = { locked, sell, buy, keys: sell_keys, ref: sell_ref, buy_keys, buy_ref, at: now, by: String(admin || 'admin') }
  await item_model.updateOne({ bp_sku }, { $set: { sell, buy, status: 1, updated: now, ...(key ? { 'bptf_data.update_key_price': key } : {}), manual_price } })
  refresh_item_lists()

  // bot_manager: read the new price now, and always list the item for sale when asked
  const notes = []
  if(bot_manager.online()){
    bot_manager.ask('admin:prices:check_db', {}, admin) // can take a while; the listing is repriced when it's done
    if(p.list){
      const pin = await bot_manager.ask('admin:listings:pin', { intent: 'sell', bp_sku, on: true }, admin)
      const held = row(doc).stock > 0
      notes.push(pin.status != 'ok' ? `bot_manager didn't take "always list": ${pin.message}`
        : held ? 'It is listed for sale at the next sync, which starts now.' : 'The bots hold none of it yet; it is listed once they do.')
    }
  } else {
    notes.push(`bot_manager isn't connected: it reads the price from the database when it runs${p.list ? ', but "always list" wasn\'t set' : ''}.`)
  }
  return { status: 'ok', item: row({ ...doc, sell, buy, status: 1, updated: now, manual_price, bptf_data: { update_key_price: key || doc.bptf_data?.update_key_price } }), notes }
}

// lock or unlock a price set by hand; unlocked, item_manager prices the item again at its next round
export const lock = async (p = {}) => {
  const bp_sku = String(p.bp_sku || '').trim()
  const res = await item_model.updateOne({ bp_sku, manual_price: { $exists: true } }, { $set: { 'manual_price.locked': p.locked !== false } })
  return res.matchedCount || res.n ? { status: 'ok' } : { status: 'error', message: 'That item has no price set by hand.' }
}

// forget a price set by hand: the price stays until item_manager prices the item again
export const forget = async (p = {}) => {
  const bp_sku = String(p.bp_sku || '').trim()
  const res = await item_model.updateOne({ bp_sku, manual_price: { $exists: true } }, { $unset: { manual_price: '' } })
  return res.matchedCount || res.n ? { status: 'ok' } : { status: 'error', message: 'That item has no price set by hand.' }
}
