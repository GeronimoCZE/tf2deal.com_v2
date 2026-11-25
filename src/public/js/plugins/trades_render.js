import { round_ref, create_sku, group_assets, item_alt, copy_image, copy_marks, kit_pic } from './trade.js'
import { PAINT_COLORS, SHEEN_COLORS } from './item_colors.js'

// Renders finished trades (home page "Latest trades" and Profile -> Trades).
// Identical assets are stacked into one tile with a count, the same way the /trade page does it.
// Each side says whose it is (the trader's, or our bot's), and each tile carries its copy's details (data-copy: killstreak,
// festivized, and `at` with paint, spells, strange parts, killstreaker, sheen, custom name) for the tooltip
// (trade.js item_tooltip, parties 'show-user' / 'show-site'). The server adds those details (service/trade_records.js).
// Under the pictures each side also lists its items in words (item_lines): the name in its quality colour, as TF2 writes
// it, and what makes that copy special (unusual effect, sheen, killstreaker, paint, spells, strange parts), so a trade
// reads without hovering every tile.

const key_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ/330x192';
const ref_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO1Mv6NGucF1Ygzt8ZQijJukFMiMrbhYDEwI1yRVKNfD6xorQ3qW3Jr6546DNPuou9IOVK4p4kWJaA/330x192';
const img_cdn = 'https://community.cloudflare.steamstatic.com/economy/image/';

// trade records come from the bot server: escape everything before it goes into the HTML
const esc = (text) => String(text ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]))
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0

// what the tooltip needs of one copy, as JSON for the tile's data-copy
const copy_data = (copy) => {
    const at = (copy?.at && typeof copy.at == 'object') ? copy.at : null
    return JSON.stringify({ ks: num(copy?.ks), f: num(copy?.f), ...(at ? { at } : {}) })
}

// "5 minutes ago" in the page language (the browser knows the plural rules of every language)
const relative_time = new Intl.RelativeTimeFormat(window.TD_LANG || 'en', { numeric: 'always' });

function timeAgoTrade(timestamp) {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (!Number.isFinite(seconds)) return '';

    if (seconds < 60) return relative_time.format(-seconds, 'second');

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return relative_time.format(-minutes, 'minute');

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return relative_time.format(-hours, 'hour');

    const days = Math.floor(hours / 24);
    if (days < 30) return relative_time.format(-days, 'day');

    const months = Math.floor(days / 30);
    if (months < 12) return relative_time.format(-months, 'month');

    return relative_time.format(-Math.floor(months / 12), 'year');
}

const pure_tiles = (side) => {
    const tiles = []
    const keys = num(side?.keys)
    const metal = num(side?.ref) + num(side?.rec) / 3 + num(side?.scrap) / 9

    if(keys > 0){
        tiles.push(`<div class="pure keys" data-quality="Unique" data-type="Pure" data-count="${keys}" data-name="Mann Co. Supply Crate Key"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${img_cdn}${key_image}" alt="Mann Co. Supply Crate Key"><div class='pure-count'>${keys}</div></div>`)
    }
    if(metal > 0){
        const refs = round_ref(metal)
        tiles.push(`<div class="pure refs" data-quality="Unique" data-type="Pure" data-count="${refs}" data-name="Refined Metal"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${img_cdn}${ref_image}" alt="Refined Metal"><div class='pure-count'>${refs}</div></div>`)
    }
    return tiles
}

// pure on one side of a trade, in ref
const pure_ref = (side, key_value) => num(side?.keys) * num(key_value) + num(side?.ref) + num(side?.rec) / 3 + num(side?.scrap) / 9

// Each item in a trade record keeps the price it had when the trade was requested, but the bot prices the offer
// again when it sends it, so that price can be off (a taunt recorded at 84.44 ref that the bot paid 91.33 ref for).
// When only one side has items, the other side's pure minus this side's pure is what the items went for, so the
// recorded prices are scaled to add up to that. 1 (keep the recorded prices) when the trade doesn't tell.
const price_factor = (side, other, price_field, key_value) => {
    if(!(side?.items?.length > 0) || other?.items?.length > 0){ return 1 }
    if((num(side?.keys) > 0 || num(other?.keys) > 0) && !(num(key_value) > 0)){ return 1 }
    const recorded = side.items.reduce((sum, item) => sum + (item?.user_stock || []).reduce((s, asset) => s + num(asset?.[price_field] || item?.[price_field]), 0), 0)
    const paid = pure_ref(other, key_value) - pure_ref(side, key_value)
    return (recorded > 0 && paid > 0) ? paid / recorded : 1
}

// what one copy alone on its side went for, when that is all the side has and its price wasn't recorded
// (trades sent to the bots directly don't record prices, and we may not price the item)
const lone_paid = (side, other, key_value) => {
    const copies = (side?.items || []).reduce((n, item) => n + (item?.user_stock?.length || 0), 0)
    if(copies != 1 || other?.items?.length > 0){ return 0 }
    if((num(side?.keys) > 0 || num(other?.keys) > 0) && !(num(key_value) > 0)){ return 0 }
    return Math.max(0, pure_ref(other, key_value) - pure_ref(side, key_value))
}

