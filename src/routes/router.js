import * as fn from '../fn.js'

import mongoose from 'mongoose'
import crypto from 'crypto'
import * as app from '../app.js'

import { item_model } from '../model/Item.js'
import { blog_model } from '../model/Blog.js'
import { giveaway_model } from '../model/Giveaway.js'
import * as translate from '../service/translate.js'
import { bptf_link } from '../service/bptf_link.js'
import * as stats from '../service/stats.js'
import * as buy from '../service/buy_link.js'
import * as item_lists from '../service/item_lists.js'
import { localize_path, LANG_TAGS } from '../i18n.js'
import { isNumberObject } from 'util/types'


const home = async (req, res, next) => {
  if(req.path == '/'){
    const fp_data = app.fp_data;
    const [trades_today, trades_total, pure_keys] = await Promise.all([stats.trades_today(fp_data.trades), stats.trades_total(), stats.pure_keys()]);

    const json_ld = fn.faq_json_ld(req.__) // the FAQ at the bottom of the page

    if (req.user) {   
      const user_cookie = req.cookies[`td_${req.user.steamid}`]
      res.render('home', fn.res_data(true, req.user, user_cookie, 'Home', { view: 'home', json_ld, stats: {items: fp_data.items, trades: trades_today, trades_total, pure_keys, bots: fp_data.bots.length || 0, users: app.users.size} }))
    } else {
      res.render('home', fn.res_data(false, req.user, undefined, 'Home', { view: 'home', json_ld, stats: {items: fp_data.items, trades: trades_today, trades_total, pure_keys, bots: fp_data.bots.length || 0, users: app.users.size} }))
    }
  } else {
    next()
  }
}

// /buy/<assetid>: a direct buy link (service/buy_link.js). The home page opens with that item in a modal, or a
// picker when the assetid matches more than one item. Nothing is sent until the visitor confirms
// (js/plugins/buy_link.js), so opening a link can't start a trade by itself.
const buy_link = async (req, res) => {
  const assetid = buy.ASSETID.test(String(req.params.itemid || '')) ? String(req.params.itemid) : ''
  const copies = assetid ? await buy.find(assetid).catch(() => []) : []
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined

  // same trade hash as the /trade page (checked by /api/create_trade)
  if (req.user) {
    if (typeof req.user?.hash?.exp === 'number') {
      if (req.user.hash.exp > Date.now()) {
        req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
      }
    } else {
      req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
    }
  }

  // one item: the link preview (Discord, Steam chat) shows it
  const one = copies.length === 1 ? copies[0] : null
  const seo = one ? {
    description: one.price ? req.__('desc.item_buy', { name: one.name, buy: one.price }) : req.__('desc.item_trade', { name: one.name }),
    image: one.image_large
  } : {}

  res.render('home', fn.res_data(!!req.user, req.user, user_cookie, one ? fn.item_title(one.name, req.__) : 'Home', {
    view: 'home',
    ...seo,
    key_price: app.key_price,
    create_trade: { assetid, copies: copies.map(({ image_large, ...copy }) => copy) },
    stats: { items: app.fp_data.items, trades: await stats.trades_today(app.fp_data.trades), trades_total: await stats.trades_total(), pure_keys: await stats.pure_keys(), bots: app.fp_data.bots.length || 0, users: app.users.size }
  }))
}

const trade = (req, res) => {
  if (req.user) {
    if (typeof req.user?.hash?.exp === 'number') {
      if (req.user.hash.exp > Date.now()) {
        req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
      }
    } else {
      req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
    }

    const user_cookie = req.cookies[`td_${req.user.steamid}`]
    const user_timeout = undefined
    const key_price = app.key_price;

    if (user_timeout === undefined) {
      if (app.activeTrades.has(req.user.steamid)) {
        const tradeoffer = app.activeTrades.get(req.user.steamid)
        res.render(
          'trade_created',
          fn.res_data(true, req.user, user_cookie, req.__('title.trade_offer'), {
            promtLogin: true,
            view: 'trade_created',
            trade: tradeoffer,
            key_price: key_price
          })
        )
      } else {
        res.render(
          'trade',
          fn.res_data(true, req.user, user_cookie, req.__('title.trade'), {
            promtLogin: true,
            view: 'trade',
            description: req.__('desc.trade'),
            key_price: key_price
          })
        )
      }
    }
  } else {
    res.render(
      'trade',
      fn.res_data(false, req.user, undefined, req.__('title.trade'), {
        promtLogin: true,
        view: 'trade',
        description: req.__('desc.trade'),
        sessionID: 'Y_Y',
        key_price: app.key_price
      })
    )
  }
}

