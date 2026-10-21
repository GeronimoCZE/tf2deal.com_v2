import fs from 'fs'
import path from 'path'
import SteamID from 'steamid'
import * as app from './app.js'
import {item_model as Items} from '../src/model/Item.js'
import { localize_path, DEFAULT_LANG, t_for } from './i18n.js'
import { bot_socket } from './service/socket.js'
import * as settings from './service/settings.js'
import * as season from './service/season.js'
import { url } from 'inspector'

/* =======================
   CORE HELPERS
======================= */

// Public address of the site: used for canonical URLs, social tags and the sitemaps (service/sitemap.js).
const site_url = 'https://tf2deal.com'

// '/items/' -> '/items' (one URL per page for search engines)
const clean_path = (pathname = '/') => String(pathname).replace(/\/+$/, '') || '/'

// full canonical URL of a page in a language: no query string, no trailing slash
const canonical_url = (pathname = '/', lang = 'en') => site_url + localize_path(lang, clean_path(pathname))

const res_data = (auth, user, user_db, title, info, datas) => {
  // lazy imports (keeps circular deps safe)
  const trades = app.offers
  const giveaway = app.giveaway
  const bot_server_status = bot_socket.socket ? 'online':"offline";
  const bots_state = bot_socket.socket ? 'online':"offline"
  const bptf_api_status = app.bptf_api?.status

  const data = datas

  const obj = {
    user,
    data,
    title,
    info,
    trade: false,
    ...(info?.trade && { trade: info.trade }),
    giveaway: giveaway.active,
    trading: bot_server_status,
    bptf_api: bptf_api_status,
    bots: bots_state,
    site_settings: settings.public_view() // trading on/off + announcement banner (live: 'site_settings' socket event)
  }

  if (!info) {
    obj.info = { view: undefined, message: '' }
    obj.info.season = season.body_class() // '' outside TF2 events, else season-summer / -halloween / -smissmas
  } else {
    if (!obj.info.view) obj.info.view = undefined
    obj.info.season = season.body_class() // '' outside TF2 events, else season-summer / -halloween / -smissmas
  }

  if (auth === true && user?.steamid) {
    if (trades.has(user.steamid)) {
      obj.trade = true
    }

    const sid = new SteamID(user.steamid)

    if (!user_db || user_db.user == null) {
      user_db = {
        user: {
          tradelink: '',
          role: 1,
          email: '',
          firstlogin: '',
          accountid: '',
          trades: 0,
          giveaways: { entries: 0, won: 0 }
        },
        trade_offer: {}
      }
    }

    user_db.user.accountid = sid.accountid
    obj.user_db = user_db
  }

  return obj
}

/* =======================
   COOKIE / TRADE
======================= */

const user_cookie = (steamid, user_db, trade_offer) => {
  const user_cookie_setting = {
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year (Date.now(x) ignores x, so this was ~56 years)
    secure: true
  }

  return {
    name: `td_${steamid}`,
    value: {
      user: user_db,
      trade_offer,
      update: Date.now() + 1000 * 60 * 60 * 2
    },
    setting: user_cookie_setting
  }
}

const trade_offer_obj = (trade_id, trade_url) => ({
  id: trade_id,
  url: trade_url
})

/* =======================
   UTILITIES
======================= */

const round_ref = (refs) => {
  const ref = Math.trunc(refs)
  let ref_float = refs - ref
  ref_float = Number(ref_float.toFixed(5))

  const float = [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 1]
    .reduce((a, b) =>
      Math.abs(b - ref_float) < Math.abs(a - ref_float) ? b : a
    )

  return ref + float
}

/* =======================
   PLACEHOLDERS
======================= */

const setup_cache = () => {}

const item_check = async () => {
  // checks if bots own item
}

/* =======================
   SOCKET CALLBACK
======================= */

const socketCallback = (onSuccess, onTimeout, timeout) => {
  let called = false

  const timer = setTimeout(() => {
    if (called) return
    called = true
    onTimeout()
  }, timeout)

  return (...args) => {
    if (called) return
    called = true
    clearTimeout(timer)
    onSuccess(...args)
  }
}

