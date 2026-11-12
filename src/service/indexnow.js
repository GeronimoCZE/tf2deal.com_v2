// IndexNow (https://www.indexnow.org): tells Bing (Edge search, also Yandex, Seznam, ...) about new pages right away,
// instead of waiting for the next crawl. Off until INDEXNOW_KEY is set in .env (8-128 letters, digits or dashes, e.g.
// a random hex string); the key is then served at /<key>.txt to prove the site is ours.
//
//   key_file(req, res, next)  Express handler for /:file.txt
//   submit(urls)              sends the URLs (only on the live site, SITE_URL = fn.site_url)
//
// service/sitemap.js submits every sitemap URL once a day at most (state in the OS temp folder, so a restart doesn't
// send them all again), and later only the item pages that are new in the sitemap.

import fs from 'fs'
import os from 'os'
import path from 'path'
import fetch from 'node-fetch'
import * as fn from '../fn.js'

const ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH = 10000 // the most URLs one request may hold
const FULL_EVERY = 24 * 60 * 60 * 1000
const STATE = path.join(os.tmpdir(), 'tf2deal-indexnow.json')

const key = () => {
  const value = String(process.env.INDEXNOW_KEY || '').trim()
  return /^[a-zA-Z0-9-]{8,128}$/.test(value) ? value : ''
}
// only the live site submits (a test copy would announce tf2deal.com pages it doesn't serve)
export const enabled = () => Boolean(key()) && String(process.env.SITE_URL || '').replace(/\/+$/, '') === fn.site_url

export const key_file = (req, res, next) => {
  if (!key() || req.params.file !== key()) return next()
  res.type('text/plain').send(key())
}

export const submit = async (urls) => {
  if (!enabled() || !urls.length) return
  const host = new URL(fn.site_url).host
  for (let i = 0; i < urls.length; i += BATCH) {
    const list = urls.slice(i, i + BATCH)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key: key(), keyLocation: `${fn.site_url}/${key()}.txt`, urlList: list }),
        timeout: 30 * 1000
      })
      // 200 and 202 = received; 403 = the key file isn't reachable, 422 = URLs not on this host
      if (res.status >= 300) console.log(`IndexNow: ${list.length} URLs refused (${res.status})`)
      else console.log(`IndexNow: ${list.length} URLs sent`)
    } catch (error) {
      console.log('IndexNow: not sent:', error?.message || error)
    }
  }
}

// every URL of a full sitemap, at most once per FULL_EVERY
export const submit_all = async (urls) => {
  if (!enabled()) return
  let last = 0
  try { last = JSON.parse(fs.readFileSync(STATE, 'utf8')).full || 0 } catch (e) {}
  if (Date.now() - last < FULL_EVERY) return
  try { fs.writeFileSync(STATE, JSON.stringify({ full: Date.now() })) } catch (e) {}
  await submit(urls)
}
