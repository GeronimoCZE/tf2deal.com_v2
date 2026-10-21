// Backpack.tf listings in the admin panel (js/admin.js -> #listings, routes: api/routes/admin.js -> /listings/*).
//
// The bot server makes and keeps the bots' backpack.tf listings. The site:
//   - holds the listing rules: the live setting `listings` (service/settings.js), which the bot server reads on the
//     /settings socket like the other settings
//   - asks the bot server for every listing (`listings:get`) to show them, and to take one down (`listings:remove`)
//   - keeps the listings made by hand (model/ManualListing.js): each new one goes to the bot server at once
//     (`listings:create`), and the whole list goes out on `listings:manual` whenever the bots socket connects or
//     the list changes, so the bot server can put them back after a restart
// What the bot server has to do: docs/LISTINGS.md.
import * as app from '../app.js'
import localEmitter from '../emitter.js'
import * as settings from './settings.js'
import { bot_socket } from './socket.js'
import { item_model } from '../model/Item.js'
import { manual_listing_model } from '../model/ManualListing.js'
import { display_name, details as copy_details, to_ref } from './buy_link.js'

const PER_PAGE = 50
const REPORT_MAX_AGE = 60 * 1000 // the bots' listings are asked again after a minute (or on Refresh)
const MAX_KEYS = 10000
const KS_NAMES = ['', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak']

const str = (value, max) => (typeof value == 'string' || typeof value == 'number') ? String(value).trim().slice(0, max) : ''
const escape_regex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const amount = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0 }
const ms = (value) => { const n = Number(value) || Date.parse(value) || 0; return n > 0 && n < 1e11 ? n * 1000 : n } // backpack.tf times are in seconds

// one event to the bot server, answered through the ack ({ success, ... })
const ask = (event, payload = {}, timeout = 15000) => new Promise((resolve) => {
  const socket = bot_socket.socket
  if(!socket?.connected){ return resolve({ success: false, offline: true, error: 'The bot server is not connected.' }) }
  socket.timeout(timeout).emit(event, payload, (err, res) => {
    if(err){ return resolve({ success: false, no_answer: true, error: `The bot server did not answer ${event}.` }) }
    resolve((res && typeof res == 'object') ? res : { success: false, error: 'The bot server sent no answer.' })
  })
})

// the bots the bot server reports (fp_data), as { steamid, name }
export const bots = () => (Array.isArray(app.fp_data?.bots) ? app.fp_data.bots : [])
  .filter((b) => /^\d{17}$/.test(String(b?.steamid ?? '')))
  .map((b) => ({ steamid: String(b.steamid), name: String(b.personaname || b.name || '').slice(0, 64) }))

/* ---------- what the bot server has listed ---------- */

const report = { asked: 0, time: 0, listings: [], error: '', offline: false }
let asking = null

// A listing from the bot server. Its own fields, or backpack.tf's (intent, currencies, item.name, item.id, listedAt).
const clean_listing = (l) => {
  if(!l || typeof l != 'object'){ return null }
  const intent = ['buy', 0, '0'].includes(l.intent) ? 'buy' : ['sell', 1, '1'].includes(l.intent) ? 'sell' : null
  const price = (l.price && typeof l.price == 'object') ? l.price : (l.currencies && typeof l.currencies == 'object') ? l.currencies : {}
  const bp_sku = str(l.bp_sku, 300) || str(l.name, 300) || str(l.item?.name, 300)
  if(!intent || !bp_sku){ return null }
  return {
    id: str(l.id ?? l.listing_id, 100),
    bot: str(l.bot ?? l.steamid, 20),
    intent,
    bp_sku,
    assetid: str(l.assetid ?? (intent == 'sell' ? l.item?.id : ''), 20),
    price: { keys: amount(price.keys), metal: amount(price.metal) },
    details: str(l.details, 300),
    manual_id: str(l.manual_id, 30),
    created: ms(l.created ?? l.listedAt),
    bumped: ms(l.bumped ?? l.bumpedAt)
  }
}

