import fs from 'fs'
import path from 'path'
import SteamID from 'steamid'
import * as app from './app.js'
import {item_model as Items} from '../src/model/Item.js'
import { blog_model } from './model/Blog.js'
import { localize_path, LANGS, DEFAULT_LANG, t_for } from './i18n.js'
import { available_langs } from './service/translate.js'
import { bot_socket } from './service/socket.js'
import * as settings from './service/settings.js'
import * as season from './service/season.js'
import { url } from 'inspector'

/* =======================
   CORE HELPERS
======================= */

// Public address of the site: used for canonical URLs, social tags and the sitemaps.
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
   DB / FILE OPS
======================= */

const update_sitemap = async () => {
  try {
    const baseUrl = `${site_url}/items/`

  const writeURLs = (itemNames, iteration) =>
    new Promise((resolve, reject) => {     

      const sitemapPath = path.join(process.cwd(), `/src/public/sitemaps/sitemap_${iteration}.txt`)

      const api_path = path.join(process.cwd(), `/src/api/data/item_names${iteration}.txt`)
      
      fs.writeFile(api_path, itemNames.map(name => name).join(','), (err) => {
        
        if (err) return reject(err)

        fs.writeFile(sitemapPath, '', (err) => {
          if (err) return reject(err)
  
          fs.writeFile(sitemapPath, itemNames.map(name => `${baseUrl}${encodeURIComponent(name)}`).join('\n'), (err) => {
            if (err) return reject(err)
            // the same items in every other language: sitemap_de_1.txt, ...
            try {
              for (const lang of LANGS.filter(l => l !== DEFAULT_LANG)) {
                fs.writeFileSync(
                  path.join(process.cwd(), `/src/public/sitemaps/sitemap_${lang}_${iteration}.txt`),
                  itemNames.map(name => `${site_url}${localize_path(lang, '/items/' + encodeURIComponent(name))}`).join('\n')
                )
              }
              resolve()
            } catch (e) { reject(e) }
          })
        })
      })
    })

    const limit = 22500;
    let skip = 0;
    let i = 1;
    let last_file = 0; // number of the last item sitemap written

    while(typeof i === "number"){
      console.log(i);
      
      await Items.find({ status: [1,2] }, { bp_sku: 1 }).lean().limit(limit).skip(skip)
        .then(async d => 
          await writeURLs(d.map(i => i.bp_sku), i).then(() => {
            last_file = i;
            if(d.length < limit){
              i = false;
              return;
            }
            skip += limit;
            i++;
          }).catch((e) => {  
            console.log(e);
          
            i = false;
          })
        )
        .catch((e) => {
          console.log(e);
          
          i = false;
        })
    }

    // remove item sitemaps left over from a run that had more items (they would list old URLs)
    if (last_file > 0) {
      for (const file of fs.readdirSync(path.join(process.cwd(), '/src/public/sitemaps'))) {
        const n = Number(file.match(/^sitemap_(?:[a-z]{2}_)?(\d+)\.txt$/)?.[1])
        if (n > last_file) fs.unlinkSync(path.join(process.cwd(), '/src/public/sitemaps', file))
      }
    }

    // main pages in every language; documents that only exist in English once
    const pages = ['/', '/trade', '/items', '/giveaway', '/blog', '/about']
    const english_only = ['/terms-of-service', '/cookies']
    fs.writeFileSync(
      path.join(process.cwd(), '/src/public/sitemaps/index.txt'),
      [...LANGS.flatMap(lang => pages.map(p => site_url + localize_path(lang, p))), ...english_only.map(p => site_url + p)].join('\n')
    )

    // published blog posts, in every language they exist in (the original + AI translations, see service/translate.js)
    const posts = await blog_model.find({ published: true }, { slug: 1, lang: 1, source_hash: 1, translations: 1 }).lean()
    const blog_sitemap = path.join(process.cwd(), '/src/public/sitemaps/sitemap_blog.txt')
    if (posts.length > 0) {
      fs.writeFileSync(blog_sitemap, posts.flatMap(post => available_langs(post).map(lang => site_url + localize_path(lang, `/blog/${encodeURIComponent(post.slug)}`))).join('\n'))
    } else if (fs.existsSync(blog_sitemap)) {
      fs.unlinkSync(blog_sitemap) // an empty sitemap is reported as an error by Search Console
    }

    const sitemapDir = '/src/public/sitemaps';
    const sitemapsUrl = `${site_url}/sitemaps`;

    const files = fs.readdirSync(path.join(process.cwd(), sitemapDir))
      .filter(f => f.startsWith('sitemap_') && f.endsWith('.txt'));

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    xml += `  <sitemap>\n`;
    xml += `    <loc>${sitemapsUrl}/index.txt</loc>\n`;
    xml += `  </sitemap>\n`;

    for (const file of files) {
      xml += `  <sitemap>\n`;
      xml += `    <loc>${sitemapsUrl}/${file}</loc>\n`;
      xml += `  </sitemap>\n`;
    }

    xml += `</sitemapindex>`;

    fs.writeFileSync(path.join(process.cwd(), '/src/public/', 'sitemap.xml'), xml);
    console.log('Sitemaps generated sucessfully');
    
  } catch (error) {
    
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
  update_sitemap,
  socketCallback,
  escape_html,
  render_markdown,
  slugify,
  site_url,
  clean_path,
  canonical_url,
  price_text,
  item_description,
  markdown_excerpt
}
