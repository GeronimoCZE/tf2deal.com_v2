// Site settings: one copy in memory, saved in MongoDB (model/SiteSetting.js).
//
//   get()               every setting (admin panel, other apps)
//   public_view()       what the browser may see: trading on/off, the announcement banner, the rating box settings
//   may_list(item, side) whether the bots may list an item on backpack.tf ('buy' or 'sell'), from the listings setting
//   update(patch, by)   checks the patch, saves it, then announces 'settings:changed' on localEmitter
//                       (service/socket.js sends it to the /settings socket and to every visitor)
//
// A patch only lists what changes, e.g. { trading_state: 0 } or { item_blacklist: { add: ['Team Captain'] } }.
// See SETTINGS.md for every field.

import crypto from 'crypto'
import localEmitter from '../emitter.js'
import { setting_model } from '../model/SiteSetting.js'

const INDEX = () => String(process.env.STEAM_GROUP_ID || '0')

const LEVELS = ['info', 'warning', 'danger']
const SEASON_CHOICES = ['auto', 'off', 'summer', 'halloween', 'smissmas'] // see service/season.js
const MAX_BLACKLIST = 2000
const MAX_LISTING_RULES = 500
const MAX_EXTRA_BYTES = 16 * 1024

const DEFAULTS = {
  trading_state: 1,
  min_item_key: 0,
  max_item_key: 20,
  item_blacklist: [],
  announcement: { enabled: false, text: '', level: 'info' },
  reviews: { enabled: true, trustpilot_url: 'https://www.trustpilot.com/review/tf2deal.com' },
  season: 'auto',
  // What the bots list on backpack.tf (the bot server applies it; admin panel -> Listings):
  //   enabled: only items that match one of the rules are listed; rules: [{ quality: '6', type: 'cosmetic' }], where
  //   quality '' = any quality and type 'group:weapon' = every type starting with "weapon"; buy / sell: which listings
  //   the rules limit; exclude: items never listed (by bp_sku), whether the rules are on or not.
  listings: { enabled: false, rules: [], buy: true, sell: true, exclude: [] },
  extra: {}
}

let current = { ...structuredClone(DEFAULTS), version: 0, updated: 0, updated_by: '' }
let loaded = false
let queue = Promise.resolve() // updates run one after another, so two apps can't overwrite each other

const is_object = (v) => v != null && typeof v == 'object' && !Array.isArray(v)

const normalize_listings = (l) => {
  const v = is_object(l) ? l : {}
  return {
    enabled: v.enabled === true,
    rules: Array.isArray(v.rules) ? v.rules.filter(is_object).map((r) => ({ quality: String(r.quality ?? ''), type: String(r.type ?? '') })) : [],
    buy: v.buy !== false,
    sell: v.sell !== false,
    exclude: Array.isArray(v.exclude) ? v.exclude.filter((s) => typeof s == 'string') : []
  }
}

// a document from the DB -> the shape everyone else sees
const normalize = (doc = {}) => {
  const a = is_object(doc.announcement) ? doc.announcement : {}
  return {
    trading_state: doc.trading_state === 0 ? 0 : 1,
    min_item_key: Number.isFinite(doc.min_item_key) ? doc.min_item_key : DEFAULTS.min_item_key,
    max_item_key: Number.isFinite(doc.max_item_key) ? doc.max_item_key : DEFAULTS.max_item_key,
    item_blacklist: Array.isArray(doc.item_blacklist) ? doc.item_blacklist.filter((s) => typeof s == 'string') : [],
    announcement: {
      enabled: a.enabled === true,
      text: typeof a.text == 'string' ? a.text : '',
      level: LEVELS.includes(a.level) ? a.level : 'info'
    },
    reviews: {
      enabled: is_object(doc.reviews) ? doc.reviews.enabled !== false : DEFAULTS.reviews.enabled,
      trustpilot_url: is_object(doc.reviews) && typeof doc.reviews.trustpilot_url == 'string' ? doc.reviews.trustpilot_url : DEFAULTS.reviews.trustpilot_url
    },
    season: SEASON_CHOICES.includes(doc.season) ? doc.season : 'auto',
    listings: normalize_listings(doc.listings),
    extra: is_object(doc.extra) ? doc.extra : {},
    version: Number(doc.version) || 0,
    updated: Number(doc.updated) || 0,
    updated_by: typeof doc.updated_by == 'string' ? doc.updated_by : ''
  }
}