// /items, /items?page=2, ...: the item list as plain HTML pages (links to every listed item for visitors and search
// engines without JavaScript). public/js/plugins/items.js keeps loading the next items while scrolling, and replaces
// the list when filters are picked.
const ITEMS_PER_PAGE = 60 // a multiple of the 15 items /api/items sends per page, so both line up

const items = async (req, res, next) => {
  try {
    const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
    const query = new URLSearchParams(req.originalUrl.split('?')[1] || '')
    const page_param = query.get('page')
    const page = page_param === null ? 1 : (/^[1-9]\d{0,5}$/.test(page_param) ? Number(page_param) : 0)

    // ?page=1 and broken values: the address without them, so every page has one URL
    if (query.has('page') && (page < 2 || query.getAll('page').length > 1)) {
      query.delete('page')
      return res.redirect(301, req.lurl('/items') + (query.toString() ? '?' + query.toString() : ''))
    }

    // ?name= (the site search and the SearchAction in the page data): the matching items, also without JavaScript
    const name = String(query.get('name') || '').trim().slice(0, 100)

    let list = null
    try {
      if (process.db_status.connected === true) list = await item_lists.cards(name ? { name } : {})
    } catch (err) {
      console.error('Item list failed:', err?.message || err)
    }

    // no database: page 1 still works (the browser asks /api/items again), later pages say "try again later"
    if (!list && page > 1) return res.status(503).set('Retry-After', '120').render('error', fn.res_data(!!req.user, req.user, user_cookie, req.__('title.items'), { view: 'error' }))

    const all = list || []
    const pages = Math.max(1, Math.ceil(all.length / ITEMS_PER_PAGE))
    if (page > pages) return next() // the 404 page

    // the same cards as public/js/plugins/items.js builds from /api/items
    const cards = all.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(item_lists.public_card)
      .map((item) => ({
        bp_sku: item.bp_sku,
        name: item.name,
        image: item.image,
        qualityID: item.qualityID,
        effectID: Number(item.effectID) || 0,
        stock: item.stock.items_length,
        price: fn.list_price_text(item.sell, item.bptf_data.update_key_price)
      }))

    res.render(
      'items',
      fn.res_data(!!req.user, req.user, user_cookie, page > 1 ? req.__('title.items_page', { page }) : req.__('title.items'), {
        view: 'items',
        promtLogin: true,
        description: page > 1 ? req.__('desc.items_page', { page }) : req.__('desc.items'), // each page its own (Bing: identical descriptions)
        path: page > 1 ? `/items?page=${page}` : '/items', // canonical + hreflang: filters are left out, the page number stays
        noindex: Boolean(name), // search results are not search results of their own
        // the items on this page, for search engines and AI assistants (schema.org ItemList)
        json_ld: cards.length > 0 ? {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: req.__('title.items'),
          url: fn.site_url + req.lurl(page > 1 ? `/items?page=${page}` : '/items'),
          isPartOf: { '@id': fn.site_url + '/#website' },
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: all.length,
            itemListElement: cards.map((card, i) => ({
              '@type': 'ListItem',
              position: (page - 1) * ITEMS_PER_PAGE + i + 1,
              name: card.name,
              url: fn.site_url + req.lurl('/items/' + encodeURIComponent(card.bp_sku))
            }))
          }
        } : undefined,
        item_count: list ? all.length : null,
        list: list ? { cards, page, pages, per_page: ITEMS_PER_PAGE, name } : null
      })
    )
  } catch (err) {
    next(err)
  }
}

// The item a page shows: it has a price, and the bots trade it (status 1 or 2) or hold copies of it
const find_page_item = (bp_sku) => item_model.findOne({
  bp_sku: String(bp_sku),
  $or: [{ status: { $in: [1, 2] } }, { 'stock.items.0': { $exists: true } }],
  buy: { $gt: 0 },
  sell: { $gt: 0 }
}).select('-stock.items').lean()