// price_field: 'buy' for what the user gave us, 'sell' for what the user got
const item_tiles = (side, price_field, key_value, factor = 1, paid = 0) => {
    const tiles = []
    for (const item of (side?.items || [])) {
        const craftable = (item?.bp_sku?.includes('Non-Craftable')) ? "non-craftable" : "craftable"
        const image = item?.image?.startsWith('ms/') ? item.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/') : item?.image;

        for (const group of group_assets(item.user_stock).values()) {
            const rep = group[0]
            const count = group.length
            const recorded = rep?.[price_field] ? rep[price_field] : item?.[price_field]
            const price = (num(recorded) > 0) ? num(recorded) * factor : (paid > 0 ? round_ref(paid) : recorded)
            const badge = (count > 1) ? `<div class="stack-count">${count}</div>` : ""
            const picture = copy_image(rep, image) // a painted copy: its own picture

            // the tile opens the item's page; a killstreak copy its tier's page (a weapon's tiers are items of their own)
            const page = (Number(rep?.ks) > 0 && item?.bp_sku) ? create_sku(item.bp_sku, item.qualityID, 0, Number(rep.ks)) : (item?.bp_sku || '')
            tiles.push(`<a href="${esc(window.lurl('/items/' + encodeURIComponent(page)))}" class="item q-${esc(item?.qualityID)} ${craftable} ${count > 1 ? 'stacked' : ''}" data-assetids="${esc(group.map(a => a?.a).join(','))}" data-key="${esc(key_value)}" data-quality="${esc(item?.qualityID)}" data-effect="${esc(item?.effectID)}" data-name="${esc(item.bp_sku)}" data-bp_sku="${esc(create_sku(item.bp_sku, item.qualityID, rep?.f, rep?.ks))}" data-type="${esc(item?.type)}" data-price="${esc(price)}" data-tradable="1" data-copy="${esc(copy_data(rep))}" style="background-image: url('https://api.backpack.tf/images/440/particles/${num(item?.effectID)}_94x94.png')"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${esc(picture)}" alt="${item_alt(create_sku(item.bp_sku, item.qualityID, rep?.f, rep?.ks), item?.qualityID)}">${copy_marks(rep)}${kit_pic(item?.kit_image)}${badge}</a>`)
        }
    }
    return tiles
}

// ---- the items of one side in words ----
const MAX_LINES = 2   // item lines shown at once; the rest sit behind "+N more"
const MAX_CHIPS = 4   // details shown on a line; the rest are counted in a "+N" chip (its title names them)

const words = (value) => (Array.isArray(value) ? value : [value])
    .filter((v) => typeof v == 'string' && v.trim())
    .map((v) => v.trim().slice(0, 80))

// the unusual effect's name, from the list every page keeps (views/partials/head.ejs)
let effects = null
const effect_name = (id) => {
    if(!(Number(id) > 0)) return ''
    if(effects === null){
        try { effects = JSON.parse(localStorage.getItem('unusual_effects')) || [] } catch (e) { effects = [] }
        if(!effects.length){ setTimeout(() => { effects = null }, 5000) } // not loaded yet: try again later
    }
    return (Array.isArray(effects) ? effects : []).find((e) => e?.ID == id)?.name || ''
}

// a colour dot: one colour, or a team colour's RED and BLU halves. The colours come from item_colors.js, never from a record.
const color_dot = (colors) => {
    if(!colors) return ''
    const [red, blu] = Array.isArray(colors) ? colors : [colors, colors]
    return `<i class="tl-dot" style="--c1:${red};--c2:${blu}" aria-hidden="true"></i>`
}

// what makes one copy special: [kind, text, label, colours?]
const copy_details = (copy, item, name) => {
    const at = (copy?.at && typeof copy.at == 'object') ? copy.at : {}
    const out = []
    const effect = effect_name(item?.effectID)
    // an unusual's name usually holds its effect already ("Burning Flames Team Captain")
    if(effect && !name.toLowerCase().includes(effect.toLowerCase())){ out.push(['effect', `★ ${effect}`, __('home.effect')]) }
    const sheen = words(at.sheen)[0]
    if(sheen){ out.push(['sheen', sheen, __('item_info.sheen'), SHEEN_COLORS[sheen.toLowerCase()]]) }
    const killstreaker = words(at.killstreaker)[0]
    if(killstreaker){ out.push(['killstreaker', killstreaker, __('item_info.killstreaker')]) }
    const paint = words(at.paint)[0]?.replace(/^Paint Color:\s*/i, '')
    if(paint){ out.push(['paint', paint, __('item_info.paint'), PAINT_COLORS[paint.toLowerCase()]]) }
    for (const spell of words(at.spells)) {
        out.push(['spell', spell.replace(/^Halloween:\s*/i, '').replace(/\s*\(spell only active during event\)$/i, ''), __('item_info.spells')])
    }
    for (const part of words(at.strangeParts)) { out.push(['part', part, __('item_info.parts')]) }
    return out
}

