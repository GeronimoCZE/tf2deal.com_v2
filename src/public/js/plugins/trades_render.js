import { round_ref, create_sku, group_assets } from './trade.js'

// Renders finished trades (home page "Latest trades" and Profile -> Trades).
// Identical assets are stacked into one tile with a count, the same way the /trade page does it.

const key_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ/330x192';
const ref_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO1Mv6NGucF1Ygzt8ZQijJukFMiMrbhYDEwI1yRVKNfD6xorQ3qW3Jr6546DNPuou9IOVK4p4kWJaA/330x192';
const img_cdn = 'https://community.cloudflare.steamstatic.com/economy/image/';

// trade records come from the bot server: escape everything before it goes into the HTML
const esc = (text) => String(text ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]))
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0

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
        tiles.push(`<div class="pure keys" data-quality="Unique" data-type="Pure" data-count="${keys}" data-name="Mann Co. Supply Crate Key"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${img_cdn}${key_image}"><div class='pure-count'>${keys}</div></div>`)
    }
    if(metal > 0){
        const refs = round_ref(metal)
        tiles.push(`<div class="pure refs" data-quality="Unique" data-type="Pure" data-count="${refs}" data-name="Refined Metal"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${img_cdn}${ref_image}"><div class='pure-count'>${refs}</div></div>`)
    }
    return tiles
}

// price_field: 'buy' for what the user gave us, 'sell' for what the user got
const item_tiles = (side, price_field, key_value) => {
    const tiles = []
    for (const item of (side?.items || [])) {
        const craftable = (item?.bp_sku?.includes('Non-Craftable')) ? "non-craftable" : "craftable"
        const image = item?.image?.startsWith('ms/') ? item.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/') : item?.image;

        for (const group of group_assets(item.user_stock).values()) {
            const rep = group[0]
            const count = group.length
            const price = rep?.[price_field] ? rep[price_field] : item?.[price_field]
            const badge = (count > 1) ? `<div class="stack-count">${count}</div>` : ""

            tiles.push(`<div class="item q-${esc(item?.qualityID)} ${craftable} ${count > 1 ? 'stacked' : ''}" data-assetids="${esc(group.map(a => a?.a).join(','))}" data-key="${esc(key_value)}" data-quality="${esc(item?.qualityID)}" data-effect="${esc(item?.effectID)}" data-name="${esc(item.bp_sku)}" data-bp_sku="${esc(create_sku(item.bp_sku, item.qualityID, rep?.f, rep?.ks))}" data-type="${esc(item?.type)}" data-price="${esc(price)}" data-tradable="1" style="background-image: url('https://api.backpack.tf/images/440/particles/${num(item?.effectID)}_94x94.png')"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${esc(image)}">${badge}</div>`)
        }
    }
    return tiles
}

// Returns the HTML for one trade, or "" for records without items.
const render_trade = (trade_o) => {
    if(trade_o?.toReceive?.items?.length > 0 && trade_o.toReceive.items[0]?.user_stock?.length === 0){ return "" }
    if(trade_o?.toGive?.items?.length > 0 && trade_o.toGive.items[0]?.user_stock?.length === 0){ return "" }

    const userItems = [...pure_tiles(trade_o.toReceive), ...item_tiles(trade_o.toReceive, 'buy', trade_o?.key_value)]
    const siteItems = [...pure_tiles(trade_o.toGive), ...item_tiles(trade_o.toGive, 'sell', trade_o?.key_value)]

    const time = (trade_o?.timestamp > 0) ? `<div class="time-ago">${timeAgoTrade(trade_o.timestamp)}</div>` : ""

    return `<div class="trade fade-in">
        <div class="heading">
            ${time}
        </div>
        <div class="content">
            <div class="user-side"><div class="grid" id="show-user-grid">${userItems.join(' ')}</div></div>
            <div class="trade-icon"><span class="icon icon-trade1"></span></div>
            <div class="bot-side"><div class="grid" id="show-site-grid">${siteItems.join(' ')}</div></div>
        </div>
    </div>`
}

export { render_trade, timeAgoTrade }