const item_page = async (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined

  // 503 = "try again later": search engines come back instead of dropping the page
  const unavailable = () => res.status(503).set('Retry-After', '120').render(
    'error',
    fn.res_data(!!req.user, req.user, user_cookie, req.__('title.items'), {
      promtLogin: true,
      error: "We couldn't contact our database."
    })
  )

  if (process.db_status.connected !== true) return unavailable()

  try {
    const item_sku = req.params.item

    // same trade hash as the /trade page (checked by /api/create_trade)
    if (req.user) {
      if (typeof req.user?.hash?.exp === 'number') {
        if (req.user.hash.exp > Date.now()) {
          req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
        }
      } else {
        req.user.hash = { hex: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 12000 }
      }
    }

    let main = await find_page_item(item_sku)
    // "Professional Killstreak Rocket Launcher": a killstreak tier of the Rocket Launcher, when the item has it
    let ks = 0
    let tier = null      // the tier, prices in ref (item_lists.tiers_of)
    let ks_entry = null  // ... as the item stores it
    const ks_name = main ? null : item_lists.ks_page(item_sku)
    for (const base of ks_name?.bases || []) {
      const doc = await find_page_item(base)
      tier = doc ? item_lists.tiers_of(doc).get(ks_name.tier) || null : null
      if (tier) {
        main = doc
        ks = ks_name.tier
        ks_entry = tier.entry
        break
      }
    }

    if (!main) {
      // an item the bots traded before (still in the database, but discontinued: the daily sweep or item_manager took it
      // off): 410 Gone says it was removed on purpose, so search engines drop the page sooner than after a 404. The
      // sitemap only lists items traded now (service/sitemap.js).
      const known = await item_model.exists({ bp_sku: { $in: [String(item_sku), ...(ks_name?.bases || [])] } })
      return res.status(known ? 410 : 404).render('404', fn.res_data(!!req.user, req.user, user_cookie, req.__('title.not_found')))
    }
    // A weapon's killstreak tier is an item of its own (item_manager prices it from its own backpack.tf listings,
    // item_lists.ks_items): its own page, under its backpack.tf name. A skin's tier is a version of the skin: the skin's
    // page with that tier picked, pointed to the skin's page.
    const own_page = ks > 0 && item_lists.ks_items(main)
    const page_name = own_page ? buy.display_name(main.bp_sku, { ks }) : ks ? String(item_sku) : main.bp_sku
    // one address per tier: "Professional Killstreak Non-Craftable Rocket Launcher" -> "Non-Craftable Professional ..."
    if (own_page && page_name !== String(item_sku)) {
      return res.redirect(301, req.lurl(`/items/${encodeURIComponent(page_name)}`))
    }

    // stock.items isn't loaded (it can be long): look only when the stock count doesn't already say so
    const in_stock = fn.item_in_stock(main) || ![1, 2].includes(Number(main.status)) ||
      Boolean(await item_model.exists({ _id: main._id, 'stock.items.0': { $exists: true } }))
    // similar items, with their price as text
    const result = Object.fromEntries(Object.entries(await item_lists.similar(main)).map(([group, list]) =>
      [group, list.map((item) => ({ ...item, price: fn.list_price_text(item.sell, item.bptf_data?.update_key_price) }))]))
    const item_path = `/items/${encodeURIComponent(main.bp_sku)}`
    const item_url = fn.site_url + req.lurl(item_path)
    // a skin's killstreak tier page is the skin's page with that tier picked, so search engines are pointed to the skin's
    const page_path = ks ? `/items/${encodeURIComponent(page_name)}` : item_path
    const page_url = own_page ? fn.site_url + req.lurl(page_path) : item_url
    const key_price = Number(main.bptf_data?.update_key_price) || 0
    const stock = { cur: Number(main.stock?.cur) || 0, limit: Number(main.stock?.limit) || 0 }
    // its pictures as full addresses (structured data needs them; a stored "ms/..." short form is left out)
    const images = [...new Set([main.image_large, main.image].map((url) => /^https?:\/\//.test(url || '') ? url : /^\/[^/]/.test(url || '') ? fn.site_url + url : null).filter(Boolean))]
    // the item's data as text, so the page shows it before (and without) the page scripts
    // on a killstreak tier's page: that tier's prices and stock, as public/js/main.js show_tier sets them
    const tier_stock = ks_entry?.stock && typeof ks_entry.stock == 'object' ? ks_entry.stock : (ks_entry?.stock !== undefined ? { cur: ks_entry?.stock } : null)
    const shown_stock = tier_stock ? { cur: Number(tier_stock.cur) || 0, limit: Number(ks_entry.limit ?? tier_stock.limit ?? stock.limit) || 0 } : stock
    // a tier's price, never under the clean item's (as public/js/plugins/trade.js copy_price)
    const page_sell = Math.max(tier?.sell || 0, Number(main.sell) || 0)
    const page_buy = Math.max(tier?.buy || 0, Number(main.buy) || 0)
    const shown = {
      quality: fn.quality_name(main.qualityID),
      type: fn.item_type_text(main.type, req.__),
      classes: fn.class_names(main.classes, req.__),
      buy_price: fn.list_price_text(page_sell, key_price), // the visitor buys at our sell price
      sell_price: fn.list_price_text(page_buy, key_price), // ... and sells to us at our buy price
      stock: shown_stock.cur,
      can_sell: Math.max(shown_stock.limit - shown_stock.cur, 0),
      // a tier priced from its own listings has its own history ("buy|sell|key|time", as the item's)
      price_history: fn.price_history_rows(own_page ? ks_entry?.price_history : main.price_history)
    }
    // the item's TF2 collection (item_manager writes item_collection) and the collection's other items, this one
    // shown as the page shows it. A war-painted weapon is in its war paint's collection; the list has the war paint.
    const collection_name = typeof main.item_collection === 'string' ? main.item_collection.trim() : ''
    let collection = null
    if (collection_name) {
      const war_painted = /warpaint skin/i.test(String(main.type || ''))
      const own_row = { bp_sku: page_name, name: main.name, image: main.image, qualityID: main.qualityID, effectID: main.effectID, grade: item_lists.grade_of(main.grade), price: shown.buy_price, stock: shown.stock, current: true }
      let found = false
      const items = (await item_lists.collection(collection_name)).slice(0, 80).map((entry) => {
        if (!war_painted && entry.name === main.name) { found = true; return { ...own_row, grade: own_row.grade || entry.grade } }
        return { ...entry, price: fn.list_price_text(entry.sell, entry.key_price), current: false }
      })
      // the war paint of a war-painted weapon (the longest paint name its name starts with: "... Mk.II")
      if (war_painted) {
        const paint = items.filter((row) => / War Paint$/.test(row.name) && String(main.name).startsWith(row.name.slice(0, -' War Paint'.length) + ' '))
          .sort((a, b) => b.name.length - a.name.length)[0]
        if (paint) paint.paint_of_item = true
      } else if (items.length > 0 && !found) {
        items.push(own_row) // not in the list (yet): still one of the collection
        items.sort(item_lists.collection_order)
      }
      collection = { name: collection_name, items }
    }
    // what the page is about, for search engines: the tier with its own name, prices and stock
    const page_item = own_page ? { ...main, bp_sku: page_name, sell: page_sell, buy: page_buy, stock: { cur: shown_stock.cur } } : main
    const description = fn.item_description(page_item, req.__)
    // a tier's page is indexed as an item of its own (item_lists.tier_indexable): copies of it in stock, or bought
    const tier_in_stock = own_page && (shown_stock.cur > 0 || Boolean(await item_model.exists({ _id: main._id, 'stock.items.ks': ks })))
    const noindex = own_page ? !item_lists.tier_indexable(main, tier, tier_in_stock ? 1 : 0) : !fn.item_indexable(main, in_stock)

    res.render(
      'item_page',
      fn.res_data(!!req.user, req.user, user_cookie, fn.item_title(page_name, req.__), {
        view: 'item_page',
        promtLogin: true,
        item: main,
        ks_tier: ks,
        // the killstreak select opens each tier's own page (public/js/main.js)
        tier_pages: item_lists.ks_items(main) ? Object.fromEntries([...item_lists.tiers_of(main).keys()].map((t) => [t, buy.display_name(main.bp_sku, { ks: t })])) : null,
        page_name,
        result: result,
        key_price: app.key_price,
        shown,
        collection, // { name, items } or null (view/item_page.ejs)
        bptf_url: bptf_link(main, { ks }), // the backpack.tf button: that version's price page (a crate's series, a kit's weapon, ...)
        // SEO
        description,
        path: page_path,
        ...(ks && !own_page && { canonical: item_url, no_hreflang: true }),
        noindex, // only items the bots really trade (fn.item_indexable, item_lists.tier_indexable)
        image: main.image_large || main.image,
        json_ld: {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'BreadcrumbList',
              '@id': page_url + '#breadcrumb',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: req.__('footer.home'), item: fn.site_url + req.lurl('/') },
                { '@type': 'ListItem', position: 2, name: req.__('nav.items'), item: fn.site_url + req.lurl('/items') },
                { '@type': 'ListItem', position: 3, name: page_item.bp_sku, item: page_url }
              ]
            },
            {
              // The page and the item it is about. Not a schema.org Product with an Offer: Google takes a Product with
              // an Offer as something sold for money and needs its price in an ISO 4217 currency (USD, EUR, ...), which
              // a TF2 item traded for keys and refined metal doesn't have. Without one, Search Console marked every
              // item page "valid with issues" (Product snippets and Merchant listings: 1 invalid item). The prices
              // are in the page and in the description, in words.
              '@type': 'ItemPage',
              '@id': page_url + '#page',
              url: page_url,
              name: page_item.bp_sku,
              description,
              isPartOf: { '@id': fn.site_url + '/#website' },
              breadcrumb: { '@id': page_url + '#breadcrumb' },
              about: {
                '@type': 'Thing',
                '@id': page_url + '#item',
                name: page_item.bp_sku,
                url: page_url,
                image: images.length > 0 ? images : undefined,
                description,
                keywords: [shown.quality, shown.type, ...shown.classes].filter(Boolean).join(', ') || undefined
              }
            }
          ]
        }
      })
    )
  } catch (err) {
    console.error(`Item page ${req.originalUrl} failed:`, err?.message || err)
    // the database didn't answer: temporary. Anything else is a real error.
    if (process.db_status.connected !== true || /Mongo/.test(String(err?.name))) return unavailable()
    res.status(500).render(
      'error',
      fn.res_data(!!req.user, req.user, user_cookie, req.__('title.items'), {
        promtLogin: true,
        error: "We couldn't load this item."
      })
    )
  }
}

