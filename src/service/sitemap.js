// One XML sitemap, built from the database when a search engine asks (no file on disk): /sitemap.xml.
// The main pages come first with the highest priority, then blog posts, then every item page at 0.4,
// each in every language it exists in. /sitemap_index.xml and the old /sitemaps/*.xml files redirect to it.
// The built file is used for CACHE_MS, so a crawler doesn't query the database on every request, and let go after twice
// that (it can be several MB, and crawlers ask for it rarely).

import { item_model as Items } from '../model/Item.js'
import { blog_model } from '../model/Blog.js'
import { localize_path, LANGS } from '../i18n.js'
import { available_langs } from './translate.js'
import * as fn from '../fn.js'

const CACHE_MS = 10 * 60 * 1000
const MAX_URLS = 50000 // the most one sitemap file may hold

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

const page_url = (lang, p) => fn.site_url + localize_path(lang, p)

let cache = null   // { time, xml, urls }
let building = null

const build = async () => {
  const pages = [
    ...PAGES.flatMap((p) => LANGS.map((lang) => ({ ...p, loc: page_url(lang, p.path) }))),
    ...ENGLISH_ONLY.map((p) => ({ ...p, loc: fn.site_url + p.path }))
  ]

  // published blog posts, in every language they exist in (the original + AI translations, see service/translate.js)
  const posts = await blog_model.find({ published: true }, { slug: 1, lang: 1, source_hash: 1, translations: 1, updated: 1 }).lean()
  const blog = posts.flatMap((post) => available_langs(post).map((lang) => ({
    loc: page_url(lang, `/blog/${encodeURIComponent(post.slug)}`),
    lastmod: post.updated > 0 ? day(post.updated) : '',
    changefreq: 'weekly',
    priority: '0.5'
  })))

  // the items the bots really trade (the same rule as the item page's noindex), each one once, in every language
  const items = await Items.find(fn.SITEMAP_ITEMS_QUERY, { _id: 0, bp_sku: 1 }).lean()
  const names = [...new Set(items.map((item) => item.bp_sku).filter(Boolean))].sort()
  const item_urls = names.flatMap((bp_sku) => LANGS.map((lang) => ({ ...ITEM, loc: page_url(lang, '/items/' + encodeURIComponent(bp_sku)) })))

  const urls = [...pages, ...blog, ...item_urls]
  if (urls.length > MAX_URLS) console.log(`Sitemap: ${urls.length} URLs, only the first ${MAX_URLS} fit in one file`)
  return { time: Date.now(), xml: urlset(urls.slice(0, MAX_URLS)), urls: Math.min(urls.length, MAX_URLS) }
}

// the sitemap, rebuilt when older than CACHE_MS (one build at a time; a failed build keeps the last good one while it
// is still kept)
const current = async () => {
  if (cache && Date.now() - cache.time < CACHE_MS) return cache
  building = building || build()
    .then((built) => {
      cache = built
      setTimeout(() => { if (cache === built) cache = null }, 2 * CACHE_MS).unref()
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

// Express handlers
const send = (res, xml) => {
  res.set('Content-Type', 'application/xml; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=600')
  res.send(xml)
}

export const handler = async (req, res) => {
  try {
    send(res, (await current()).xml)
  } catch (error) {
    res.status(503).set('Retry-After', '600').send('Sitemap not available right now')
  }
}

// the sitemap index and its files from before everything was in one file (also old files still on the server's disk)
export const redirect = (req, res) => res.redirect(301, '/sitemap.xml')

// drop the cached sitemap (the next request builds a new one)
export const clear = () => { cache = null }
