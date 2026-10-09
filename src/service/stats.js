// Numbers for the landing page.
//
// "Trades today" used to come only from the bot server's `fp_data` report, which always sent 0, so the page
// always said 0. The trades themselves are in our own `trades` collection (the bots write each accepted trade
// there), so we count them here instead: everything since midnight UTC, refreshed at most once a minute.

import { trade_model } from '../model/Trade.js'

const CACHE_MS = 60 * 1000
const cache = { value: 0, day: 0, at: 0, loading: null }

const start_of_day = (now = Date.now()) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// trade timestamps are milliseconds; older records may be in seconds, so both are counted
const count_since = (since_ms) => trade_model.countDocuments({
  $or: [
    { timestamp: { $gte: since_ms } },
    { timestamp: { $gte: Math.floor(since_ms / 1000), $lt: 1e11 } }
  ]
})

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