/* =======================
   ITEMS: WHAT SEARCH ENGINES GET
======================= */

// An item page is shown when the item has a price and the bots trade it (status 1 or 2) or hold copies of it
// (routes/router.js find_page_item). It belongs in search results, and in the sitemap, only when the bots really
// trade the item:
//   - it is in stock, or
//   - the bots buy it (status 1) and it is a basic variant, not an unusual effect combination.
// Unusual effect combinations count only while one is in stock: there are thousands of them, and without stock
// their pages are the same text with another effect name. The other item pages still work, with `noindex`.
// SITEMAP_ITEMS_QUERY is the same rule for the database (shown page + this rule); keep the two the same.
const item_in_stock = (item) => Number(item?.stock?.cur) > 0 || (Array.isArray(item?.stock?.items) && item.stock.items.length > 0)
const item_indexable = (item, in_stock = item_in_stock(item)) => Boolean(item) &&
  Number(item.buy) > 0 && Number(item.sell) > 0 &&
  (Boolean(in_stock) || (Number(item.status) === 1 && !(Number(item.effectID) > 0)))

const SITEMAP_ITEMS_QUERY = {
  buy: { $gt: 0 },
  sell: { $gt: 0 },
  $and: [
    { $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }] }, // the page is shown
    { $or: [{ 'stock.cur': { $gt: 0 } }, { 'stock.items.0': { $exists: true } }, { status: 1, effectID: { $not: { $gt: 0 } } }] }
  ]
}

// TF2 quality names (item words stay English on every language version, like the item names)
const QUALITY_NAMES = { 0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made', 11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated Weapon' }
const quality_name = (qualityID) => QUALITY_NAMES[qualityID] || ''

// Alt text of an item picture: the item's full name (it already holds the unusual effect, killstreak, wear, ...), plus
// the quality when the name doesn't say it: "Burning Flames Team Captain (Unusual)". Unique, the default quality,
// isn't named, as in TF2. The same rule is item_alt in public/js/plugins/trade.js.
const item_alt = (item) => {
  const name = String(item?.bp_sku || item?.name || '')
  const quality = quality_name(item?.qualityID)
  return (quality && quality !== 'Unique' && !name.includes(quality.replace(' Weapon', ''))) ? `${name} (${quality})` : name
}

// item type -> translation key under item_types (the same list as itemAttr.Types in partials/head.ejs)
const TYPE_KEYS = {
  'cosmetic': 'cosmetic', 'taunt': 'taunt', 'action': 'action', 'crate': 'crate', 'tool': 'tool',
  'weapon primary': 'primary_weapon', 'weapon secondary': 'secondary_weapon', 'weapon melee': 'melee_weapon',
  'weapon pda': 'pda_weapon', 'weapon pda2': 'pda2_weapon', 'weapon building': 'building_weapon',
  'australium weapon primary': 'primary_weapon', 'australium weapon secondary': 'secondary_weapon', 'australium weapon melee': 'melee_weapon',
  'weapon primary skin': 'primary_weapon_skin', 'weapon secondary skin': 'secondary_weapon_skin', 'weapon melee skin': 'melee_weapon_skin',
  'weapon primary skin warpaint': 'primary_weapon_skin', 'weapon secondary skin warpaint': 'secondary_weapon_skin', 'weapon melee skin warpaint': 'melee_weapon_skin',
  'warpaint': 'war_paint', 'tool unusualifier': 'unusualifier', 'tool strangifier': 'strangifier', 'tool key': 'key',
  'tool strange filter': 'strange_filter', 'tool strange part': 'strange_part', 'tool paint': 'paint', 'tool kit': 'kit'
}
// "weapon primary" -> "Primary Weapon" in the page language; an unknown type is shown as it is
const item_type_text = (type, __) => TYPE_KEYS[String(type || '').toLowerCase()] ? __('item_types.' + TYPE_KEYS[String(type).toLowerCase()]) : String(type || '')

