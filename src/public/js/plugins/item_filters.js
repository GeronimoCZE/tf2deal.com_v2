// Item page: filters above the Sell / Buy grid (styles: scss/partials/_item_filters.scss).
//
// One item page lists copies of the same item, so only the things that can differ between copies are offered,
// and a filter only shows up when the loaded copies actually differ on it:
//   Bot (Buy only, same idea as the bot filter in the trade window), Paint, Spells, Strange parts,
//   Sheen, Killstreaker, Festivized.
// Killstreak tiers already have their own select on the item page, so they are not repeated here.
// Filtering happens in the browser: the single-item inventory is loaded in one go.

const ANY = '__any'
const NONE = '__none'

const state = {
    party: null,       // 'trade-site' (Buy) | 'trade-user' (Sell)
    assets: new Map(), // "assetid|bot" -> asset
    picked: {},        // dimension -> value
    bot_names: null    // steamid -> name, from /api/bots
}

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const key_of = (a, bot) => `${a}|${bot || ''}`
const list = (value) => Array.isArray(value) ? value.filter(Boolean).map(String) : (value ? [String(value)] : [])

// the filters, in the order they are shown
const DIMENSIONS = [
    { id: 'bot', site_only: true, values: (asset) => [asset?.ownerId ? String(asset.ownerId) : NONE] },
    { id: 'paint', values: (asset) => list(asset?.at?.paint).length ? list(asset.at.paint) : [NONE] },
    { id: 'spells', multi: true, values: (asset) => list(asset?.at?.spells).length ? list(asset.at.spells) : [NONE] },
    { id: 'parts', multi: true, values: (asset) => list(asset?.at?.strangeParts).length ? list(asset.at.strangeParts) : [NONE] },
    { id: 'sheen', values: (asset) => list(asset?.at?.sheen).length ? list(asset.at.sheen) : [NONE] },
    { id: 'killstreaker', values: (asset) => list(asset?.at?.killstreaker).length ? list(asset.at.killstreaker) : [NONE] },
    { id: 'festivized', values: (asset) => [asset?.f ? 'yes' : 'no'] }
]

const label = (dim, value) => {
    if(dim == 'bot'){
        if(value == NONE){ return __('item_filters.unknown_bot') }
        return state.bot_names?.get(value) || `${__('item_filters.bot')} …${value.slice(-4)}`
    }
    if(dim == 'festivized'){ return value == 'yes' ? __('item_filters.yes') : __('item_filters.no') }
    if(value == NONE){ return __(`item_filters.no_${dim}`) }
    return value // paint / spell / part names stay English, like item names
}

const load_bot_names = async () => {
    if(state.bot_names){ return }
    state.bot_names = new Map()
    try {
        const res = await fetch('/api/bots', { headers: { 'Accept': 'application/json' } }).then((r) => r.json())
        for (const bot of (Array.isArray(res?.bots) ? res.bots : [])) {
            if(bot?.steamid){ state.bot_names.set(String(bot.steamid), String(bot.personaname || bot.name || '')) }
        }
    } catch (e) {}
}

const bar = () => document.getElementById('item-filters')

const matches = (asset, picked = state.picked) => DIMENSIONS.every(({ id, values }) => {
    const want = picked[id]
    return !want || want == ANY || values(asset).includes(want)
})

// count per option, taking the other picked filters into account (so 0-result options can be greyed out)
const counts = (dim) => {
    const others = { ...state.picked, [dim.id]: ANY }
    const out = new Map()
    for (const asset of state.assets.values()) {
        if(!matches(asset, others)){ continue }
        for (const v of new Set(dim.values(asset))) { out.set(v, (out.get(v) || 0) + 1) }
    }
    return out
}

// a filter is only worth showing when it would split the copies
const useful = (dim) => {
    if(dim.site_only && state.party != 'trade-site'){ return false }
    const all = new Map()
    for (const asset of state.assets.values()) {
        for (const v of new Set(dim.values(asset))) { all.set(v, (all.get(v) || 0) + 1) }
    }
    if(all.size < 2){ return false }
    // multi-value (spells, parts): useful as soon as some copies have one and others differ
    return [...all.values()].some((n) => n < state.assets.size)
}

