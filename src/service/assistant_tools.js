// What the chat helper (service/assistant.js) can do: these four tools and nothing else. Each one reads public data
// only (what any visitor sees on /items, an item page, /keys or /giveaway), through the same functions the pages use,
// and hands the model a short list of named fields, never a whole database record:
//
//   search_items   find items the bots trade by name: prices, stock, whether the bots buy more, the item page
//   show_items     put 1 to 4 of them in the chat as item cards (picture, price, stock, link)
//   offer_trade    put a "Request trade" card in the chat for one copy from the bots' stock. It sends nothing: the
//                  visitor presses the card's button, which goes through the same /api/create_trade request as a
//                  direct buy link (/buy/<assetid>, docs/BUY_LINKS.md). That request checks everything again on its
//                  own (signed in, trade URL, trading on, still in stock, blacklist, banned accounts) and the bots
//                  send a Steam offer the visitor still accepts in Steam. A visitor who isn't signed in gets a card
//                  that asks them to sign in.
//   site_status    is trading on, are the bots connected, the key price, the running giveaway
//
// The firewall rules here:
//   - the list is frozen and run() only runs a name on it; anything else is answered "unknown tool" and counted
//   - every argument is checked again here (type, length, allowed values), whatever the model sent
//   - who the visitor is comes from the server's session (ctx.user), never from the model: no tool takes a steamid,
//     an account, an order or anything of another user
//   - no tool writes anything, reads an account, the admin settings, the bots' accounts or the server's secrets;
//     the admin's own account gets exactly the same tools
//   - nothing a person can type goes to the model: no custom item names or descriptions, no Steam names, no notes

import * as item_lists from './item_lists.js'
import * as buy_link from './buy_link.js'
import * as settings from './settings.js'
import * as key_bank from './key_bank.js'
import * as fn from '../fn.js'
import * as app from '../app.js'
import { bot_socket } from './socket.js'
import { text_arg } from './assistant_firewall.js'

const MAX_RESULTS = 8
const MAX_CARDS = 4
const SORTS = ['relevance', 'cheapest', 'priciest', 'popular']
const LIST_SORT = { relevance: 'default', cheapest: 'Price (asc)', priciest: 'Price (desc)', popular: 'Popular (desc)' }

export const DEFINITIONS = Object.freeze([
  {
    name: 'search_items',
    description: 'Search the Team Fortress 2 items that TF2Deal.com\'s bots buy and sell, by their English name. Words can be in any order and partial, e.g. "strange part kills", "team captain", "professional killstreak rocket launcher", "key". Returns up to 8 matching items with what the visitor pays to buy one from the bots, what the bots pay for one, the copies in stock and whether the bots buy more. Use it before saying anything about an item\'s price or stock.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Item name or part of it, in English (item names are the same in every language).' },
        in_stock_only: { type: 'boolean', description: 'true to list only items the bots have copies of right now (to buy), false for all items they trade.' },
        sort: { type: 'string', enum: SORTS, description: 'relevance (best name match first), cheapest, priciest or popular.' }
      },
      required: ['query', 'in_stock_only', 'sort'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'show_items',
    description: 'Show 1 to 4 items to the visitor as cards under your answer (picture, price, stock and a link to the item page). Use exact names from search_items results. The visitor sees the cards, so don\'t repeat every price in your text.',
    input_schema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Exact item names from search_items, at most 4.' }
      },
      required: ['names'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'offer_trade',
    description: 'Put a "Request trade" card for one item from the bots\' stock under your answer, so the visitor can buy it. Use it when the visitor wants to buy a specific item that search_items shows in stock. It does not send anything: the visitor presses the button on the card, then accepts the Steam trade offer the bot sends. One item per card; the cheapest copy in stock is offered. Visitors who are not signed in get a card asking them to sign in through Steam.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The exact item name from search_items.' }
      },
      required: ['name'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'site_status',
    description: 'What is happening on TF2Deal.com right now: whether trading is on or paused, whether the trade bots are connected, the key price in refined metal and the running giveaway.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true
  }
].map((tool) => Object.freeze(tool)))

const NAMES = new Set(DEFINITIONS.map((tool) => tool.name))

/* ========================= ITEMS ========================= */

const item_path = (name) => `/items/${encodeURIComponent(name)}`
const key_of = (card) => Number(card.key_price) || Number(app.key_price?.metal) || 0
const in_stock = (card) => Number(card.count) || 0
// the bots take more of it (a killstreak tier with its own limit counts its own copies), as the Can sell filter
const buying = (card) => Number(card.buy) > 0 && (card.ks > 0 && card.tier_limit !== null && card.tier_limit !== undefined
  ? card.count < card.tier_limit : card.total < card.limit)

