// The XML sitemap, built from the database and the in-memory item list (no file on disk). One file may hold 50,000
// URLs and every item page exists in 8 languages, so /sitemap.xml is a sitemap index of:
//   /sitemaps/main.xml               the main pages (highest priority first) and the blog posts, in every language
//   /sitemaps/items-<lang>-<n>.xml   every item page in one language, ITEMS_PER_FILE per file (Search Console then
//                                    shows how many pages of each language are indexed)
// What goes in them is read again every CACHE_MS and always answered at once (see current()), so Cloudflare and search
// engines never wait for the database; each file is written out when it is asked for. /sitemap_index.xml and old
// file names redirect to /sitemap.xml.

import * as item_lists from './item_lists.js'
import { item_model as Items } from '../model/Item.js'
import { blog_model } from '../model/Blog.js'
import { localize_path, LANGS } from '../i18n.js'
import { available_langs } from './translate.js'
import * as fn from '../fn.js'
import * as indexnow from './indexnow.js'

const CACHE_MS = 10 * 60 * 1000
const ITEMS_PER_FILE = 40000 // a sitemap file may hold 50,000 URLs

// main pages in every language, highest priority first; documents that only exist in English once
const PAGES = [
  { path: '/', changefreq: 'always', priority: '1.0' },
  { path: '/trade', changefreq: 'always', priority: '0.9' },
  { path: '/items', changefreq: 'always', priority: '0.8' },
  { path: '/giveaway', changefreq: 'daily', priority: '0.6' },
  { path: '/blog', changefreq: 'daily', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' }
]
const ENGLISH_ONLY = [
  { path: '/terms-of-service', changefreq: 'yearly', priority: '0.5' },
  { path: '/cookies', changefreq: 'yearly', priority: '0.5' }
]
// the items whose pages belong in the sitemap, for the database: the page is shown (routes/router.js find_page_item)
// and fn.item_indexable says yes (item_lists.js applies that rule to the items it reads); keep the three the same
const ITEMS_QUERY = {
  buy: { $gt: 0 },
  sell: { $gt: 0 },
  $and: [
    { $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }] },
    { $or: [{ 'stock.cur': { $gt: 0 } }, { 'stock.items.0': { $exists: true } }, { status: 1, effectID: { $not: { $gt: 0 } } }] }
  ]
}
// item pages: prices and stock change all the time
const ITEM = { changefreq: 'always', priority: '0.4' }

const xml_escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;')
const day = (time) => new Date(time).toISOString().slice(0, 10)

const urlset = (urls) => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => '<url>\n' +
    `<loc>${xml_escape(u.loc)}</loc>\n` +
    (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>\n` : '') +
    `<changefreq>${u.changefreq}</changefreq>\n` +
    `<priority>${u.priority}</priority>\n` +
    '</url>\n').join('') +
  '</urlset>\n'

const sitemapindex = (locs) => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  locs.map((loc) => `<sitemap>\n<loc>${xml_escape(loc)}</loc>\n</sitemap>\n`).join('') +
  '</sitemapindex>\n'

const page_url = (lang, p) => fn.site_url + localize_path(lang, p)
const item_url = (lang, bp_sku) => page_url(lang, '/items/' + encodeURIComponent(bp_sku))

let cache = null    // { time, main, names, complete }
let building = null
let last_blog = []
let last_items = [] // the item names of the last good build
let last_source = ''  // the blog part of the last good build, used while the database doesn't answer

const ITEMS_WAIT = 5 * 60 * 1000 // how long the item names may take to read from the database (in the background)
const BLOG_WAIT = 10 * 1000   // how long the blog posts may take to read
const FIRST_WAIT = 5 * 1000   // how long a request waits for the very first build (Cloudflare and crawlers give up)

const timeout = (promise, ms, what) => {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer after ${ms / 1000} s`)), ms) })
  ]).finally(() => clearTimeout(timer))
}

const main_pages = () => [
  ...PAGES.flatMap((p) => LANGS.map((lang) => ({ ...p, loc: page_url(lang, p.path) }))),
  ...ENGLISH_ONLY.map((p) => ({ ...p, loc: fn.site_url + p.path }))
]