export const get = () => structuredClone(current)
export const is_loaded = () => loaded
export const trading_enabled = () => current.trading_state === 1

export const public_view = () => ({
  trading: current.trading_state === 1,
  announcement: (current.announcement.enabled && current.announcement.text)
    ? { text: current.announcement.text, level: current.announcement.level }
    : null,
  reviews: { enabled: current.reviews.enabled, trustpilot_url: current.reviews.trustpilot_url },
  version: current.version
})

// item names are compared without case and outer spaces
const blacklist_key = (name) => String(name || '').trim().toLowerCase()
export const is_blacklisted = (bp_sku) => {
  if(!current.item_blacklist.length){ return false }
  const key = blacklist_key(bp_sku)
  return current.item_blacklist.some((name) => blacklist_key(name) === key)
}

// "weapon primary" matches the rule types "weapon primary" and "group:weapon" (any case); '' matches every type
export const type_matches = (rule_type, type) => {
  if(!rule_type){ return true }
  const t = String(type || '').trim().toLowerCase()
  const r = String(rule_type).trim().toLowerCase()
  if(r.startsWith('group:')){ const group = r.slice(6); return t == group || t.startsWith(group + ' ') }
  return t == r
}

// May the bots list this item (an item_instances document: bp_sku, qualityID, type) on the buy or sell side?
// Listings made by hand in the admin panel don't go through this. Same rule as in docs/LISTINGS.md.
export const may_list = (item, side, l = current.listings) => {
  if(l.exclude.length && l.exclude.some((name) => blacklist_key(name) === blacklist_key(item?.bp_sku))){ return false }
  if(!l.enabled || !l[side]){ return true }
  return l.rules.some((r) => (!r.quality || r.quality === String(item?.qualityID ?? '')) && type_matches(r.type, item?.type))
}

// Reads the settings from the DB (creates the document the first time). Called once the DB is connected.
export const load = async () => {
  let doc = await setting_model.findOne({ index: INDEX() }).lean()
  if(!doc){
    doc = (await new setting_model({ index: INDEX(), ...DEFAULTS }).save()).toObject()
  }
  current = normalize(doc)
  loaded = true
  localEmitter.emit('settings:loaded', get())
  return get()
}

/* ========================= CHECKING A PATCH ========================= */

const key_amount = (value, name, errors) => {
  const n = Number(value)
  if(value === '' || value === null || typeof value == 'boolean' || !Number.isFinite(n) || n < 0 || n > 100000){
    errors.push(`${name} must be a number from 0 to 100000.`)
    return undefined
  }
  return Math.round(n * 100) / 100
}

const item_names = (list, name, errors) => {
  if(!Array.isArray(list)){ errors.push(`${name} must be a list of item names.`); return [] }
  const out = []
  for (const entry of list) {
    if(typeof entry != 'string' || !entry.trim() || entry.trim().length > 200){
      errors.push(`${name}: every item name must be text of 1 to 200 characters.`)
      return []
    }
    out.push(entry.trim())
  }
  return out
}

const dedupe = (list) => {
  const seen = new Set()
  return list.filter((name) => { const k = blacklist_key(name); if(seen.has(k)){ return false } seen.add(k); return true })
}