const refresh = (force = false) => {
  if(!force && Date.now() - report.asked < REPORT_MAX_AGE){ return Promise.resolve() }
  if(asking){ return asking }
  asking = ask('listings:get', {}, 10000).then((res) => {
    report.asked = Date.now()
    report.offline = !!res.offline
    if(res.success && Array.isArray(res.listings)){
      report.time = Date.now()
      report.listings = res.listings.slice(0, 20000).map(clean_listing).filter(Boolean)
      report.error = ''
    } else {
      report.error = res.error || res.message || 'The bot server refused.'
    }
  }).finally(() => { asking = null })
  return asking
}

/* ---------- the list in the admin panel ---------- */

const QUALITY_WORDS = /^(Strange|Genuine|Vintage|Haunted|Collector's|Unusual|Decorated|Community|Self-Made|Normal) /
// "Strange Professional Killstreak Rocket Launcher" -> "Strange Rocket Launcher", to find the item it belongs to
const base_sku = (name) => {
  const quality = name.match(QUALITY_WORDS)?.[0] || ''
  const rest = name.slice(quality.length).replace(/^(Festivized )?((Professional |Specialized )?Killstreak )?/, '')
  return quality + rest
}

const manual_row = (m, bot_names) => ({
  id: m.listing_id || '',
  manual_id: String(m._id),
  bot: m.bot,
  bot_name: bot_names.get(m.bot) || '',
  intent: m.intent,
  bp_sku: m.bp_sku,
  name: m.ks ? display_name(m.bp_sku, { ks: m.ks }) : m.bp_sku,
  assetid: m.assetid || '',
  price: { keys: amount(m.price?.keys), metal: amount(m.price?.metal) },
  details: m.details || '',
  source: 'manual',
  status: m.status,
  error: m.error || '',
  created: m.created
})

// filters: side 'buy' | 'sell', bot (steamid), q (part of the name), source 'auto' | 'manual'; refresh asks the bot server now
export const list = async ({ side, bot, q, source, page, refresh: force } = {}) => {
  await refresh(force === true)
  const db = process.db_status?.connected === true
  const manual = db ? await manual_listing_model.find({}).sort({ created: -1 }).limit(5000).lean() : []
  const manual_ids = new Map(manual.map((m) => [String(m._id), m]))
  const bot_names = new Map(bots().map((b) => [b.steamid, b.name]))
  const reported_ok = report.time > 0 && !report.error

  const rows = report.listings.map((l) => {
    const m = manual_ids.get(l.manual_id)
    return {
      ...l,
      bot_name: bot_names.get(l.bot) || '',
      name: m?.ks ? display_name(m.bp_sku, { ks: m.ks }) : l.bp_sku,
      source: m ? 'manual' : 'auto',
      status: 'listed'
    }
  })
  const reported_manual = new Set(rows.filter((r) => r.source == 'manual').map((r) => r.manual_id))
  for (const m of manual) {
    if(reported_manual.has(String(m._id))){ continue }
    const row = manual_row(m, bot_names)
    // the bot server answered and doesn't have it (yet): it is waiting, unless the bot server said it failed
    if(reported_ok && row.status != 'failed'){ row.status = 'pending' }
    rows.push(row)
  }

  const needle = str(q, 100).toLowerCase()
  const matches = rows.filter((r) => (!bot || r.bot == bot) && (!source || r.source == source) && (!needle || r.name.toLowerCase().includes(needle)))
  const counts = { all: matches.length, buy: matches.filter((r) => r.intent == 'buy').length, sell: matches.filter((r) => r.intent == 'sell').length }
  const shown = (side == 'buy' || side == 'sell') ? matches.filter((r) => r.intent == side) : matches
  shown.sort((a, b) => (b.created || 0) - (a.created || 0) || a.name.localeCompare(b.name))

  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1)
  const page_rows = shown.slice(p * PER_PAGE, (p + 1) * PER_PAGE)

  // pictures and qualities from item_instances
  if(db && page_rows.length){
    const names = [...new Set(page_rows.flatMap((r) => [r.bp_sku, base_sku(r.bp_sku)]))]
    const docs = await item_model.find({ bp_sku: { $in: names } }, { _id: 0, bp_sku: 1, image: 1, qualityID: 1, type: 1 }).lean()
    const by_sku = new Map(docs.map((d) => [d.bp_sku, d]))
    for (const r of page_rows) {
      const doc = by_sku.get(r.bp_sku) || by_sku.get(base_sku(r.bp_sku))
      r.image = doc?.image || ''
      r.qualityID = doc?.qualityID ?? ''
      r.type = doc?.type || ''
      r.item = doc?.bp_sku || ''
    }
  }

  return {
    status: 'ok',
    report: { time: report.time, asked: report.asked, error: report.error, offline: report.offline || !bot_socket.socket?.connected },
    bots: bots(),
    counts,
    total: shown.length,
    page: p,
    per_page: PER_PAGE,
    listings: page_rows
  }
}