const CLASSES = ['Scout', 'Soldier', 'Pyro', 'Demoman', 'Heavy', 'Engineer', 'Medic', 'Sniper', 'Spy']
// ['Soldier'] -> ['Soldier'] in the page language; all nine -> ['All classes']
const class_names = (classes, __) => {
  const list = (Array.isArray(classes) ? classes : String(classes || '').split(',')).map((c) => String(c).trim()).filter(Boolean)
  if (list.length === CLASSES.length) return [__('classes.all')]
  return list.map((c) => CLASSES.includes(c) ? __('classes.' + c.toLowerCase()) : c)
}

// Price as the item pages and the item list show it: "2 key 10.33 ref" or "10.33 ref" (public/js/plugins/items.js)
const list_price_text = (ref, key_price) => {
  const key = Number(key_price) || 0
  const value = Number(ref) || 0
  let keys = key > 0 ? Math.floor(value / key) : 0
  let metal = Number(round_ref(value - keys * key).toFixed(2))
  if (key > 0 && metal >= key) { metal = Number(round_ref(metal - key).toFixed(2)); keys++ }
  return keys > 0 ? `${keys} key ${metal} ref` : `${metal} ref`
}

// The item page's price history, newest first: one row per day (the newest entry of the day), and only when the
// price changed since the row before (the same rows public/js used to build). Entries are "buy|sell|key|time".
const price_history_rows = (history, limit = 30) => {
  const text = (ref, key) => (key > 0 && ref / key >= 1) ? `${(ref / key).toFixed(2)} keys` : `${Number(round_ref(ref).toFixed(2))} ref`
  const rows = []
  let last = null
  for (const entry of [...(Array.isArray(history) ? history : [])].reverse()) {
    const [buy, sell, key, time] = String(entry).split('|').map(Number)
    if (!(time > 0) || !Number.isFinite(buy) || !Number.isFinite(sell)) continue
    const row = { buy: text(buy, key), sell: text(sell, key), time, day: new Date(time).toISOString().slice(0, 10) }
    if (last && (last.day === row.day || (last.buy === row.buy && last.sell === row.sell))) continue
    rows.push(row)
    last = row
    if (rows.length >= limit) break
  }
  return rows
}

/* =======================
   DB / FILE OPS
======================= */

const ITEM_NAMES_FILE_SIZE = 22500 // names per file in src/api/data

// Item names for the search suggestions (/api/item_names): every active item. The sitemaps are built on request
// (service/sitemap.js).
const update_item_names = async () => {
  try {
    const active = await Items.find({ status: { $in: [1, 2] } }, { _id: 0, bp_sku: 1 }).lean()
    const names = active.map((item) => item.bp_sku)
    for (let n = 0; n * ITEM_NAMES_FILE_SIZE < names.length; n++) {
      fs.writeFileSync(path.join(process.cwd(), `/src/api/data/item_names${n + 1}.txt`), names.slice(n * ITEM_NAMES_FILE_SIZE, (n + 1) * ITEM_NAMES_FILE_SIZE).join(','))
    }
  } catch (error) {
    console.log('Item names update failed:', error?.message || error)
  }
}

/* =======================
   TEXT (blog / tickets)
======================= */