// the cards whose name has every word of the query (the /items search)
const find_cards = async (query, sort = 'default') => {
  try {
    return await item_lists.cards({ name: query }, sort)
  } catch (error) {
    return null // the item list isn't read yet (service/item_lists.js status)
  }
}

// the one card with exactly this name (any case)
const exact_card = async (name) => {
  const wanted = String(name || '').toLowerCase()
  if (!wanted) return { card: null }
  const list = await find_cards(name)
  if (!list) return { unavailable: true }
  return { card: list.find((card) => String(card.bp_sku).toLowerCase() === wanted) || null, list }
}

// best name match first: the exact name, then names that start with the query, then names with it as a whole word
const relevance = (query) => {
  const q = query.toLowerCase()
  const word = new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i')
  const rank = (card) => {
    const name = String(card.bp_sku).toLowerCase()
    return name === q ? 0 : name.startsWith(q) ? 1 : word.test(name) ? 2 : 3
  }
  return (a, b) => rank(a) - rank(b) || in_stock(b) - in_stock(a) || String(a.bp_sku).length - String(b.bp_sku).length
}

const search_items = async (input) => {
  const query = text_arg(input?.query, 80)
  if (query.length < 2) return { error: 'query_too_short' }
  const sort = SORTS.includes(input?.sort) ? input.sort : 'relevance'
  let list = await find_cards(query, LIST_SORT[sort])
  if (!list) return { error: 'item_list_unavailable', note: 'The item list is loading. Suggest the Items page (/items) for now.' }
  list = list.filter((card) => !settings.is_blacklisted(card.base || card.bp_sku))
  if (input?.in_stock_only === true) list = list.filter((card) => in_stock(card) > 0)
  if (sort === 'relevance') list = [...list].sort(relevance(query))
  return {
    query,
    matches: list.length,
    items: list.slice(0, MAX_RESULTS).map((card) => {
      const key = key_of(card)
      const stock = in_stock(card)
      return {
        name: card.bp_sku,
        visitor_pays: stock > 0 ? fn.price_text(Number(card.sell), key) : null, // to buy one from the bots
        bots_pay: buying(card) ? fn.price_text(Number(card.buy), key) : null,   // when the visitor sells one
        in_stock: stock,
        bots_buy_more: buying(card),
        page: item_path(card.bp_sku)
      }
    })
  }
}

// what an item card in the chat shows (public/js/plugins/assistant.js draws it)
const item_card = (card) => {
  const key = key_of(card)
  const stock = in_stock(card)
  return {
    kind: 'item',
    name: card.bp_sku,
    image: typeof card.image == 'string' && /^https:\/\//.test(card.image) ? card.image : '',
    qualityID: String(card.qualityID ?? ''),
    effectID: Number(card.effectID) > 0 ? Number(card.effectID) : 0,
    price: stock > 0 ? fn.price_text(Number(card.sell), key) : '',
    bots_pay: buying(card) ? fn.price_text(Number(card.buy), key) : '',
    stock,
    href: item_path(card.bp_sku)
  }
}

const show_items = async (input, ctx) => {
  const names = (Array.isArray(input?.names) ? input.names : []).map((n) => text_arg(n, 160)).filter(Boolean)
  if (!names.length) return { error: 'no_names' }
  const shown = []
  const not_found = []
  for (const name of [...new Set(names)].slice(0, MAX_CARDS)) {
    const { card, unavailable } = await exact_card(name)
    if (unavailable) return { error: 'item_list_unavailable' }
    if (!card || settings.is_blacklisted(card.base || card.bp_sku)) { not_found.push(name); continue }
    ctx.cards = ctx.cards.filter((c) => !(c.kind === 'item' && c.name === card.bp_sku))
    if (ctx.cards.filter((c) => c.kind === 'item').length >= MAX_CARDS) break
    ctx.cards.push(item_card(card))
    shown.push(card.bp_sku)
  }
  return { shown, ...(not_found.length && { not_found, note: 'Use exact names from search_items.' }) }
}

/* ========================= TRADE CARD ========================= */

// The killstreak tiers a card stands for: a tier's own card only that tier; the item's card the item without a
// killstreak, and the tiers that have no card of their own (their copies count on the item's card, item_lists.js)
const tiers_for = (card, list) => {
  if (card.ks > 0) return [card.ks]
  const own = new Set(list.filter((c) => c.base === card.bp_sku && c.ks > 0).map((c) => c.ks))
  return [0, 1, 2, 3].filter((tier) => tier === 0 || !own.has(tier))
}