// The items come from the item list the site keeps in memory (service/item_lists.js), not from a read of the whole
// item collection: on a busy database that read took longer than Cloudflare waits, and the sitemap timed out.
const build = async () => {
  const pages = main_pages()
  let complete = true

  // published blog posts, in every language they exist in (the original + AI translations, see service/translate.js)
  let blog = last_blog
  try {
    if (process.db_status?.connected !== true) throw new Error('no database') // mongoose would wait for a reconnect
    const posts = await timeout(blog_model.find({ published: true }, { slug: 1, lang: 1, source_hash: 1, translations: 1, updated: 1 }).maxTimeMS(BLOG_WAIT).lean(), BLOG_WAIT, 'blog posts')
    blog = last_blog = posts.flatMap((post) => available_langs(post).map((lang) => ({
      loc: page_url(lang, `/blog/${encodeURIComponent(post.slug)}`),
      lastmod: post.updated > 0 ? day(post.updated) : '',
      changefreq: 'weekly',
      priority: '0.5'
    })))
  } catch (error) {
    complete = false
    console.log('Sitemap: blog posts not read, the last ones stay:', error?.message || error)
  }

  // the items the bots really trade (the same rule as the item page's noindex), each one once, in every language
  // From the item list when it is read; when it isn't (still reading, or its reads stop at 2 min on a slow database),
  // straight from the database: only the names, and this runs in the background, never while a request waits.
  let names = null
  let source = 'item list'
  try {
    names = await item_lists.sitemap_names()
  } catch (error) {}
  if (!names?.length) {
    source = 'database'
    try {
      if (process.db_status?.connected !== true) throw new Error('no database')
      names = (await Items.distinct('bp_sku', ITEMS_QUERY).maxTimeMS(ITEMS_WAIT)).filter(Boolean).sort()
    } catch (error) {
      console.log('Sitemap: item names not read:', error?.message || error)
    }
  }
  if (names?.length) {
    if (source != last_source) console.log(`Sitemap: ${names.length} items from the ${source}`)
    last_items = names
    last_source = source
  } else {
    names = last_items // the last ones read, and the sitemap is built again in a minute
    complete = false
  }
  const main = [...pages, ...blog]
  if (complete) announce(main, names)
  return { time: Date.now(), main, names, complete }
}

// IndexNow (Bing / Edge): the whole sitemap once a day at most, then the item pages that are new in it
let announced = null // the item names of the last sitemap sent or compared
const announce = (main, names) => {
  if (!announced) indexnow.submit_all([...main.map((u) => u.loc), ...LANGS.flatMap((lang) => names.map((name) => item_url(lang, name)))])
  else indexnow.submit(names.filter((name) => !announced.has(name)).flatMap((name) => LANGS.map((lang) => item_url(lang, name))))
  announced = new Set(names)
}

// one build at a time; a failed build keeps the last good one
const rebuild = () => {
  building = building || build()
    .then((built) => {
      cache = built
      setTimeout(() => { if (cache === built) cache = null }, 6 * CACHE_MS).unref() // let go when nobody asked in an hour
      return built
    })
    .catch((error) => {
      console.log('Sitemap build failed:', error?.message || error)
      if (cache) return cache
      throw error
    })
    .finally(() => { building = null })
  return building
}

// The sitemap is answered at once whenever there is one, even an old one, and built again in the background when it
// is older than CACHE_MS (a sitemap without items, or with old blog posts, after a minute). Only the very first request
// waits for a build, at most FIRST_WAIT, and then gets the main pages and blog posts without items.
const current = async () => {
  if (cache) {
    const age = Date.now() - cache.time
    if (age >= (cache.complete ? CACHE_MS : 60 * 1000)) rebuild().catch(() => {})
    return cache
  }
  try {
    return await timeout(rebuild(), FIRST_WAIT, 'sitemap')
  } catch (error) {
    return { main: [...main_pages(), ...last_blog], names: last_items, complete: false }
  }
}

// Express handlers
const send = (res, xml, complete) => {
  res.set('Content-Type', 'application/xml; charset=utf-8')
  res.set('Cache-Control', `public, max-age=${complete ? 600 : 60}`)
  res.set('X-Robots-Tag', 'noindex') // the sitemap itself is not a search result
  res.send(xml)
}

// the item files of one language: items-en-1.xml, items-en-2.xml, ...
const item_files = (names) => {
  const count = Math.ceil(names.length / ITEMS_PER_FILE)
  return LANGS.flatMap((lang) => Array.from({ length: count }, (_, i) => `items-${lang}-${i + 1}.xml`))
}

// /sitemap.xml: the index of the files
export const handler = async (req, res) => {
  const map = await current()
  send(res, sitemapindex(['main.xml', ...item_files(map.names)].map((file) => `${fn.site_url}/sitemaps/${file}`)), map.complete)
}

// /sitemaps/<file>: one file of the index; a name it doesn't list (old files from before the index) goes to the index
export const file = async (req, res) => {
  const map = await current()
  const name = String(req.params.file || '')
  if (name == 'main.xml') return send(res, urlset(map.main), map.complete)
  const m = name.match(/^items-([a-z]{2})-(\d{1,4})\.xml$/)
  const part = m && LANGS.includes(m[1]) ? map.names.slice((m[2] - 1) * ITEMS_PER_FILE, m[2] * ITEMS_PER_FILE) : []
  // the item names aren't read yet (just after a restart): "try again later" keeps the file in search engines' lists
  if (!part.length && m && !map.complete) return res.status(503).set('Retry-After', '120').send('Sitemap not ready yet')
  if (!part.length) return redirect(req, res)
  send(res, urlset(part.map((bp_sku) => ({ ...ITEM, loc: item_url(m[1], bp_sku) }))), map.complete)
}

// build it right after the start, so the first crawler doesn't wait
export const warm = () => rebuild().catch(() => {})

// /sitemap_index.xml and old sitemap file names (also old files still on the server's disk)
export const redirect = (req, res) => res.redirect(301, '/sitemap.xml')

// the items or blog posts changed: the next request still gets the current sitemap and starts a new build
export const clear = () => { if (cache) cache.time = 0 }
