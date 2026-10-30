// One XML sitemap, built from the database and the in-memory item list (no file on disk): /sitemap.xml.
// The main pages come first with the highest priority, then blog posts, then every item page at 0.4,
// each in every language it exists in. /sitemap_index.xml and the old /sitemaps/*.xml files redirect to it.
// The built file is used for CACHE_MS and always answered at once (see current()), so Cloudflare and search engines
// never wait for the database.

import * as item_lists from './item_lists.js'
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

let cache = null    // { time, xml, urls, complete }
let building = null
let last_blog = []  // the blog part of the last good build, used while the database doesn't answer

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
  let names = []
  try {
    names = await item_lists.sitemap_names()
  } catch (error) {
    complete = false // the item list isn't read yet: the sitemap goes out without items and is built again soon
  }
  // only the items that fit in the file get their URLs made (all of them were 275,000 URLs in a test with 45,000 items)
  const room = Math.max(MAX_URLS - pages.length - blog.length, 0)
  const item_urls = names.slice(0, Math.ceil(room / LANGS.length))
    .flatMap((bp_sku) => LANGS.map((lang) => ({ ...ITEM, loc: page_url(lang, '/items/' + encodeURIComponent(bp_sku)) })))

  const total = pages.length + blog.length + names.length * LANGS.length
  if (total > MAX_URLS) console.log(`Sitemap: ${total} URLs, only the first ${MAX_URLS} fit in one file`)
  const urls = [...pages, ...blog, ...item_urls].slice(0, MAX_URLS)
  return { time: Date.now(), xml: urlset(urls), urls: urls.length, complete }
}

// one build at a time; a failed build keeps the last good one
const rebuild = () => {
  building = building || build()
    .then((built) => {
      cache = built
      setTimeout(() => { if (cache === built) cache = null }, 6 * CACHE_MS).unref() // a few MB nobody asked for in an hour
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
// waits for a build, at most FIRST_WAIT, and then gets the main pages and blog posts.
const current = async () => {
  if (cache) {
    const age = Date.now() - cache.time
    if (age >= (cache.complete ? CACHE_MS : 60 * 1000)) rebuild().catch(() => {})
    return cache
  }
  try {
    return await timeout(rebuild(), FIRST_WAIT, 'sitemap')
  } catch (error) {
    return { xml: urlset([...main_pages(), ...last_blog]), complete: false }
  }
}

// Express handlers
const send = (res, xml, complete) => {
  res.set('Content-Type', 'application/xml; charset=utf-8')
  res.set('Cache-Control', `public, max-age=${complete ? 600 : 60}`)
  res.set('X-Robots-Tag', 'noindex') // the sitemap itself is not a search result
  res.send(xml)
}

export const handler = async (req, res) => {
  const map = await current()
  send(res, map.xml, map.complete)
}

// build it right after the start, so the first crawler doesn't wait
export const warm = () => rebuild().catch(() => {})

// the sitemap index and its files from before everything was in one file (also old files still on the server's disk)
export const redirect = (req, res) => res.redirect(301, '/sitemap.xml')

// the items or blog posts changed: the next request still gets the current sitemap and starts a new build
export const clear = () => { if (cache) cache.time = 0 }
