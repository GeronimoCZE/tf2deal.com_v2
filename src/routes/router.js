import * as fn from '../fn.js'

import apicache from 'apicache'
import mongoose from 'mongoose'
import crypto from 'crypto'
import * as app from '../app.js'

import { item_model } from '../model/Item.js'
import { blog_model } from '../model/Blog.js'
import { giveaway_model } from '../model/Giveaway.js'
import * as translate from '../service/translate.js'
import * as stats from '../service/stats.js'
import * as buy from '../service/buy_link.js'
import { localize_path, LANG_TAGS } from '../i18n.js'
import { isNumberObject } from 'util/types'

const cache = apicache.middleware

const home = async (req, res, next) => {
  if(req.path == '/'){
    const fp_data = app.fp_data;
    const trades_today = await stats.trades_today(fp_data.trades);

    if (req.user) {   
      const user_cookie = req.cookies[`td_${req.user.steamid}`]
      res.render('home', fn.res_data(true, req.user, user_cookie, 'Home', { view: 'home', stats: {items: fp_data.items, trades: trades_today, bots: fp_data.bots.length || 0, users: app.users.size} }))
    } else {
      res.render('home', fn.res_data(false, req.user, undefined, 'Home', { view: 'home', stats: {items: fp_data.items, trades: trades_today, bots: fp_data.bots.length || 0, users: app.users.size} }))
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

  res.render('home', fn.res_data(!!req.user, req.user, user_cookie, one ? req.__('title.item', { name: one.name }) : 'Home', {
    view: 'home',
    ...seo,
    key_price: app.key_price,
    create_trade: { assetid, copies: copies.map(({ image_large, ...copy }) => copy) },
    stats: { items: app.fp_data.items, trades: await stats.trades_today(app.fp_data.trades), bots: app.fp_data.bots.length || 0, users: app.users.size }
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

const items = (req, res) => {
  const item_count = app.item_count

  if (req.user) {
    const user_cookie = req.cookies[`td_${req.user.steamid}`]

    res.render(
      'items',
      fn.res_data(true, req.user, user_cookie, req.__('title.items'), {
        view: 'items',
        promtLogin: true,
        description: req.__('desc.items'),
        item_count
      })
    )
  } else {
    res.render(
      'items',
      fn.res_data(false, req.user, undefined, req.__('title.items'), {
        view: 'items',
        promtLogin: true,
        description: req.__('desc.items'),
        item_count
      })
    )
  }
}

async function getSimilarGroups(bpSkuValue) {
  // Reusable condition: status is 1 or 2, OR stock.items has at least one item (any status)
  const statusOrStock = {
    $or: [
      { status: 1 },
      { status: 2 },
      { $expr: { $gt: [{ $size: { $ifNull: ["$stock.items", []] } }, 0] } }
    ]
  };

  const main = await item_model.findOne({
    $and: [
      statusOrStock,
      { bp_sku: bpSkuValue },
      { buy: { $gt: 0 } },
      { sell: { $gt: 0 } }
    ]
  }).select('-stock.items').lean();

  // Fallback #1 — main item missing
  if (!main) {
    return {
      sameName: [],
      sameEffect: [],
      sameTypeQuality: []
    };
  }

  const result = await item_model.aggregate([
    { $match: { bp_sku: bpSkuValue } },
    {
      $lookup: {
        from: "item_instances",
        let: {
          mainSku: "$bp_sku",
          mainName: "$name",
          mainType: "$type",
          mainQuality: "$qualityID",
          mainEffect: "$effectID",
          mainClasses: "$classes"
        },
        pipeline: [
          {
            $facet: {
              sameName: [
                {
                  $match: {
                    $and: [
                      statusOrStock,
                      { sell: { $gt: 0 } },
                      { buy: { $gt: 0 } },
                      { "stock.cur": { $gt: 0 } },
                      {
                        $expr: {
                          $and: [
                            { $ne: ["$bp_sku", "$$mainSku"] },
                            { $eq: ["$name", "$$mainName"] }
                          ]
                        }
                      }
                    ]
                  }
                },
                {
                  $addFields: {
                    sharedCount: {
                      $size: { $setIntersection: ["$classes", "$$mainClasses"] }
                    }
                  }
                },
                {
                  $project: {
                    _id: 0,
                    bp_sku: 1,
                    name: 1,
                    image: 1,
                    type: 1,
                    qualityID: 1,
                    effectID: 1,
                    sell: 1,
                    "stock.cur": 1,
                    "bptf_data.update_key_price": 1,
                    sharedCount: 1
                  }
                },
                { $sort: { sharedCount: -1 } },
                { $limit: 10 }
              ],

              sameEffect: [
                {
                  $match: {
                    $and: [
                      statusOrStock,
                      { sell: { $gt: 0 } },
                      { buy: { $gt: 0 } },
                      { "stock.cur": { $gt: 0 } },
                      {
                        $expr: {
                          $and: [
                            { $gt: ["$$mainEffect", 0] },
                            { $ne: ["$bp_sku", "$$mainSku"] },
                            { $eq: ["$effectID", "$$mainEffect"] }
                          ]
                        }
                      }
                    ]
                  }
                },
                {
                  $addFields: {
                    sharedCount: {
                      $size: { $setIntersection: ["$classes", "$$mainClasses"] }
                    }
                  }
                },
                {
                  $project: {
                    _id: 0,
                    bp_sku: 1,
                    name: 1,
                    image: 1,
                    type: 1,
                    qualityID: 1,
                    effectID: 1,
                    sell: 1,
                    "stock.cur": 1,
                    "bptf_data.update_key_price": 1,
                    sharedCount: 1
                  }
                },
                { $sort: { sharedCount: -1 } },
                { $limit: 10 }
              ],
              sameTypeQuality: [
                {
                  $match: {
                    $and: [
                      statusOrStock,
                      { sell: { $gt: 0 } },
                      { buy: { $gt: 0 } },
                      { "stock.cur": { $gt: 0 } },
                      {
                        $expr: {
                          $and: [
                            { $ne: ["$name", "$$mainName"] },
                            { $eq: ["$type", "$$mainType"] },
                            { $eq: ["$qualityID", "$$mainQuality"] }
                          ]
                        }
                      }
                    ]
                  }
                },
                {
                  $addFields: {
                    sharedCount: {
                      $size: { $setIntersection: ["$classes", "$$mainClasses"] }
                    }
                  }
                },

                {
                  $group: {
                    _id: "$name",
                    doc: { $first: "$$ROOT" }
                  }
                },

                { $replaceRoot: { newRoot: "$doc" } },

                {
                  $project: {
                    _id: 0,
                    bp_sku: 1,
                    name: 1,
                    image: 1,
                    type: 1,
                    qualityID: 1,
                    effectID: 1,
                    sell: 1,
                    "stock.cur": 1,
                    "bptf_data.update_key_price": 1,
                    sharedCount: 1
                  }
                },

                { $sort: { sharedCount: -1 } },
                { $limit: 10 }
              ]
            }
          }
        ],
        as: "groups"
      }
    },
    { $replaceRoot: { newRoot: { $first: "$groups" } } }
  ]);

  // Fallback #2 — aggregation returns nothing (rare)
  return (
    Object.assign({ main: main }, result[0]) || {
      main: main,
      sameName: [],
      sameEffect: [],
      sameTypeQuality: []
    }
  );
}

const item_page = async (req, res) => {
  if (process.db_status.connected !== true) {
    res.status(500).render(
      'error',
      fn.res_data(false, req.user, undefined, req.__('title.items'), {
        promtLogin: true,
        error: "We couldn't contact our database."
      })
    )
    return
  }

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

    const result = await getSimilarGroups(item_sku)    
    const main = result.main;
    delete result.main;

    const user_cookie = req.user ? req.cookies[`td_${req.user.steamid}`] : undefined

    if (!main) {
      return res.status(404).render('404', fn.res_data(!!req.user, req.user, user_cookie, req.__('title.not_found')))
    }

    
    const item_path = `/items/${encodeURIComponent(main.bp_sku)}`
    const item_url = fn.site_url + req.lurl(item_path)

    res.render(
      'item_page',
      fn.res_data(!!req.user, req.user, user_cookie, req.__('title.item', { name: main.bp_sku }), {
        view: 'item_page',
        promtLogin: true,
        item: main,
        result: result,
        key_price: app.key_price,
        // SEO
        description: fn.item_description(main, req.__),
        path: item_path,
        image: main.image_large || main.image,
        json_ld: {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: req.__('footer.home'), item: fn.site_url + req.lurl('/') },
            { '@type': 'ListItem', position: 2, name: req.__('nav.items'), item: fn.site_url + req.lurl('/items') },
            { '@type': 'ListItem', position: 3, name: main.bp_sku, item: item_url }
          ]
        }
      })
    )
  } catch (err) {
    res.status(500).render(
      'error',
      fn.res_data(!!req.user, req.user, undefined, req.__('title.items'), {
        promtLogin: true,
        error: "We couldn't contact our database."
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
      fn.res_data(!!req.user, req.user, user_cookie, req.__('title.blog'), {
        view: 'blog',
        promtLogin: true,
        description: req.__('desc.blog'),
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
        promtLogin: true,
        // SEO: excerpt, or the start of the post when there's no excerpt
        description: shown.excerpt || fn.markdown_excerpt(shown.content),
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
        html: fn.render_markdown(shown.content)
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