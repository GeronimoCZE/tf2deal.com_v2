// Numbers for the landing page.
//
// "Trades today" used to come only from the bot server's `fp_data` report, which always sent 0, so the page
// always said 0. The trades themselves are in our own `trades` collection (the bots write each accepted trade
// there), so we count them here instead: everything since midnight UTC, refreshed at most once a minute.
// trades_total(): every trade the bots made (Nikolas, 2026-11-07: "count all the trades we make just as a number"),
// refreshed at most once a minute. Trades between our own bots don't count. The bot server deletes saved trades after
// 3 weeks, so the collection alone can't give it (it went down every night, Nikolas 2026-11-25): finished days are
// added to a stored number once (model/TradeCount.js) and only the last days are counted live.
// pure_keys(): the keys and metal all bots hold, counted in keys (Nikolas, 2026-11-07: "amount of pure available in
// keys", shown under Items Available).

import { trade_model } from '../model/Trade.js'
import { inventory_value_model as Snapshots } from '../model/InventoryValue.js'
import { trade_count_model as TradeCount } from '../model/TradeCount.js'
import mongoose from 'mongoose'
import * as inventory_value from './inventory_value.js'

const CACHE_MS = 60 * 1000
const cache = { value: 0, day: 0, at: 0, loading: null }

const start_of_day = (now = Date.now()) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// trade timestamps are milliseconds; older records may be in seconds, so both are counted. Trades between our own
// bots aren't.
const count_since = (since_ms) => trade_model.countDocuments({
  internalTrade: { $ne: true },
  $or: [
    { timestamp: { $gte: since_ms } },
    { timestamp: { $gte: Math.floor(since_ms / 1000), $lt: 1e11 } }
  ]
})

// ---- all trades ever ----
// total = the stored number (every trade before frozen_until) + the trades since frozen_until, counted live.
// frozen_until follows FREEZE_DAYS behind today, so a day is added once it's over (and late saves of its trades are in),
// long before the bot server deletes it (21 days). Each step adds only the days between the old and the new
// frozen_until, and only if nobody moved it meanwhile, so a day is never added twice and the total never goes down.
const DAY = 24 * 60 * 60 * 1000
const FREEZE_DAYS = 2
const COUNT_ID = 'trades_total'
const user_trades = { internalTrade: { $ne: true } }

// trades in [from_ms, to_ms); timestamps in seconds (old records) too
const count_between = (from_ms, to_ms) => trade_model.countDocuments({
  ...user_trades,
  $or: [
    { timestamp: { $gte: from_ms, $lt: to_ms } },
    { timestamp: { $gte: Math.floor(from_ms / 1000), $lt: Math.min(Math.ceil(to_ms / 1000), 1e11) } }
  ]
})

const ms = (timestamp) => { const t = Number(timestamp) || 0; return t > 0 && t < 1e11 ? t * 1000 : t }

// User trades per UTC day that the bot server wrote down itself (bot_manager utils/flipGoal.js: runtime_settings
// 'flip_goal_state', value.history[] { day: 'YYYY-MM-DD', trades }, up to 120 days), so days whose trades were deleted
// before this counter existed still count. Map day ms -> trades; empty when there's nothing.
const days_written_down = async () => {
  const doc = await mongoose.connection.db.collection('runtime_settings').findOne({ key: 'flip_goal_state' }, { projection: { 'value.history': 1 } })
  const days = new Map()
  for (const h of (Array.isArray(doc?.value?.history) ? doc.value.history : [])) {
    const day = Date.parse(`${h?.day}T00:00:00Z`)
    const trades = Number(h?.trades)
    if (Number.isFinite(day) && Number.isInteger(trades) && trades >= 0) days.set(day, trades)
  }
  return days
}

// the first number: trades still in the collection before `until`, plus the days the bot server wrote down from before
// the oldest trade it still keeps (that day itself too: its first minutes may be deleted already)
const first_count = async (until) => {
  const oldest = await trade_model.findOne({ ...user_trades, timestamp: { $gt: 0 } }, { timestamp: 1 }).sort({ timestamp: 1 }).lean()
  const kept_from = oldest ? Math.min(until, start_of_day(ms(oldest.timestamp)) + DAY) : until
  const days = await days_written_down().catch((error) => { console.error('trades total: days written down:', error?.message || error); return new Map() })
  const earlier = [...days].filter(([day]) => day < kept_from)
  if (earlier.length) {
    const before = earlier.reduce((sum, [, trades]) => sum + trades, 0)
    const kept = await count_between(kept_from, until)
    return { frozen: before + kept, seeded_from: { days_written_down: earlier.length, since: new Date(Math.min(...earlier.map(([d]) => d))).toISOString().slice(0, 10), trades_written_down: before, trades_kept: kept, at: Date.now() } }
  }
  // nothing written down: what the collection still has (also records without a timestamp, as the old count did)
  const [all, recent] = await Promise.all([trade_model.countDocuments(user_trades), count_since(until)])
  return { frozen: Math.max(0, all - recent), seeded_from: { trades_kept: Math.max(0, all - recent), at: Date.now() } }
}