/* ---------- the listing rules ---------- */

// priced items per type and quality, for the rules grid (the grid adds them up to show what the rules let through)
export const options = async () => {
  const rows = await item_model.aggregate([
    { $match: { status: { $in: [1, 2] } } },
    { $group: { _id: { type: '$type', quality: '$qualityID' }, items: { $sum: 1 } } }
  ])
  const cells = rows.map((r) => ({ type: str(r._id?.type, 80), quality: str(r._id?.quality, 4), items: r.items }))
    .filter((c) => c.type && /^\d{1,3}$/.test(c.quality))
  return { status: 'ok', cells }
}

/* ---------- listings made by hand ---------- */

const payload = (m) => ({
  manual_id: String(m._id), bot: m.bot, intent: m.intent, bp_sku: m.bp_sku, ks: m.ks || 0, assetid: m.assetid || '',
  price: { keys: amount(m.price?.keys), metal: amount(m.price?.metal) }, details: m.details || '', created: m.created
})

// the whole list to the bot server: it lists what is new and takes down what is gone
export const send_manual = async () => {
  const socket = bot_socket.socket
  if(!socket?.connected || process.db_status?.connected !== true){ return false }
  const list = await manual_listing_model.find({}).lean()
  socket.emit('listings:manual', list.map(payload))
  return true
}

const split_price = (ref, key_ref) => {
  const keys = (key_ref > 0 && ref >= key_ref) ? Math.floor(ref / key_ref) : 0
  const metal = ref - keys * key_ref
  return { keys, metal: (metal > 0 && metal < 0.11) ? Math.round(metal * 1000) / 1000 : Math.round(metal * 100) / 100 } // 0.055 stays 0.055
}

// What the form needs once an item and a bot are picked: its prices (buy, sell, each killstreak tier) and, for a
// sell listing, the copies this bot holds.
export const item_info = async (bp_sku, bot) => {
  const name = str(bp_sku, 300)
  const doc = name ? await item_model.findOne({ bp_sku: name }, { _id: 0, bp_sku: 1, image: 1, qualityID: 1, type: 1, status: 1, buy: 1, sell: 1,
    killstreak: 1, 'bptf_data.update_key_price': 1, 'stock.items': 1 }).lean() : null
  if(!doc){ return { status: 'error', message: 'No item with that name. Pick one from the list.' } }

  const key_ref = Number(doc.bptf_data?.update_key_price) || Number(app.key_price?.metal) || 0
  const tiers = (Array.isArray(doc.killstreak) ? doc.killstreak : [])
    .map((t) => ({ ks: Number(t?.ks_tier ?? t?.kt) || 0, buy: to_ref(t?.buy, key_ref), sell: to_ref(t?.sell, key_ref) }))
    .filter((t) => t.ks >= 1 && t.ks <= 3)
    .map((t) => ({ ks: t.ks, name: KS_NAMES[t.ks], buy: split_price(t.buy, key_ref), sell: split_price(t.sell, key_ref) }))
  const owner = str(bot, 20)
  const copies = (Array.isArray(doc.stock?.items) ? doc.stock.items : [])
    .filter((a) => /^\d{1,20}$/.test(String(a?.a ?? '')) && (!owner || !a.ownerId || String(a.ownerId) == owner))
    .slice(0, 200)
    .map((a) => ({ assetid: String(a.a), name: display_name(doc.bp_sku, a), ks: Number(a.ks) || 0, details: copy_details(a) }))

  return {
    status: 'ok',
    item: {
      bp_sku: doc.bp_sku, image: doc.image || '', qualityID: doc.qualityID ?? '', type: doc.type || '', priced: [1, 2].includes(doc.status),
      key_price: key_ref,
      buy: split_price(to_ref(doc.buy, key_ref), key_ref),
      sell: split_price(to_ref(doc.sell, key_ref), key_ref),
      tiers,
      copies,
      may_list: { buy: settings.may_list(doc, 'buy'), sell: settings.may_list(doc, 'sell') }
    }
  }
}

