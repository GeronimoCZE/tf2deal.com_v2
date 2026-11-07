// Numbers for the landing page.
//
// "Trades today" used to come only from the bot server's `fp_data` report, which always sent 0, so the page
// always said 0. The trades themselves are in our own `trades` collection (the bots write each accepted trade
// there), so we count them here instead: everything since midnight UTC, refreshed at most once a minute.
// trades_total(): every trade the bots made (Nikolas, 2026-11-07: "count all the trades we make just as a number"),
// counted in the same collection, also refreshed at most once a minute. Trades between our own bots don't count.
// pure_keys(): the keys and metal all bots hold, counted in keys (Nikolas, 2026-11-07: "amount of pure available in
// keys", shown under Items Available).

import { trade_model } from '../model/Trade.js'
import { inventory_value_model as Snapshots } from '../model/InventoryValue.js'
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

const total = { value: null, at: 0, loading: null }

// all trades ever made with the bots; null until the first count (the database couldn't be read yet)
export const trades_total = async () => {
  if (Date.now() - total.at >= CACHE_MS && !total.loading) {
    total.loading = trade_model.countDocuments({ internalTrade: { $ne: true } })
      .then((count) => { Object.assign(total, { value: count, at: Date.now() }) })
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