const frozen_count = async () => {
  const until = start_of_day() - FREEZE_DAYS * DAY
  let doc = await TradeCount.findById(COUNT_ID).lean()
  if (!doc) {
    const first = await first_count(until)
    await TradeCount.updateOne({ _id: COUNT_ID }, { $setOnInsert: { frozen_until: until, ...first } }, { upsert: true })
      .catch((error) => { if (error?.code != 11000) throw error }) // another start wrote it first: use that one
    doc = await TradeCount.findById(COUNT_ID).lean()
    if (doc?.seeded_from) console.log('Trades total: started at', doc.frozen, 'trades before', new Date(doc.frozen_until).toISOString().slice(0, 10), doc.seeded_from)
  }
  if (doc && doc.frozen_until < until) {
    const add = await count_between(doc.frozen_until, until)
    await TradeCount.updateOne({ _id: COUNT_ID, frozen_until: doc.frozen_until }, { $inc: { frozen: add }, $set: { frozen_until: until } })
    doc = await TradeCount.findById(COUNT_ID).lean()
  }
  if (!doc) throw new Error('the trade counter could not be saved')
  return doc
}

const count_total = async () => {
  const { frozen, frozen_until } = await frozen_count()
  return (Number(frozen) || 0) + await count_since(frozen_until)
}

const total = { value: null, at: 0, loading: null }

// all trades ever made with the bots; null until the first count (the database couldn't be read yet)
export const trades_total = async () => {
  if (Date.now() - total.at >= CACHE_MS && !total.loading) {
    total.loading = count_total()
      // never show less than before: a count made while the database was busy can't take the number back
      .then((count) => { Object.assign(total, { value: Math.max(count, total.value || 0), at: Date.now() }) })
      .catch((error) => { console.error('trades total:', error?.message || error) })
      .finally(() => { total.loading = null })
  }
  // as trades_today: never hold the page for long, a slow database shows the last known number
  if (total.loading) await Promise.race([total.loading, new Promise((resolve) => setTimeout(resolve, 1500))])
  return total.value
}

// fallback: what the bot server reported, in case the database can't be read right now
export const trades_today = async (fallback = 0) => {
  const day = start_of_day()
  if (cache.day == day && Date.now() - cache.at < CACHE_MS) { return cache.value }
  if (!cache.loading) {
    cache.loading = count_since(day)
      .then((count) => { Object.assign(cache, { value: count, day, at: Date.now() }) })
      .catch((error) => { console.error('trades today:', error?.message || error) })
      .finally(() => { cache.loading = null })
  }
  // never hold the page for long: a slow database shows the last known number
  await Promise.race([cache.loading, new Promise((resolve) => setTimeout(resolve, 1500))])
  if (cache.day == day) { return cache.value }
  return Number(fallback) || 0
}

// The bots' keys and metal come from the bot server, the same answer the trade page gets (inventory_value.bot_pure),
// asked at most every PURE_MS. If the bot server doesn't answer, the newest Admin -> Inventory value measurement
// stands in while it is under PURE_OLD old. Metal counts at the current key price. null while nothing is known, and
// the home page then leaves the line out.
const PURE_MS = 2 * 60 * 1000
const PURE_OLD = 2 * 60 * 60 * 1000
const pure = { value: null, at: 0, tried: 0, loading: null, error: '' }

const pure_now = async () => {
  try {
    return { ...await inventory_value.bot_pure(), t: Date.now() }
  } catch (error) {
    const newest = await Snapshots.findOne({ t: { $gte: Date.now() - PURE_OLD } }, { t: 1, keys: 1, metal: 1 }).sort({ t: -1 }).lean().catch(() => null)
    if (newest) return newest
    throw error
  }
}

export const pure_keys = async () => {
  if (Date.now() - pure.tried >= PURE_MS && !pure.loading) {
    pure.tried = Date.now()
    pure.loading = pure_now()
      .then(({ keys, metal, t }) => {
        const key_ref = inventory_value.key_price_now()
        if (!(key_ref > 0)) throw new Error('the key price is not known yet')
        Object.assign(pure, { value: Math.max(0, Number(keys) || 0) + Math.max(0, Number(metal) || 0) / key_ref, at: t, error: '' })
      })
      .catch((error) => {
        const message = error?.message || String(error)
        if (message != pure.error) console.log('Home page pure: not counted:', message) // once, not every 2 minutes
        pure.error = message
      })
      .finally(() => { pure.loading = null })
  }
  // only the first count after a start may hold the page, and only briefly; later ones update in the background
  if (pure.loading && pure.value == null) await Promise.race([pure.loading, new Promise((resolve) => setTimeout(resolve, 1500))])
  return Date.now() - pure.at < PURE_OLD ? pure.value : null
}
