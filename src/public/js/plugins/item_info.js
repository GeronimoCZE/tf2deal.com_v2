// Item info window: everything about one copy of an item, its links and Steam's "Inspect in game" link.
// Opens with a right-click on an item (the browser's own menu stays closed there), or a tap on the item's tooltip on
// touch screens; on the trade page (both inventories and the trade window) and on the item page (Buy / Sell).
// The data comes from trade.item_details (styles: scss/partials/_modals.scss -> .item-info).
//
// Custom names, custom descriptions and the inspect link come from the bot server with each copy (at.customName,
// at.customDesc, at.inspect: docs/ITEM_DETAILS.md); a copy without them just doesn't show them.
import * as main from '../main.js'
import * as trade from './trade.js'

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const KS_NAMES = ['', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak']
const QUALITY_WORDS = ['Strange', 'Genuine', 'Vintage', 'Haunted', "Collector's", 'Unusual', 'Decorated', 'Community', 'Self-Made', 'Normal']

const quality_name = (id) => itemAttr?.Quality?.[id]?.name || ''

// "Burning Flames Team Captain" -> "Team Captain": the name the TF2 Wiki and backpack.tf know the item by
const base_name = (info) => {
    if(info.base_name){ return info.base_name }
    let name = String(info.bp_sku || '').replace(/^Non-Craftable /, '')
    if(info.effect && name.startsWith(info.effect + ' ')){ name = name.slice(info.effect.length + 1) }
    const quality = quality_name(info.qualityID).replace(' Weapon', '')
    if(quality && quality != 'Unique' && QUALITY_WORDS.includes(quality) && name.startsWith(quality + ' ')){ name = name.slice(quality.length + 1) }
    return name
}

// 110.11 ref with a key at 60 ref -> "1 key, 50.11 ref"
const price_words = (ref, key_price) => {
    const keys = key_price > 0 ? Math.floor(ref / key_price) : 0
    const metal = trade.round_ref(ref - keys * key_price)
    const key_text = `${keys} ${keys == 1 ? 'key' : 'keys'}`
    if(keys > 0){ return metal > 0 ? `${key_text}, ${metal} ref` : key_text }
    return `${metal} ref`
}

const links = (info) => {
    const name = base_name(info)
    // backpack.tf's name for the item: Festivized and the killstreak tier come before it
    const bptf_name = [info.festivized ? 'Festivized' : '', KS_NAMES[info.ks] || '', name].filter(Boolean).join(' ')
    const quality = quality_name(info.qualityID) || 'Unique'
    const market_name = info.steam_sku || info.name
    const list = []
    // the item's page (a killstreak copy opens its tier's page), for the visitor's items too; not on an item page itself
    if(!TD_PATH.startsWith('/items/') && info.bp_sku){
        const page = info.ks > 0 ? trade.create_sku(info.bp_sku, info.qualityID, 0, info.ks) : info.bp_sku
        list.push({ href: lurl('/items/' + encodeURIComponent(page)), text: __('item_info.item_page'), local: true })
    }
    list.push({ href: `https://backpack.tf/stats/${encodeURIComponent(quality)}/${encodeURIComponent(bptf_name)}/Tradable/${info.craftable ? 'Craftable' : 'Non-Craftable'}${info.effectID > 0 ? '/' + info.effectID : ''}`, text: __('item_info.bptf_prices') })
    list.push({ href: `https://backpack.tf/item/${encodeURIComponent(info.assetid)}`, text: __('item_info.bptf_history') })
    if(name){ list.push({ href: `https://wiki.teamfortress.com/wiki/${encodeURIComponent(name.replace(/^The /, '').replace(/ /g, '_'))}`, text: __('item_info.wiki') }) }
    list.push({ href: `https://steamcommunity.com/market/search?appid=440&q=${encodeURIComponent(market_name)}`, text: __('item_info.market') })
    if(/^\d{17}$/.test(info.owner)){
        list.push({ href: `https://steamcommunity.com/profiles/${info.owner}/inventory/#440_2_${encodeURIComponent(info.assetid)}`, text: __('item_info.inventory') })
    }
    return list
}

const fact = (title, value) => value ? `<div class="ii-fact"><dt>${esc(title)}</dt><dd translate="no">${esc(value)}</dd></div>` : ''

const open = (item_el, party) => {
    const info = trade.item_details(item_el, party)
    const modal = document.querySelector('.modal_overlay .modal')
    if(!info || !modal){ return false }
    trade.item_tooltip('hide')

    const quality = quality_name(info.qualityID)
    const type = itemAttr?.Types?.[info.type] || ''
    const classes = info.classes.length == 9 ? __('item_info.all_classes') : info.classes.join(', ')
    const price = info.not_buying ? __('item_info.not_buying') : (info.price > 0 ? price_words(info.price, info.key_price) : '')
    const bot = info.party == 'site' && info.owner ? (info.bot_name || info.owner) : ''
    const effect = info.effectID > 0 && info.effect ? `<span class="ii-effect">★ ${esc(info.effect)}</span>` : ''
    const thumb_bg = info.effectID > 0 ? ` style="background-image: url('https://api.backpack.tf/images/440/particles/${Number(info.effectID)}_94x94.png')"` : ''

    const inspect = info.inspect
        ? `<a class="ii-inspect" href="${esc(info.inspect)}" rel="noopener">${esc(__('item_info.inspect'))}</a>`
        : `<span class="ii-inspect off" aria-disabled="true">${esc(__('item_info.inspect'))}<small>${esc(__('item_info.no_inspect'))}</small></span>`

    modal.querySelector('.modal_header .modal_name').textContent = __('item_info.title')
    modal.querySelector('.modal_content').innerHTML = `
        <div class="item-info">
            <div class="ii-head">
                <span class="ii-thumb q-${esc(info.qualityID)}"${thumb_bg}><img src="${esc(info.image)}" alt=""></span>
                <div class="ii-name">
                    <strong class="ii-title" translate="no">${esc(info.name)}</strong>
                    ${info.custom_name ? `<span class="ii-custom" translate="no">"${esc(info.custom_name)}"</span>` : ''}
                    ${info.custom_desc ? `<span class="ii-custom-desc" translate="no">"${esc(info.custom_desc)}"</span>` : ''}
                    ${effect}
                </div>
            </div>
            ${price ? `<p class="ii-price"><span>${esc(info.party == 'site' ? __('item_info.price_buy') : __('item_info.price_sell'))}</span> <strong translate="no">${esc(price)}</strong></p>` : ''}
            <dl class="ii-facts">
                ${fact(__('item_info.quality'), quality)}
                ${fact(__('item_info.type'), type)}
                ${fact(__('item_info.classes'), classes)}
                ${fact(__('item_info.killstreak'), KS_NAMES[info.ks] || '')}
                ${fact(__('item_info.killstreaker'), info.killstreaker)}
                ${fact(__('item_info.sheen'), info.sheen)}
                ${fact(__('item_info.paint'), info.paint)}
                ${fact(__('item_info.spells'), info.spells.join(', '))}
                ${fact(__('item_info.parts'), info.parts.join(', '))}
                ${fact(__('item_info.festivized'), info.festivized ? __('item_info.yes') : '')}
                ${fact(__('item_info.craftable'), info.craftable ? '' : __('item_info.no'))}
                ${fact(__('item_info.bot'), bot)}
            </dl>
            ${inspect}
            <div class="ii-links" role="group" aria-label="${esc(__('item_info.links'))}">
                ${links(info).map((l) => `<a class="ii-link" href="${esc(l.href)}" ${l.local ? '' : 'target="_blank" rel="nofollow noopener"'}>${esc(l.text)}${l.local ? '' : ' <span aria-hidden="true">↗</span>'}</a>`).join('')}
            </div>
            <div class="ii-actions">
                <button type="button" class="ii-close">${esc(__('item_info.close'))}</button>
            </div>
        </div>`

    modal.querySelector('.ii-close').addEventListener('click', () => main.toggleModal(main.modals.item_info, 'close'))
    main.toggleModal(main.modals.item_info, 'open')
    return true
}

// Right-click on an item opens the window instead of the browser's menu; on touch screens a tap on the tooltip does
// (a long press on Android counts as a right-click too). `party_of(item_el)` says whose item it is.
const watch = (container, party_of) => {
    if(!container){ return }
    container.addEventListener('contextmenu', (e) => {
        const item_el = e.target.closest?.('.item')
        if(!item_el || !container.contains(item_el) || item_el.classList.contains('pure')){ return }
        e.preventDefault()
        open(item_el, party_of(item_el))
    })
}

let tooltip_ready = false
const watch_tooltip = () => {
    const tooltip = document.getElementById('item_tooltip')
    if(!tooltip || tooltip_ready){ return }
    tooltip_ready = true
    // a tap: the browser's mouse events after it would close the tooltip (mouseout of the item) before the click
    // arrives, so the window opens on the touch itself and those events are skipped
    tooltip.addEventListener('touchend', (e) => {
        if(!tooltip.classList.contains('has-details') || !tooltip.classList.contains('show') || !trade.tooltip_item.el){ return }
        e.preventDefault()
        open(trade.tooltip_item.el, trade.tooltip_item.party)
    })
    tooltip.addEventListener('click', () => {
        if(tooltip.classList.contains('has-details') && trade.tooltip_item.el){ open(trade.tooltip_item.el, trade.tooltip_item.party) }
    })
    tooltip.addEventListener('contextmenu', (e) => {
        if(!tooltip.classList.contains('has-details') || !trade.tooltip_item.el){ return }
        e.preventDefault()
        open(trade.tooltip_item.el, trade.tooltip_item.party)
    })
}

export { open, watch, watch_tooltip }