// { bot, intent: 'buy' | 'sell', bp_sku, ks (buy, 0-3), assetid (sell), price: { keys, metal }, details }
export const create = async (input, by) => {
  const v = (input && typeof input == 'object') ? input : {}
  const bot = str(v.bot, 20)
  const intent = v.intent
  const bp_sku = str(v.bp_sku, 300)
  const keys = Number(v.price?.keys ?? 0)
  const metal = Number(v.price?.metal ?? 0)
  const details = str(v.details, 200).replace(/[\u0000-\u001f\u007f]/g, ' ')

  if(!/^\d{17}$/.test(bot)){ return { status: 'error', message: 'Pick the bot.' } }
  const known = bots()
  if(known.length && !known.some((b) => b.steamid == bot)){ return { status: 'error', message: 'That bot is not running right now.' } }
  if(!['buy', 'sell'].includes(intent)){ return { status: 'error', message: 'Pick buy or sell.' } }
  if(!bp_sku){ return { status: 'error', message: 'Pick the item.' } }
  if(!Number.isInteger(keys) || keys < 0 || keys > MAX_KEYS){ return { status: 'error', message: `Keys must be a whole number from 0 to ${MAX_KEYS}.` } }
  if(!Number.isFinite(metal) || metal < 0 || metal >= 10000){ return { status: 'error', message: 'Refined must be a number from 0, e.g. 1.33.' } }
  if(keys == 0 && metal == 0){ return { status: 'error', message: 'Set a price.' } }
  if(keys == 0 && metal < 0.11){ return { status: 'error', message: 'Nothing under one scrap (0.11 ref) is listed on backpack.tf; 0.055 ref items are traded on the site only.' } }

  const doc = await item_model.findOne({ bp_sku }, { _id: 0, bp_sku: 1, killstreak: 1, 'stock.items': 1 }).lean()
  if(!doc){ return { status: 'error', message: 'No item with that name. Pick one from the list.' } }

  const listing = { bot, intent, bp_sku, ks: 0, assetid: '', price: { keys, metal: Math.round(metal * 100) / 100 }, details }
  if(intent == 'sell'){
    const assetid = str(v.assetid, 20)
    if(!/^\d{1,20}$/.test(assetid)){ return { status: 'error', message: 'Pick the copy to sell.' } }
    const copy = (Array.isArray(doc.stock?.items) ? doc.stock.items : []).find((a) => String(a?.a) == assetid)
    if(!copy || (copy.ownerId && String(copy.ownerId) != bot)){ return { status: 'error', message: "That bot doesn't hold this copy." } }
    listing.assetid = assetid
    if(await manual_listing_model.exists({ intent: 'sell', assetid })){ return { status: 'error', message: 'This copy already has a listing made by hand.' } }
  } else {
    const ks = Number(v.ks) || 0
    if(![0, 1, 2, 3].includes(ks)){ return { status: 'error', message: 'Pick a killstreak tier.' } }
    if(ks > 0 && !(Array.isArray(doc.killstreak) && doc.killstreak.length)){ return { status: 'error', message: 'This item has no killstreak versions.' } }
    listing.ks = ks
    if(await manual_listing_model.exists({ bot, intent: 'buy', bp_sku, ks })){ return { status: 'error', message: 'This bot already has a buy listing made by hand for this item.' } }
  }

  const now = Date.now()
  const m = await new manual_listing_model({ ...listing, status: 'pending', created: now, created_by: by, updated: now }).save()
  const res = await ask('listings:create', payload(m))

  if(!res.success && !res.offline && !res.no_answer){
    await manual_listing_model.deleteOne({ _id: m._id })
    return { status: 'error', message: `The bot server refused: ${str(res.error || res.message, 300) || 'no reason given'}` }
  }
  if(res.success){
    await manual_listing_model.updateOne({ _id: m._id }, { $set: { status: 'listed', listing_id: str(res.listing?.id ?? res.id, 100), updated: Date.now() } })
  }
  report.asked = 0 // the list shows the new one on the next load
  send_manual().catch(() => {})
  return {
    status: 'ok',
    result: res.success ? 'listed' : 'pending',
    message: res.success ? 'Listed on backpack.tf.' : `Saved. ${res.offline ? 'The bot server is offline; it' : "The bot server didn't answer yet; it"} lists it when it gets the listing.`
  }
}

