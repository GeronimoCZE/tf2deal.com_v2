// When each feature of the news list (service/news.js) went live, to the minute, for the updates page (/news).
//
// An entry's date is the day its pull request names. The moment it really reached visitors is when the server first
// ran with it out: after `git pull` + restart, or at the start of its day when it was dated ahead. record() writes that
// moment down once per entry (news_times collection, never changed after) and keeps them in memory, so the page never
// waits for the database. It runs when the database connects and then every minute; with every entry written down it
// does nothing. An entry whose date carries a time ('YYYY-MM-DD HH:MM') uses that and is never written down.
// Until its moment is known (no database yet) the page shows the entry's day without a time.

import * as site_news from './news.js'
import { news_time_model } from '../model/NewsTime.js'

const EVERY = 60 * 1000
const WAIT = 10 * 1000

const known = new Map() // key -> ms
let running = null

// when the entry went live (ms), or null while that isn't known
export const live_at = (entry) => (site_news.exact(entry) ? site_news.time(entry) : known.get(entry?.key) ?? null)

// what the updates page shows: { ...entry, at (ms), exact (the time of day is known) }, newest first
export const page = (now = Date.now()) => site_news.published(now).map((entry) => {
  const at = live_at(entry)
  return { ...entry, at: at ?? site_news.day(entry), exact: at != null }
})

// when the newest entry went live: the updates page's lastmod (sitemap)
export const last_change = (now = Date.now()) => page(now).reduce((last, entry) => Math.max(last, entry.at), 0)

export const record = () => {
  if (running) return running
  running = (async () => {
    if (process.db_status?.connected !== true) return
    const now = Date.now()
    const keys = site_news.published(now).filter((entry) => !site_news.exact(entry) && !known.has(entry.key)).map((entry) => entry.key)
    if (!keys.length) return
    try {
      // first one wins: an entry written down before (or by another instance of the site) keeps its moment
      await Promise.all(keys.map((key) => news_time_model.updateOne({ _id: key }, { $setOnInsert: { live_at: now } }, { upsert: true }).maxTimeMS(WAIT).catch((error) => {
        if (error?.code !== 11000) throw error // 11000: written at the same moment elsewhere, read below
      })))
      const rows = await news_time_model.find({ _id: { $in: keys } }).maxTimeMS(WAIT).lean()
      for (const row of rows) { if (row.live_at > 0) known.set(row._id, row.live_at) }
    } catch (error) {
      console.log('News: go-live times not saved yet:', error?.message || error)
    }
  })().finally(() => { running = null })
  return running
}

export const start = () => {
  setInterval(() => record(), EVERY).unref?.()
}
