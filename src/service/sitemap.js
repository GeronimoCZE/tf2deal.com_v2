// XML sitemaps, built from the database when a search engine asks (no files on disk):
//   /sitemap.xml (also /sitemap_index.xml): the index, one entry per sitemap below
//   /sitemaps/pages.xml: the main pages, in every language
//   /sitemaps/items-1.xml, /sitemaps/items-de-1.xml, ...: item pages (fn.item_indexable), per language
//   /sitemaps/blog.xml: published blog posts, in every language they exist in
// A built set is kept for CACHE_MS, so a crawler reading every sitemap doesn't query the database each time.

import { item_model as Items } from '../model/Item.js'
import { blog_model } from '../model/Blog.js'
import { localize_path, LANGS, DEFAULT_LANG } from '../i18n.js'
import { available_langs } from './translate.js'
import * as fn from '../fn.js'

const CACHE_MS = 10 * 60 * 1000
const FILE_SIZE = 20000 // URLs per item sitemap (search engines take up to 50,000)

// main pages in every language; documents that only exist in English once
const PAGES = [
  { path: '/', changefreq: 'always', priority: '1.0' },
  { path: '/trade', changefreq: 'always', priority: '0.9' },
  { path: '/items', changefreq: 'always', priority: '0.8' },
  { path: '/giveaway', changefreq: 'daily', priority: '0.6' },
  { path: '/blog', changefreq: 'daily', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' }
]
const ENGLISH_ONLY = [
  { path: '/terms-of-service', changefreq: 'yearly', priority: '0.2' },
  { path: '/cookies', changefreq: 'yearly', priority: '0.2' }
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

const index = (names) => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  names.map((name) => `<sitemap>\n<loc>${xml_escape(`${fn.site_url}/sitemaps/${name}`)}</loc>\n</sitemap>\n`).join('') +
  '</sitemapindex>\n'

const page_url = (lang, p) => fn.site_url + localize_path(lang, p)

let cache = null   // { time, files: Map(name -> xml) }
let building = null

const build = async () => {
  const files = new Map()

  files.set('pages.xml', urlset([
    ...LANGS.flatMap((lang) => PAGES.map((p) => ({ ...p, loc: page_url(lang, p.path) }))),
    ...ENGLISH_ONLY.map((p) => ({ ...p, loc: fn.site_url + p.path }))
  ]))

  // the items the bots really trade (the same rule as the item page's noindex), each one once
  const items = await Items.find(fn.SITEMAP_ITEMS_QUERY, { _id: 0, bp_sku: 1 }).lean()
  const names = [...new Set(items.map((item) => item.bp_sku).filter(Boolean))].sort()
  for (let n = 0; n * FILE_SIZE < names.length; n++) {
    const list = names.slice(n * FILE_SIZE, (n + 1) * FILE_SIZE)
    for (const lang of LANGS) {
      const name = lang === DEFAULT_LANG ? `items-${n + 1}.xml` : `items-${lang}-${n + 1}.xml`
      files.set(name, urlset(list.map((bp_sku) => ({ ...ITEM, loc: page_url(lang, '/items/' + encodeURIComponent(bp_sku)) }))))
    }
  }

  // published blog posts, in every language they exist in (the original + AI translations, see service/translate.js)
  const posts = await blog_model.find({ published: true }, { slug: 1, lang: 1, source_hash: 1, translations: 1, updated: 1 }).lean()
  if (posts.length > 0) { // an empty sitemap is reported as an error by Search Console
    files.set('blog.xml', urlset(posts.flatMap((post) => available_langs(post).map((lang) => ({
      loc: page_url(lang, `/blog/${encodeURIComponent(post.slug)}`),
      lastmod: post.updated > 0 ? day(post.updated) : '',
      changefreq: 'weekly',
      priority: '0.5'
    })))))
  }

  return { time: Date.now(), files, items: names.length }
}

// the sitemap files, rebuilt when older than CACHE_MS (one build at a time; a failed build keeps the last good one)
const current = async () => {
  if (cache && Date.now() - cache.time < CACHE_MS) return cache
  building = building || build()
    .then((built) => { cache = built; return built })
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

export const index_handler = async (req, res) => {
  try {
    send(res, index([...(await current()).files.keys()]))
  } catch (error) {
    res.status(503).set('Retry-After', '600').send('Sitemap not available right now')
  }
}

export const file_handler = async (req, res) => {
  try {
    const xml = (await current()).files.get(req.params.file)
    if (!xml) return res.status(404).send('Not found') // also old sitemap files still on the server's disk
    send(res, xml)
  } catch (error) {
    res.status(503).set('Retry-After', '600').send('Sitemap not available right now')
  }
}

// drop the cached set (the next request builds a new one)
export const clear = () => { cache = null }
