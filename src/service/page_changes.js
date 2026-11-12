// When each item page last changed what it shows: its prices, its stock and whether the bots trade it. Bing's webmaster
// guidelines ask for an accurate <lastmod> in the sitemap and an IndexNow notice when a page's content changes, sent as
// it happens rather than in daily batches. Search engines then fetch the item pages that changed instead of guessing.
//
//   observe(signatures)  the item list's pages (item_lists.page_signatures(): Map name -> "buy|sell|stock|status");
//                        a page whose signature differs from the stored one changed now. service/sitemap.js calls it
//                        every minute.
//   changed(name)        when that page last changed (ms), or 0 when it hasn't been seen changing
//
// The signatures are stored in the page_changes collection, so a restart doesn't make every page look changed. A page
// seen for the first time gets no date until it really changes (a made-up date would not be accurate). The pages that
// changed go to IndexNow at once (English addresses, as the sitemap lists them); new and removed pages are sent by
// service/sitemap.js.

import { page_change_model as PageChanges } from '../model/PageChange.js'
import * as indexnow from './indexnow.js'
import * as fn from '../fn.js'

const LOAD_WAIT = 60 * 1000

const known = new Map() // name -> { sig, changed }
let loaded = false
let loading = null
let last_seen = null // the signatures last compared (the item list keeps one object until it changes)
let running = null

const load = async () => {
  if (process.db_status?.connected !== true) throw new Error('no database')
  const docs = await PageChanges.find({}, { sig: 1, changed: 1 }).maxTimeMS(LOAD_WAIT).lean()
  for (const doc of docs) known.set(doc._id, { sig: doc.sig || '', changed: Number(doc.changed) || 0 })
  loaded = true
  console.log(`Page changes: ${docs.length} item pages known`)
}

const compare = async (signatures) => {
  if (!loaded) {
    loading = loading || load().catch((error) => { console.log('Page changes: not read:', error?.message || error) }).finally(() => { loading = null })
    await loading
    if (!loaded) return // tried again at the next call
  }
  const now = Date.now()
  const writes = []
  const urls = []
  for (const [name, sig] of signatures) {
    if (!name || typeof sig !== 'string') continue
    const old = known.get(name)
    if (old && old.sig === sig) continue
    const entry = { sig, changed: old ? now : 0 }
    known.set(name, entry)
    writes.push({ updateOne: { filter: { _id: name }, update: { $set: entry }, upsert: true } })
    if (old) urls.push(fn.site_url + '/items/' + encodeURIComponent(name))
  }
  last_seen = signatures
  if (writes.length) {
    try {
      await PageChanges.bulkWrite(writes, { ordered: false })
    } catch (error) {
      console.log('Page changes: not saved:', error?.message || error) // kept in memory: after a restart these pages may count as changed once more
    }
  }
  if (urls.length) {
    console.log(`Page changes: ${urls.length} item pages changed (price, stock or traded)${indexnow.enabled() ? ', sending them to IndexNow' : ''}`)
    indexnow.submit(urls)
  }
}

export const observe = (signatures) => {
  if (!signatures || signatures === last_seen || running) return running || Promise.resolve()
  running = compare(signatures).catch((error) => console.log('Page changes failed:', error?.message || error)).finally(() => { running = null })
  return running
}

export const changed = (name) => known.get(name)?.changed || 0