const giveaway = async (req, res, next) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined

  try {
    const current = await giveaway_model.findOne({ status: 'active' }).lean()
    const history = await giveaway_model.find({ status: 'ended' }, { entries: 0 }).sort({ end: -1 }).limit(12).lean()

    let entered = false
    if (current) {
      entered = Boolean(req.user) && current.entries.some((entry) => entry.steamid == req.user.steamid)
      current.entry_count = current.entries.length
      delete current.entries

      // AI-translated description (service/translate.js); the original until the translation is ready
      const shown = translate.localized(current, req.lang, translate.GIVEAWAY_FIELDS)
      if (!shown && current.description) translate.queue_giveaway(current._id)
      current.description_shown = shown ? shown.description : current.description
      current.description_lang = shown ? shown.lang : translate.source_lang(current)
      current.description_translated = Boolean(shown?.translated)
    }

    res.render(
      'giveaway',
      fn.res_data(!!req.user, req.user, user_cookie, req.__('title.giveaway'), {
        view: 'giveaway',
        promtLogin: true,
        description: current
          ? req.__('desc.giveaway_active', { item: current.item?.bp_sku })
          : req.__('desc.giveaway_none'),
        giveaway: current,
        entered,
        history
      })
    )
  } catch (err) {
    next(err)
  }
}