// { enabled, rules, buy, sell, exclude }: only the fields sent change; rules is always the whole list,
// exclude is a whole list or { add: [...], remove: [...] } like item_blacklist.
const check_listings = (v, next, errors) => {
  if(!is_object(v)){ errors.push('listings must be an object, e.g. { "enabled": true, "rules": [{ "quality": "6", "type": "cosmetic" }] }.'); return }
  const unknown = Object.keys(v).filter((k) => !['enabled', 'rules', 'buy', 'sell', 'exclude'].includes(k))
  if(unknown.length){ errors.push(`Unknown listings field: ${unknown.join(', ')}.`) }
  const l = next.listings

  for (const key of ['enabled', 'buy', 'sell']) {
    if(!(key in v)){ continue }
    if(typeof v[key] != 'boolean'){ errors.push(`listings.${key} must be true or false.`) } else { l[key] = v[key] }
  }

  if('rules' in v){
    if(!Array.isArray(v.rules)){ errors.push('listings.rules must be a list of { "quality": "6", "type": "cosmetic" }.') }
    else {
      const seen = new Set()
      const rules = []
      for (const r of v.rules) {
        const quality = is_object(r) ? String(r.quality ?? '').trim() : null
        const type = is_object(r) && typeof (r.type ?? '') == 'string' ? String(r.type ?? '').trim() : null
        if(quality === null || !/^(\d{1,3})?$/.test(quality)){ errors.push('listings.rules: quality must be a quality number like "6", or "" for any quality.'); break }
        if(type === null || type.length > 80 || type == 'group:'){ errors.push('listings.rules: type must be an item type like "cosmetic", "group:weapon", or "" for any type.'); break }
        if(!quality && !type){ errors.push('listings.rules: a rule needs a quality, a type or both.'); break }
        const key = `${quality}|${type.toLowerCase()}`
        if(!seen.has(key)){ seen.add(key); rules.push({ quality, type }) }
      }
      if(rules.length > MAX_LISTING_RULES){ errors.push(`listings.rules can hold up to ${MAX_LISTING_RULES} rules.`) }
      l.rules = rules
    }
  }

  if('exclude' in v){
    const e = v.exclude
    if(Array.isArray(e)){ l.exclude = dedupe(item_names(e, 'listings.exclude', errors)) }
    else if(is_object(e) && ('add' in e || 'remove' in e)){
      const add = 'add' in e ? item_names(e.add, 'listings.exclude.add', errors) : []
      const remove = new Set(('remove' in e ? item_names(e.remove, 'listings.exclude.remove', errors) : []).map(blacklist_key))
      l.exclude = dedupe([...l.exclude, ...add]).filter((name) => !remove.has(blacklist_key(name)))
    } else { errors.push('listings.exclude must be a list of item names, or { "add": [...], "remove": [...] }.') }
    if(l.exclude.length > MAX_BLACKLIST){ errors.push(`listings.exclude can hold up to ${MAX_BLACKLIST} items.`) }
  }

  if(l.enabled && l.rules.length == 0){ errors.push('Pick at least one type and quality to list, or turn the listing rules off.') }
  if(l.enabled && !l.buy && !l.sell){ errors.push('Pick which listings the rules limit: buy, sell or both.') }
}

