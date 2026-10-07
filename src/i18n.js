// Languages: URLs, translations and the language cookie.
//
//   /items        -> English (default, no prefix)
//   /de/items     -> German, /cs/items -> Czech, ...
//
// Texts live in src/locales/<lang>.json. English (en.json) is the source: a key missing in another
// language falls back to English, so a page never shows a raw key.
//   views:   <%= __('nav.trade') %>   <a href="<%= lurl('/items') %>">
//   routes:  req.__('title.items'), req.lurl('/blog')
//   browser: __('trade.max_items')  (keys under "js" in the locale files), lurl('/items/...')

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export const LANGS = ['en', 'cs', 'de', 'es', 'fr', 'pt', 'ru', 'zh']
export const DEFAULT_LANG = 'en'

// shown in the language menu
export const LANG_NAMES = { en: 'English', cs: 'Čeština', de: 'Deutsch', es: 'Español', fr: 'Français', pt: 'Português', ru: 'Русский', zh: '中文' }
// <html lang>, hreflang
export const LANG_TAGS = { en: 'en', cs: 'cs', de: 'de', es: 'es', fr: 'fr', pt: 'pt', ru: 'ru', zh: 'zh-Hans' }
// og:locale
export const OG_LOCALES = { en: 'en_US', cs: 'cs_CZ', de: 'de_DE', es: 'es_ES', fr: 'fr_FR', pt: 'pt_BR', ru: 'ru_RU', zh: 'zh_CN' }

const PREFIX = new RegExp(`^/(${LANGS.join('|')})(?=/|\\?|$)`)

/* ========================= TRANSLATIONS ========================= */

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locales')
const dicts = {}
for (const lang of LANGS) {
  try {
    dicts[lang] = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'))
  } catch (error) {
    console.log(`i18n: couldn't load locales/${lang}.json (${error.message})`)
    dicts[lang] = {}
  }
}

const lookup = (obj, key) => key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj)
const missing = new Set()

export const translate = (lang, key, vars) => {
  let text = lookup(dicts[lang], key)
  if (typeof text !== 'string') text = lookup(dicts[DEFAULT_LANG], key)
  if (typeof text !== 'string') {
    if (!missing.has(key)) { missing.add(key); console.log(`i18n: missing key "${key}"`) }
    return key
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m)) : text
}

// "js" texts for the browser, English filled in for anything not translated yet
const merge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge(base?.[k] || {}, v) : v
  }
  return out
}
const client_cache = {}
export const client_json = (lang) => {
  if (!client_cache[lang]) {
    client_cache[lang] = JSON.stringify(merge(dicts[DEFAULT_LANG].js || {}, dicts[lang]?.js || {})).replace(/</g, '\\u003c')
  }
  return client_cache[lang]
}

/* ========================= URLS ========================= */

// '/items' -> '/de/items' (English keeps the plain URL)
export const localize_path = (lang, p = '/') => {
  if (!lang || lang === DEFAULT_LANG) return p
  return `/${lang}${p === '/' ? '' : p}`
}

// '/de/items?x=1' -> { lang: 'de', url: '/items?x=1' }
export const split_lang = (url) => {
  const m = url.match(PREFIX)
  if (!m) return { lang: null, url }
  const rest = url.slice(m[0].length)
  // one leading slash only: '/en//evil.com' must not turn into a redirect to '//evil.com' (another site)
  return { lang: m[1], url: '/' + rest.replace(/^[\/\\]+/, '') }
}

/* ========================= COOKIES ========================= */

// td_consent = "v1:p0:a1:<timestamp>" (a = analytics; p is kept for older saved choices). Set by public/js/consent.js.
export const parse_consent = (value) => {
  const m = /^v1:p([01]):a([01]):(\d+)$/.exec(value || '')
  if (!m) return null
  return { preferences: m[1] === '1', analytics: m[2] === '1', time: Number(m[3]) }
}