const BLOG_PAGE_SIZE = 12

const blog = async (req, res, next) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  const page = Math.max(0, parseInt(req.query.page) || 0)

  try {
    const posts = await blog_model.find({ published: true }, { content: 0 }).sort({ created: -1 }).skip(page * BLOG_PAGE_SIZE).limit(BLOG_PAGE_SIZE + 1).lean()

    // titles and excerpts in the page language when an AI translation is ready (service/translate.js)
    for (const post of posts) {
      const shown = translate.localized(post, req.lang, ['title', 'excerpt'])
      if (!shown) translate.queue_post(post._id)
      Object.assign(post, shown ? { title: shown.title, excerpt: shown.excerpt } : {}, { shown_lang: shown ? shown.lang : translate.source_lang(post) })
      delete post.translations
    }

    res.render(
      'blog',
      fn.res_data(!!req.user, req.user, user_cookie, page > 0 ? req.__('title.blog_page', { page: page + 1 }) : req.__('title.blog'), {
        view: 'blog',
        promtLogin: true,
        description: page > 0 ? req.__('desc.blog_page', { page: page + 1 }) : req.__('desc.blog'), // ?page=1 is the second page
        path: page > 0 ? `/blog?page=${page}` : '/blog',
        posts: posts.slice(0, BLOG_PAGE_SIZE),
        page,
        more: posts.length > BLOG_PAGE_SIZE
      })
    )
  } catch (err) {
    next(err)
  }
}