// Returns { value, errors }: value is the complete new settings object (current + patch).
export const check = (patch, base = current) => {
  const errors = []
  const next = structuredClone({ ...base })

  if(!is_object(patch)){ return { value: null, errors: ['The update must be an object, e.g. { "trading_state": 0 }.'] } }

  const allowed = ['trading_state', 'min_item_key', 'max_item_key', 'item_blacklist', 'announcement', 'reviews', 'season', 'listings', 'extra']
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k))
  if(unknown.length){ errors.push(`Unknown setting${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Put your own values under "extra".`) }

  if('trading_state' in patch){
    const v = patch.trading_state
    if(v === true || v === 1 || v === '1'){ next.trading_state = 1 }
    else if(v === false || v === 0 || v === '0'){ next.trading_state = 0 }
    else { errors.push('trading_state must be 1 (on) or 0 (paused).') }
  }

  if('min_item_key' in patch){ const v = key_amount(patch.min_item_key, 'min_item_key', errors); if(v !== undefined){ next.min_item_key = v } }
  if('max_item_key' in patch){ const v = key_amount(patch.max_item_key, 'max_item_key', errors); if(v !== undefined){ next.max_item_key = v } }
  if(next.min_item_key > next.max_item_key){ errors.push('min_item_key can\'t be higher than max_item_key.') }

  if('item_blacklist' in patch){
    const v = patch.item_blacklist
    if(Array.isArray(v)){
      next.item_blacklist = dedupe(item_names(v, 'item_blacklist', errors))
    } else if(is_object(v) && ('add' in v || 'remove' in v)){
      const add = 'add' in v ? item_names(v.add, 'item_blacklist.add', errors) : []
      const remove = new Set(('remove' in v ? item_names(v.remove, 'item_blacklist.remove', errors) : []).map(blacklist_key))
      next.item_blacklist = dedupe([...next.item_blacklist, ...add]).filter((name) => !remove.has(blacklist_key(name)))
    } else {
      errors.push('item_blacklist must be a list of item names, or { "add": [...], "remove": [...] }.')
    }
    if(next.item_blacklist.length > MAX_BLACKLIST){ errors.push(`item_blacklist can hold up to ${MAX_BLACKLIST} items.`) }
  }

  if('announcement' in patch){
    const v = patch.announcement
    if(!is_object(v)){
      errors.push('announcement must be an object: { "enabled": true, "text": "...", "level": "info" }.')
    } else {
      if('enabled' in v){
        if(typeof v.enabled != 'boolean'){ errors.push('announcement.enabled must be true or false.') }
        else { next.announcement.enabled = v.enabled }
      }
      if('text' in v){
        if(typeof v.text != 'string' || v.text.trim().length > 300){ errors.push('announcement.text must be text of up to 300 characters.') }
        else { next.announcement.text = v.text.trim() }
      }
      if('level' in v){
        if(!LEVELS.includes(v.level)){ errors.push(`announcement.level must be one of: ${LEVELS.join(', ')}.`) }
        else { next.announcement.level = v.level }
      }
      const extra_keys = Object.keys(v).filter((k) => !['enabled', 'text', 'level'].includes(k))
      if(extra_keys.length){ errors.push(`Unknown announcement field: ${extra_keys.join(', ')}.`) }
    }
  }

  if('reviews' in patch){
    const v = patch.reviews
    if(!is_object(v)){
      errors.push('reviews must be an object: { "enabled": true, "trustpilot_url": "https://..." }.')
    } else {
      if('enabled' in v){
        if(typeof v.enabled != 'boolean'){ errors.push('reviews.enabled must be true or false.') }
        else { next.reviews.enabled = v.enabled }
      }
      if('trustpilot_url' in v){
        const url = typeof v.trustpilot_url == 'string' ? v.trustpilot_url.trim() : null
        let ok = url === ''
        if(url){ try { ok = new URL(url).protocol == 'https:' && url.length <= 300 } catch (e) { ok = false } }
        if(!ok){ errors.push('reviews.trustpilot_url must be an https:// link (or empty to hide the Trustpilot button).') }
        else { next.reviews.trustpilot_url = url }
      }
      const extra_keys = Object.keys(v).filter((k) => !['enabled', 'trustpilot_url'].includes(k))
      if(extra_keys.length){ errors.push(`Unknown reviews field: ${extra_keys.join(', ')}.`) }
    }
  }

  if('season' in patch){
    if(SEASON_CHOICES.includes(patch.season)){ next.season = patch.season }
    else { errors.push(`season must be one of: ${SEASON_CHOICES.join(', ')}.`) }
  }

  if('listings' in patch){ check_listings(patch.listings, next, errors) }

  if('extra' in patch){
    const v = patch.extra
    if(!is_object(v)){
      errors.push('extra must be an object of your own keys, e.g. { "bot_count": 4 }. A key set to null is removed.')
    } else {
      for (const [k, val] of Object.entries(v)) {
        if(!/^[A-Za-z0-9_.-]{1,64}$/.test(k) || k.includes('$') ){ errors.push(`extra: "${k}" is not a valid key (letters, digits, _ . -, up to 64).`); continue }
        if(val === null){ delete next.extra[k] } else { next.extra[k] = val }
      }
      let size = 0
      try { size = Buffer.byteLength(JSON.stringify(next.extra)) } catch (e) { errors.push('extra must be plain JSON.') }
      if(size > MAX_EXTRA_BYTES){ errors.push(`extra is too big (${size} bytes, max ${MAX_EXTRA_BYTES}).`) }
    }
  }

  return { value: errors.length ? null : next, errors }
}