// Takes a listing down. One made by hand is also deleted here (the bot server takes it down when it next gets the
// list, if it can't now). never: the item is also added to listings.exclude, so the bots don't list it again.
export const remove = async (input, by) => {
  const v = (input && typeof input == 'object') ? input : {}
  const manual_id = str(v.manual_id, 30)
  const id = str(v.id, 100)

  if(manual_id){
    if(!/^[a-f0-9]{24}$/.test(manual_id)){ return { status: 'error', message: 'Not found.' } }
    const m = await manual_listing_model.findById(manual_id).lean()
    if(!m){ return { status: 'error', message: 'This listing was already deleted.' } }
    const res = await ask('listings:remove', { id: m.listing_id || id, bot: m.bot, manual_id })
    await manual_listing_model.deleteOne({ _id: m._id })
    report.listings = report.listings.filter((l) => l.manual_id != manual_id)
    send_manual().catch(() => {})
    return { status: 'ok', message: res.success ? 'Taken down.' : `Deleted. ${res.error || ''} The bot server takes it down when it gets the list again.`.replace(/\s+/g, ' ') }
  }

  const bot = str(v.bot, 20)
  if(!id || !/^\d{17}$/.test(bot)){ return { status: 'error', message: 'Which listing? It needs its id and bot.' } }
  const listing = report.listings.find((l) => l.id == id && l.bot == bot)
  const res = await ask('listings:remove', { id, bot })
  if(!res.success){ return { status: 'error', message: res.error || res.message || 'The bot server refused.' } }
  report.listings = report.listings.filter((l) => !(l.id == id && l.bot == bot))

  if(v.never === true){
    const name = listing ? base_sku(listing.bp_sku) : str(v.bp_sku, 300)
    if(name){
      const r = await settings.update({ listings: { exclude: { add: [name] } } }, { kind: 'admin', name: 'admin panel' })
      if(r.status != 'ok'){ return { status: 'ok', message: `Taken down, but it could not be added to "Never list": ${r.message}` } }
      return { status: 'ok', message: `Taken down. ${name} is not listed again.` }
    }
  }
  return { status: 'ok', message: 'Taken down. The bot lists it again at its next refresh unless the rules or "Never list" stop it.' }
}

/* ---------- bots socket ---------- */

// bot server -> site (both optional):
//   listings:changed          its listings changed: the admin panel asks again on its next load
//   listings:manual_status    [{ manual_id, status: 'listed' | 'failed', listing_id, error }] for listings made by hand
const attached = new WeakSet()
localEmitter.on('bots:connected', (socket) => {
  if(socket && !attached.has(socket)){
    attached.add(socket)
    socket.on('listings:changed', () => { report.asked = 0 })
    socket.on('listings:manual_status', async (list) => {
      if(!Array.isArray(list) || process.db_status?.connected !== true){ return }
      for (const s of list.slice(0, 5000)) {
        const id = str(s?.manual_id, 30)
        if(!/^[a-f0-9]{24}$/.test(id) || !['listed', 'failed'].includes(s?.status)){ continue }
        await manual_listing_model.updateOne({ _id: id }, { $set: { status: s.status, listing_id: str(s.listing_id, 100), error: str(s.error, 300), updated: Date.now() } }).catch(() => {})
      }
    })
  }
  report.asked = 0
  send_manual().catch((e) => console.log('listings: sending the manual listings failed', e))
})