const render = () => {
    const el = bar()
    if(!el){ return }
    const dims = DIMENSIONS.filter(useful)
    if(dims.length == 0){
        el.hidden = true
        el.innerHTML = ''
        apply()
        return
    }

    el.innerHTML = `
        <span class="item-filters-title">${__('item_filters.title')}</span>
        ${dims.map((dim) => {
            const c = counts(dim)
            const picked = state.picked[dim.id]
            const options = [...c.keys()].sort((a, b) => (a == NONE) - (b == NONE) || label(dim.id, a).localeCompare(label(dim.id, b)))
            return `<div class="if-chip${picked && picked != ANY ? ' selected' : ''}" data-dim="${dim.id}" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">
                <span class="if-name">${__(`item_filters.${dim.id}`)}</span>
                <span class="if-value">${picked && picked != ANY ? esc(label(dim.id, picked)) : esc(__('item_filters.any'))}</span>
                <span class="if-chevron" aria-hidden="true"></span>
                <div class="if-menu" role="listbox">
                    <div class="if-option none${!picked || picked == ANY ? ' active' : ''}" data-value="${ANY}" role="option">${esc(__('item_filters.any'))}</div>
                    ${options.map((v) => `<div class="if-option${picked == v ? ' active' : ''}${c.get(v) ? '' : ' empty'}" data-value="${esc(v)}" role="option">
                        <span>${esc(label(dim.id, v))}</span><em>${c.get(v) || 0}</em></div>`).join('')}
                </div>
            </div>`
        }).join('')}
        <span class="item-filters-count" id="item-filters-count"></span>
        <button type="button" class="item-filters-reset" id="item-filters-reset" hidden>${__('item_filters.reset')}</button>`
    el.hidden = false
    apply()
}

const apply = () => {
    const grid = document.getElementById('trade-item-grid')
    if(!grid){ return }
    let shown = 0, total = 0
    grid.querySelectorAll('.item').forEach((item) => {
        const asset = state.assets.get(key_of(item.getAttribute('data-assetid'), item.getAttribute('data-bot')))
        const visible = !asset || matches(asset)
        item.classList.toggle('filtered-out', !visible)
        total++
        if(visible){ shown++ }
    })

    grid.querySelector('.inventory-message.filters-empty')?.remove()
    if(total > 0 && shown == 0){
        grid.insertAdjacentHTML('beforeend', `<div class="inventory-message filters-empty">${__('item_filters.empty')}</div>`)
    }

    const active = Object.values(state.picked).some((v) => v && v != ANY)
    const count = document.getElementById('item-filters-count')
    if(count){ count.textContent = active ? __('item_filters.showing', { shown, total }) : '' }
    const reset = document.getElementById('item-filters-reset')
    if(reset){ reset.hidden = !active }
}

const close_all = (except) => {
    bar()?.querySelectorAll('.if-chip.open').forEach((f) => {
        if(f == except){ return }
        f.classList.remove('open')
        f.setAttribute('aria-expanded', 'false')
    })
}

// Called by trade.js after the Sell / Buy grid was rendered.
export const build_item_filters = async (party, assets) => {
    if(party != state.party){ state.picked = {} } // switching between Sell and Buy starts clean
    state.party = party
    state.assets = new Map((Array.isArray(assets) ? assets : []).map((a) => [key_of(a?.a, party == 'trade-site' ? a?.ownerId : ''), a]))
    if(party == 'trade-site'){ await load_bot_names() }

    // drop picks that no longer exist after a reload
    for (const dim of DIMENSIONS) {
        const want = state.picked[dim.id]
        if(want && want != ANY && ![...state.assets.values()].some((a) => dim.values(a).includes(want))){ delete state.picked[dim.id] }
    }
    render()
}

export const hide_item_filters = () => {
    state.assets = new Map()
    const el = bar()
    if(el){ el.hidden = true; el.innerHTML = '' }
}

document.addEventListener('click', (e) => {
    const el = bar()
    if(!el || el.hidden){ return }
    const chip = e.target.closest?.('#item-filters .if-chip')

    const option = e.target.closest?.('#item-filters .if-option')
    if(option && chip){
        state.picked[chip.dataset.dim] = option.dataset.value
        render()
        return
    }
    if(e.target.closest?.('#item-filters-reset')){
        state.picked = {}
        render()
        return
    }
    if(chip && !e.target.closest('.if-menu')){
        const open = !chip.classList.contains('open')
        close_all(chip)
        chip.classList.toggle('open', open)
        chip.setAttribute('aria-expanded', String(open))
        return
    }
    if(!chip){ close_all() }
})

document.addEventListener('keydown', (e) => {
    const chip = e.target.closest?.('#item-filters .if-chip')
    if(e.key == 'Escape'){ close_all(); return }
    if(chip && (e.key == 'Enter' || e.key == ' ') && e.target == chip){
        e.preventDefault()
        chip.click()
    }
})