const changed_keys = (a, b) => ['trading_state', 'min_item_key', 'max_item_key', 'item_blacklist', 'announcement', 'reviews', 'season', 'listings', 'extra']
  .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))

/* ========================= SAVING ========================= */

// by: { kind: 'admin' | 'app', name: 'admin panel' | 'bot server' | ... }
// Resolves { status: 'ok', settings, changed } or { status: 'error', message, errors }
export const update = (patch, by = { kind: 'app', name: 'unknown' }) => {
  const run = async () => {
    if(!loaded){
      if(process.db_status?.connected !== true){ return { status: 'error', message: 'The database is not connected yet. Try again in a moment.' } }
      await load()
    }

    const { value, errors } = check(patch)
    if(errors.length){ return { status: 'error', message: errors.join(' '), errors } }

    const changed = changed_keys(current, value)
    if(changed.length == 0){ return { status: 'ok', settings: get(), changed } }

    if(process.db_status?.connected !== true){ return { status: 'error', message: 'The database is not connected, so the change could not be saved.' } }

    const by_label = `${by.kind}:${by.name}`.slice(0, 120)
    const $set = { updated: Date.now(), updated_by: by_label }
    for (const k of changed) { $set[k] = value[k] }

    const doc = await setting_model.findOneAndUpdate(
      { index: INDEX() },
      { $set, $inc: { version: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean()

    const before = public_view()
    current = normalize(doc)
    const after = public_view()

    const event = {
      settings: get(),
      changed,
      version: current.version,
      updated: current.updated,
      by: { kind: by.kind, name: by.name },
      public_changed: JSON.stringify({ ...before, version: 0 }) !== JSON.stringify({ ...after, version: 0 })
    }
    console.log(`settings: ${changed.join(', ')} changed by ${by_label} (v${current.version})`)
    localEmitter.emit('settings:changed', event)

    return { status: 'ok', settings: get(), changed }
  }

  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result.catch((e) => {
    console.log('settings: update failed', e)
    return { status: 'error', message: 'Saving the settings failed.' }
  })
}

/* ========================= ADMIN SOCKET TOKEN ========================= */

// The admin panel joins the /settings socket with a short-lived signed token (the browser never sees
// SERVER_TOKEN / SERVER_SECRET). Signed with SESSION_SECRET, same secret as the login session.
const token_secret = () => process.env.SESSION_SECRET || 'thisisasecret'
const sign = (payload) => crypto.createHmac('sha256', token_secret()).update(payload).digest('base64url')

export const admin_token = (steamid, ttl_ms = 12 * 60 * 60 * 1000) => {
  const payload = `${steamid}.${Date.now() + ttl_ms}`
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export const verify_admin_token = (token) => {
  if(typeof token != 'string' || token.length > 500){ return null }
  const [encoded, signature] = token.split('.')
  if(!encoded || !signature){ return null }
  const payload = Buffer.from(encoded, 'base64url').toString()
  if(!safe_equal(signature, sign(payload))){ return null }
  const [steamid, expires] = payload.split('.')
  if(!(Number(expires) > Date.now()) || steamid !== process.env.ADMIN_STEAMID){ return null }
  return { steamid }
}

// constant-time compare (both sides must be non-empty)
export const safe_equal = (a, b) => {
  if(typeof a != 'string' || typeof b != 'string' || !a || !b){ return false }
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