// td_lang = the language the visitor picked themselves (language menu, suggestion bar).
// It's only written on that click (public/js/plugins/language.js, or /en/... below), so it's a
// "user-interface customisation" cookie that needs no consent (EU Article 29 WP, Opinion 04/2012, 3.6).
const LANG_COOKIE = 'td_lang'
const LANG_COOKIE_OPTIONS = { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' }

const best_accept_language = (header) => {
  // "cs-CZ,cs;q=0.9,en;q=0.8" -> 'cs' (first supported language by quality)
  const wanted = String(header || '').split(',').map((part) => {
    const [tag, q] = part.trim().split(';q=')
    return { lang: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 }
  }).filter((x) => x.lang && x.q > 0).sort((a, b) => b.q - a.q)
  return wanted.find((x) => LANGS.includes(x.lang))?.lang || null
}

// search engines and link-preview bots always get the page they asked for (no language redirect)
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|google-inspectiontool|headless/i

// navigation inside the site (the visitor is already on a page they chose)
const internal_referer = (req) => {
  try { return new URL(req.get('referer') || '').host === req.get('host') } catch (e) { return false }
}

// pages that never get a language prefix (login flow, admin, API, sockets)
const NO_LANG = /^\/(api|auth|logout|get_userDB_|admin|login|get-steambots|socket\.io)(\/|$)/

/* ========================= MIDDLEWARE ========================= */

// defaults for views rendered before the middleware runs (rate-limit page, early errors)
export const default_locals = {
  langs: LANGS,
  lang_names: LANG_NAMES,
  lang_tags: LANG_TAGS,
  lang: DEFAULT_LANG,
  html_lang: LANG_TAGS[DEFAULT_LANG],
  og_locale: OG_LOCALES[DEFAULT_LANG],
  __: (key, vars) => translate(DEFAULT_LANG, key, vars),
  __for: (lang, key, vars) => translate(lang, key, vars), // a text in another language (language suggestion bar)
  lurl: (p) => p,
  // HTML-escape a value that goes into an *_html translation
  esc: (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  alternates: (site_url, pathname) => alternates(site_url, pathname),
  get client_i18n() { return client_json(DEFAULT_LANG) }
}

export const middleware = (req, res, next) => {
  const { lang: url_lang, url } = split_lang(req.url)
  const saved = LANGS.includes(req.cookies?.[LANG_COOKIE]) ? req.cookies[LANG_COOKIE] : null
  const page_request = req.method === 'GET' && !NO_LANG.test(req.path) && req.accepts('html')
  const bot = BOT.test(req.get('user-agent') || '')
  const browser_lang = bot ? null : best_accept_language(req.get('accept-language'))

  // /en/... only comes from the language menu or suggestion bar: English was picked, save it and drop the prefix
  if (url_lang === DEFAULT_LANG) {
    res.cookie(LANG_COOKIE, DEFAULT_LANG, LANG_COOKIE_OPTIONS)
    return res.redirect(301, url)
  }

  let lang = url_lang || DEFAULT_LANG

  if (url_lang) {
    req.url = url // the routes see /items, not /de/items
  } else if (NO_LANG.test(req.path)) {
    // API calls and the login flow carry no prefix: answer in the language of the page they came from
    try {
      const from = split_lang(new URL(req.get('referer') || '', 'http://x').pathname).lang
      if (from) lang = from
    } catch (e) {}
  } else if (page_request) {
    // the plain (English) URL depends on these, so caches must keep the versions apart
    res.vary('Accept-Language')
    res.vary('Cookie')
    // 1. the language the visitor picked before
    if (saved) {
      if (saved !== DEFAULT_LANG) return res.redirect(302, localize_path(saved, req.url))
    // 2. first arrival (not a click inside the site): the browser's language
    } else if (browser_lang && browser_lang !== DEFAULT_LANG && !internal_referer(req)) {
      return res.redirect(302, localize_path(browser_lang, req.url))
    }
  }

  // no choice yet and this page isn't in the browser's language (e.g. a link to /de/... for a Czech visitor): offer it
  if (page_request && !saved && browser_lang && browser_lang !== lang) res.locals.lang_suggest = browser_lang

  req.lang = lang
  req.__ = (key, vars) => translate(lang, key, vars)
  req.lurl = (p) => localize_path(lang, p)

  res.locals.lang = lang
  res.locals.html_lang = LANG_TAGS[lang]
  res.locals.og_locale = OG_LOCALES[lang]
  res.locals.__ = req.__
  res.locals.lurl = req.lurl
  res.locals.consent = parse_consent(req.cookies?.td_consent)
  res.locals.client_i18n = client_json(lang)
  // the language menu links to this same page in every language (/en/... saves English and drops the prefix)
  res.locals.lang_urls = Object.fromEntries(LANGS.map((l) => [l, l === DEFAULT_LANG ? '/en' + (req.url === '/' ? '' : req.url) : localize_path(l, req.url)]))
  next()
}

/* ========================= MISC ========================= */

// <link rel="alternate" hreflang> for a page that exists in every language
export const alternates = (site_url, pathname) => [
  ...LANGS.map((l) => ({ hreflang: LANG_TAGS[l], href: site_url + localize_path(l, pathname) })),
  { hreflang: 'x-default', href: site_url + pathname }
]

export const t_for = (lang) => (key, vars) => translate(lang, key, vars)