const offer_trade = async (input, ctx) => {
  const name = text_arg(input?.name, 160)
  if (!name) return { error: 'no_name' }
  const { card, list, unavailable } = await exact_card(name)
  if (unavailable) return { error: 'item_list_unavailable' }
  if (!card) return { error: 'not_found', note: 'Search first and use the exact name.' }
  const base = card.base || card.bp_sku
  if (settings.is_blacklisted(base)) return { error: 'not_traded', note: 'The bots don\'t trade this item right now.' }
  if (!settings.trading_enabled()) return { error: 'trading_paused', note: 'Trading is paused on the site right now; it comes back soon.' }
  if (in_stock(card) === 0) return { error: 'not_in_stock', bots_buy_more: buying(card), page: item_path(card.bp_sku) }

  const copies = await buy_link.copies_of(base, tiers_for(card, list)).catch(() => [])
  if (!copies.length) return { error: 'not_in_stock', page: item_path(card.bp_sku) }
  const copy = copies[0]
  // 0.055 ref on its own is half a scrap, which keys and metal can't pay (docs/HALF_SCRAP.md)
  if (copy.sell > 0 && copy.sell < 0.11) {
    return { error: 'half_scrap', note: 'Copies worth half a scrap can only be bought on the Trade page (/trade) together with another item of the same price.' }
  }

  ctx.cards = ctx.cards.filter((c) => c.kind !== 'trade') // one trade card per answer: the latest
  ctx.cards.push({
    kind: 'trade',
    sign_in: !ctx.user,
    name: copy.name,
    image: typeof copy.image == 'string' && /^https:\/\//.test(copy.image) ? copy.image : '',
    qualityID: String(copy.qualityID ?? ''),
    effectID: copy.effectID || 0,
    price: copy.price,
    details: copy.details, // paint, spells, parts, sheen, killstreaker: to the visitor, not to the model
    spells: copy.spells,
    parts: copy.parts,
    bot_name: copy.bot_name,
    copies: copies.length,
    href: item_path(card.bp_sku),
    // what /api/create_trade (single_item) looks the copy up by again
    ...(ctx.user && { assetid: copy.assetid, bot: copy.bot, bp_sku: copy.bp_sku })
  })
  return {
    shown: true,
    item: copy.name,
    price: copy.price,
    copies_in_stock: copies.length,
    ...(ctx.user
      ? { note: 'The card is under your answer. The visitor presses Request trade, then accepts the Steam offer. Nothing has been sent yet.' }
      : { note: 'The visitor is not signed in: the card asks them to sign in through Steam first.' })
  }
}

/* ========================= SITE STATUS ========================= */

const site_status = async () => {
  const bank = key_bank.current()
  const giveaway = app.giveaway || {}
  const prize = typeof giveaway.item?.bp_sku == 'string' ? text_arg(giveaway.item.bp_sku, 120) : ''
  return {
    trading: settings.trading_enabled() ? 'on' : 'paused',
    trade_bots_connected: Boolean(bot_socket.socket),
    site_bots_listed: Array.isArray(app.fp_data?.bots) ? app.fp_data.bots.length : 0,
    key_price_ref: Number(app.key_price?.metal) > 0 ? Number(Number(app.key_price.metal).toFixed(2)) : null,
    key_bank: bank && bank.enabled && bank.price && !bank.stale
      ? { visitor_pays_per_key_ref: bank.price.sell, bots_pay_per_key_ref: bank.price.buy, page: '/keys' }
      : { available: false, page: '/keys' },
    giveaway: giveaway.active
      ? { running: true, prize: prize || null, ends: Number(giveaway.end) > 0 ? new Date(Number(giveaway.end)).toISOString() : null, waiting_for_entries: Boolean(giveaway.waiting), page: '/giveaway' }
      : { running: false, page: '/giveaway' }
  }
}

const HANDLERS = Object.freeze({ search_items, show_items, offer_trade, site_status })

// Runs one tool the model asked for. Returns { result, error } where result is what goes back to the model.
// ctx = { user: { steamid } | null, cards: [] (the cards for this answer, filled in here) }
export const run = async (name, input, ctx) => {
  if (!NAMES.has(name) || typeof HANDLERS[name] != 'function') return { result: { error: 'unknown_tool' }, error: 'unknown_tool' }
  if (input === null || typeof input != 'object' || Array.isArray(input)) return { result: { error: 'bad_input' }, error: 'bad_input' }
  try {
    const result = await HANDLERS[name](input, ctx)
    return { result, error: result?.error === 'bad_input' ? 'bad_input' : null }
  } catch (error) {
    console.log(`Chat helper: tool ${name} failed:`, error?.message || error)
    return { result: { error: 'failed' }, error: null }
  }
}