const blog_page = async (req, res, next) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  const is_admin = req.user?.steamid === process.env.ADMIN_STEAMID

  try {
    // the admin can open unpublished posts to check them before publishing
    const post = await blog_model.findOne(is_admin ? { slug: req.params.slug } : { slug: req.params.slug, published: true }).lean()

    if (!post) {
      return res.status(404).render('404', fn.res_data(!!req.user, req.user, user_cookie, req.__('title.not_found')))
    }

    // the post in the page language: the original, or its AI translation once it's ready (service/translate.js)
    const source = translate.source_lang(post)
    const translation = translate.localized(post, req.lang, translate.BLOG_FIELDS)
    if (!translation && post.published) translate.queue_post(post._id) // not translated (yet): translate it in the background
    // ?original=1: "Show original" on a translated page
    const shown = (req.query.original === undefined && translation) || translate.localized(post, source, translate.BLOG_FIELDS)

    // SEO: every language the post really exists in links to the others; a page without a translation points to the original
    const path = `/blog/${encodeURIComponent(post.slug)}`
    const url_in = (lang) => fn.site_url + localize_path(lang, path)
    const langs = translate.available_langs(post)
    const alternates = langs.length > 1
      ? [...langs.map((lang) => ({ hreflang: LANG_TAGS[lang], href: url_in(lang) })), { hreflang: 'x-default', href: url_in(langs.includes('en') ? 'en' : source) }]
      : null

    res.render(
      'blog_page',
      fn.res_data(!!req.user, req.user, user_cookie, `${shown.title} - TF2Deal.com Blog`, {
        view: 'blog_page',
        post_id: String(post._id), // the admin bar's Edit post link
        promtLogin: true,
        // SEO: excerpt, or the start of the post when there's no excerpt
        description: fn.markdown_excerpt(shown.excerpt || shown.content), // at most 155 characters, also a long excerpt
        canonical: url_in(shown.lang),
        alternates,
        no_hreflang: !alternates,
        image: post.cover || undefined,
        og_type: 'article',
        noindex: !post.published,
        json_ld: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: shown.title,
          description: shown.excerpt || undefined,
          inLanguage: LANG_TAGS[shown.lang],
          image: post.cover || undefined,
          datePublished: new Date(post.created).toISOString(),
          dateModified: new Date(post.updated || post.created).toISOString(),
          author: { '@type': 'Organization', name: 'TF2Deal.com', url: `${fn.site_url}/` },
          mainEntityOfPage: url_in(shown.lang)
        },
        post,
        shown, // { title, excerpt, content, lang, translated }
        source,
        translation_ready: Boolean(translation?.translated),
        original_url: req.lurl(path) + '?original=1',
        translation_url: req.lurl(path),
        html: fn.render_markdown(shown.content, shown.title)
      })
    )
  } catch (err) {
    next(err)
  }
}

const about = (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined

  res.render(
    'about',
    fn.res_data(!!req.user, req.user, user_cookie, req.__('title.about'), {
      view: 'about',
      description: req.__('desc.about'),
      bots: []
    })
  )
}

const terms_of_service = (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  res.render(
    'terms_of_service',
    fn.res_data(!!req.user, req.user, user_cookie, req.__('title.tos'), {
      view: 'tos',
      description: req.__('desc.tos'),
      // English-only document: one canonical URL, no language versions
      canonical: `${fn.site_url}/terms-of-service`,
      no_hreflang: true
    })
  )
}

const cookies = (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  res.render(
    'cookies',
    fn.res_data(!!req.user, req.user, user_cookie, req.__('title.cookies'), {
      view: 'cookies',
      description: req.__('desc.cookies'),
      // English-only document: one canonical URL, no language versions
      canonical: `${fn.site_url}/cookies`,
      no_hreflang: true
    })
  )
}

const updates = (req, res) => {
  // there is no "updates" view (this answered with an error page); news now lives on the blog
  res.redirect(301, req.lurl('/blog'))
}

const posts = (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  res.render('posts', fn.res_data(!!req.user, req.user, user_cookie, req.__('title.posts'), { view: 'posts', noindex: true }))
}

const create_ticket = (req, res) => {
  const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined
  res.render(
    'create_ticket',
    fn.res_data(!!req.user, req.user, user_cookie, req.__('title.support'), { view: 'create_ticket' })
  )
}

export {
  home,
  buy_link,
  trade,
  items,
  item_page,
  giveaway,
  blog,
  blog_page,
  about,
  updates,
  posts,
  terms_of_service,
  cookies,
  create_ticket
}