const escape_html = (text) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const safe_url = (url) => /^(https?:\/\/|\/)[^\s"'<>]*$/i.test(url) ? url : '#'

// Small markdown subset for blog posts. Everything is HTML-escaped first, so posts can't inject HTML.
//   # / ## / ### headings, - lists, > quotes, **bold**, *italic*, `code`, [link](url), ![image](url)
const render_markdown = (md) => {
  const inline = (text) => escape_html(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => `<img src="${safe_url(url)}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => url.startsWith('/')
      ? `<a href="${safe_url(url)}">${label}</a>` // own pages: normal link, so search engines follow it
      : `<a href="${safe_url(url)}" target="_blank" rel="noopener">${label}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')

  return String(md || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) return ''

    const heading = lines[0].match(/^(#{1,3})\s+(.*)$/)
    if (heading && lines.length === 1) {
      const level = heading[1].length + 1 // # -> h2 (the post title is the h1)
      return `<h${level}>${inline(heading[2])}</h${level}>`
    }
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
    }
    if (lines.every((line) => /^>\s?/.test(line))) {
      return `<blockquote>${lines.map((line) => inline(line.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`
  }).join('\n')
}

// "2 keys 10.33 ref" from a price in refined metal
const price_text = (ref, key_price) => {
  if (typeof ref !== 'number' || !(ref > 0)) return ''
  if (!(key_price > 0)) return `${Number(round_ref(ref).toFixed(2))} ref`
  let keys = Math.floor(ref / key_price)
  let metal = Number(round_ref(ref - keys * key_price).toFixed(2))
  if (metal >= key_price) { metal = Number((metal - key_price).toFixed(2)); keys++ }
  if (keys === 0) return `${metal} ref`
  return `${keys} ${keys === 1 ? 'key' : 'keys'}${metal > 0 ? ` ${metal} ref` : ''}`
}

// Meta description for an item page: real prices and stock, so every item page has its own text.
// `__` translates (req.__ for the page language); prices stay in keys/ref.
const item_description = (item, __ = t_for(DEFAULT_LANG)) => {
  const name = item.bp_sku
  const key = Number(item.bptf_data?.update_key_price) || 0
  const buy = price_text(item.sell, key)  // the visitor buys from us at our sell price
  const sell = price_text(item.buy, key)  // ... and sells to us at our buy price
  const stock = item.stock?.cur || 0

  const first = (buy && sell) ? __('desc.item_buy_sell', { name, buy, sell })
    : buy ? __('desc.item_buy', { name, buy })
    : sell ? __('desc.item_sell', { name, sell })
    : __('desc.item_trade', { name })
  return first + ' ' + (stock > 0 ? __('desc.item_stock', { count: stock }) : __('desc.item_no_stock'))
}

// The home page FAQ (views/home.ejs: the same questions, in the same order) as schema.org FAQPage, in the page language
const HOME_FAQ = [['how_q', 'how_a'], ['limits_q', 'limits_a'], ['pure_q', 'pure_a_html'], ['money_q', 'money_a_html'],
  ['deposits_q', 'deposits_a_html'], ['refunds_q', 'refunds_a_html'], ['legit_q', 'legit_a_html'], ['owner_q', 'owner_a']]
const plain_text = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?。，；：！？])/g, '$1').trim()
const faq_json_ld = (__) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOME_FAQ.map(([q, a]) => ({
    '@type': 'Question',
    name: plain_text(__('faq.' + q)),
    acceptedAnswer: { '@type': 'Answer', text: plain_text(__('faq.' + a, { link: '' })) } // {link}: the [1] source link in the page
  }))
})

// Plain-text start of a markdown post (for the meta description when a post has no excerpt)
const markdown_excerpt = (md, length = 155) => {
  const text = String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links -> their label
    .replace(/^\s*(#{1,3}|[-*]|>)\s+/gm, '')  // headings, list bullets, quotes
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > length ? text.slice(0, length - 1).replace(/\s+\S*$/, '') + '…' : text
}

const slugify = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)

/* =======================
   EXPORTS
======================= */

export {
  res_data,
  user_cookie,
  trade_offer_obj,
  round_ref,
  setup_cache,
  item_check,
  update_item_names,
  socketCallback,
  escape_html,
  render_markdown,
  slugify,
  site_url,
  clean_path,
  canonical_url,
  price_text,
  item_description,
  markdown_excerpt,
  item_in_stock,
  item_indexable,
  SITEMAP_ITEMS_QUERY,
  quality_name,
  item_alt,
  faq_json_ld,
  item_type_text,
  class_names,
  list_price_text,
  price_history_rows
}