// one line per stack of identical copies, in the same order as the tiles
const item_lines = (side) => {
    const lines = []
    for (const item of (side?.items || [])) {
        for (const group of group_assets(item?.user_stock).values()) {
            const rep = group[0]
            const name = String(create_sku(item?.bp_sku || '', item?.qualityID, rep?.f, rep?.ks) || '').trim()
            if(!name){ continue }
            lines.push({ name, quality: item?.qualityID, count: group.length, details: copy_details(rep, item, name) })
        }
    }
    return lines
}

const line_html = ({ name, quality, count, details }) => {
    const chip = ([kind, text, label, colors]) => `<span class="tl-d ${kind}" title="${esc(label)}: ${esc(text)}"><span class="sr-only">${esc(label)}: </span>${color_dot(colors)}<span class="tl-t">${esc(text)}</span></span>`
    const rest = details.slice(MAX_CHIPS)
    const more = rest.length
        ? `<span class="tl-d tl-rest" title="${esc(rest.map(([, text, label]) => `${label}: ${text}`).join('\n'))}"><span aria-hidden="true">+${rest.length}</span><span class="sr-only">${rest.map(([, text, label]) => esc(`${label}: ${text}`)).join(', ')}</span></span>`
        : ''
    const meta = details.length ? `<span class="tl-meta">${details.slice(0, MAX_CHIPS).map(chip).join('')}${more}</span>` : ''
    return `<li class="tl q-${esc(quality)}"><span class="tl-head"><span class="tl-name" title="${esc(name)}">${esc(name)}</span>${count > 1 ? `<span class="tl-count">×${count}</span>` : ''}</span>${meta}</li>`
}

const lines_html = (lines) => {
    if(!lines.length) return ''
    const first = `<ul class="trade-lines">${lines.slice(0, MAX_LINES).map(line_html).join('')}</ul>`
    const rest = lines.slice(MAX_LINES)
    if(!rest.length) return first
    return first + `<details class="trade-lines-more"><summary>${esc(__('home.more_lines', { n: rest.length }))}</summary><ul class="trade-lines">${rest.map(line_html).join('')}</ul></details>`
}

// the label on top of one side: whose it is, after the same person icon on both sides. The bot's side shows that bot's
// Steam name linked to its Steam profile (bot: { steamid, name } from the server), or "Site bot" when the trade doesn't
// say which bot it was.
const person_icon = '<span class="side-icon" aria-hidden="true"><span class="icon icon-user"></span></span>'
const side_label = (side, viewer, bot) => {
    if(side == 'bot'){
        const steamid = /^7656\d{13}$/.test(String(bot?.steamid || '')) ? String(bot.steamid) : ''
        const name = esc(String(bot?.name || '').trim() || __('home.side_bot'))
        const inner = steamid
            ? `<a class="side-name" href="https://steamcommunity.com/profiles/${steamid}" target="_blank" rel="noopener noreferrer" title="${name}">${name}</a>`
            : `<span class="side-name">${name}</span>`
        return `<div class="side-label bot">${person_icon}${inner}</div>`
    }
    const text = viewer ? __('home.side_you') : __('home.side_user')
    return `<div class="side-label user">${person_icon}<span class="side-name">${esc(text)}</span></div>`
}

// Returns the HTML for one trade, or "" for records without items.
// options.viewer: the visitor is the trader (Profile -> Trades), so their side reads "You"
const render_trade = (trade_o, options) => {
    const viewer = options?.viewer === true
    if(trade_o?.toReceive?.items?.length > 0 && trade_o.toReceive.items[0]?.user_stock?.length === 0){ return "" }
    if(trade_o?.toGive?.items?.length > 0 && trade_o.toGive.items[0]?.user_stock?.length === 0){ return "" }

    const key_value = trade_o?.key_value
    const userItems = [...pure_tiles(trade_o.toReceive), ...item_tiles(trade_o.toReceive, 'buy', key_value, price_factor(trade_o.toReceive, trade_o.toGive, 'buy', key_value), lone_paid(trade_o.toReceive, trade_o.toGive, key_value))]
    const siteItems = [...pure_tiles(trade_o.toGive), ...item_tiles(trade_o.toGive, 'sell', key_value, price_factor(trade_o.toGive, trade_o.toReceive, 'sell', key_value), lone_paid(trade_o.toGive, trade_o.toReceive, key_value))]

    const time = (trade_o?.timestamp > 0) ? `<div class="time-ago" data-time="${num(trade_o.timestamp)}">${timeAgoTrade(trade_o.timestamp)}</div>` : ""

    return `<div class="trade fade-in">
        <div class="heading">
            ${time}
        </div>
        <div class="content">
            <div class="user-side">${side_label('user', viewer)}<div class="grid" id="show-user-grid">${userItems.join(' ')}</div>${lines_html(item_lines(trade_o.toReceive))}</div>
            <div class="trade-icon" aria-hidden="true"><span class="icon icon-trade1"></span></div>
            <div class="bot-side">${side_label('bot', viewer, trade_o?.bot)}<div class="grid" id="show-site-grid">${siteItems.join(' ')}</div>${lines_html(item_lines(trade_o.toGive))}</div>
        </div>
    </div>`
}

export { render_trade, timeAgoTrade }
