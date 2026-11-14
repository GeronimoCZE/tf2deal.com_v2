// The welcome window for new visitors (views/partials/welcome_modal.ejs, public/js/welcome.js, GET /api/welcome).
//
// A visitor counts as new while neither localStorage nor sessionStorage has its record (td_welcome); closing the
// window saves it and the window doesn't come back. Its "What's new" list is put together when it is asked for:
//   1. the giveaway that is running, if any
//   2. the newest blog posts (titles in the page language once translated)
//   3. the site's news (service/news.js): features, with their titles news.items.<key>.title
// newest first, at most NEWS_LIMIT, each a date and a title. The entry the news window shows is always in the list:
// closing the welcome window counts as having seen it, so a new visitor doesn't get the news window as well.
// The "What you can do here" list is FEATURES, with texts welcome.features.<key>_title / _text.

import * as app from '../app.js'
import { blog_model } from '../model/Blog.js'
import * as translate from './translate.js'
import * as site_news from './news.js'

export const FEATURES = [
  { key: 'trade', icon: 'trade2', href: '/trade' },
  { key: 'pure', icon: 'key', href: '/items' },
  { key: 'items', icon: 'database', href: '/items' },
  { key: 'giveaways', icon: 'gift', href: '/giveaway' },
  { key: 'safe', icon: 'verified', href: '/about' },
  { key: 'yours', icon: 'magic-wand' }
]

const NEWS_LIMIT = 4
const BLOG_LIMIT = 2

// the newest posts are read at most once every 10 minutes (the window is asked for on many first visits)
const BLOG_CACHE_MS = 10 * 60 * 1000
let blog_cache = { at: 0, posts: [] }
const newest_posts = async () => {
  if (Date.now() - blog_cache.at < BLOG_CACHE_MS) return blog_cache.posts
  if (process.db_status?.connected !== true) return blog_cache.posts
  try {
    const posts = await blog_model.find({ published: true }, { title: 1, slug: 1, created: 1, lang: 1, source_hash: 1, translations: 1 })
      .sort({ created: -1 }).limit(BLOG_LIMIT).lean()
    blog_cache = { at: Date.now(), posts }
  } catch (e) {
    blog_cache.at = Date.now() // tried: the old list (or none) until the next try
  }
  return blog_cache.posts
}

// the news list in a language: [{ kind, date (ms), title, href }] (the giveaway: end instead of date)
export const news = async (lang, __) => {
  const list = []
  if (app.giveaway?.active && app.giveaway.item?.bp_sku) {
    list.push({ kind: 'giveaway', date: null, end: Number(app.giveaway.end) || null, title: __('welcome.news_giveaway', { item: app.giveaway.item.bp_sku }), href: '/giveaway' })
  }
  const dated = []
  for (const post of await newest_posts()) {
    const shown = translate.localized(post, lang, ['title']) || { title: post.title }
    dated.push({ kind: 'blog', date: Number(post.created) || 0, title: shown.title, href: '/blog/' + encodeURIComponent(post.slug) })
  }
  for (const entry of site_news.published()) {
    // (noon UTC: the day shows the same in every time zone, as the window prints it)
    dated.push({ kind: 'update', key: entry.key, date: site_news.time(entry) + 12 * 3600 * 1000, title: __(`news.items.${entry.key}.title`), href: entry.href || null })
  }
  dated.sort((a, b) => b.date - a.date)
  // the news window's entry, then the newest of the rest
  const top = site_news.live()?.key
  const kept = dated.filter((n) => top && n.key === top)
  const rest = dated.filter((n) => !top || n.key !== top).slice(0, Math.max(0, NEWS_LIMIT - list.length - kept.length))
  return list.concat(kept.concat(rest).sort((a, b) => b.date - a.date)).slice(0, NEWS_LIMIT)
}
