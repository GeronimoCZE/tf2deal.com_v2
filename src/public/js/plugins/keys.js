import { tradeOfferConnection } from './trade.js'

// The key banking page (/keys, view keys.ejs, styles scss/partials/views/_keys.scss). The server draws it once with the
// key bank's status (service/key_bank.js); this keeps it live ('keybank:status' over the site socket) and sends the
// request (POST /api/keys/trade). Two halves, each a whole swap on its own (2026-11-28, "devide screen in to 2 for buy
// and sell"):
//   - Buy keys: the visitor pays metal at our sell price; Sell keys: they get metal at our buy price,
//   - 1 to max_keys keys as key pictures, the ones the picked bot can't do now are off,
//   - a bank bot: the one that can do the most for that half is picked, the line under it says how many it can do.
// Prices are counted in scrap (9 a ref) like the bots do, so 5 × 60.66 ref is 303.33 ref, not 303.30.

const S = (ref) => Math.round(Number(ref) * 9)
const R = (scrap) => Math.floor(scrap / 9 * 100 + 1e-6) / 100
const fmt = (ref) => (Number.isFinite(Number(ref)) ? R(S(ref)).toFixed(2) : '—')
// "key" / "keys" in the page's language (Czech and Russian have a form for 2 to 4 and one for 5)
const plural_rules = new Intl.PluralRules(window.TD_LANG || 'en')
const key_word = (n) => { const word = __('keys.word.' + plural_rules.select(n)); return word.startsWith('keys.') ? __('keys.word.other') : word }
const plural_keys = (n) => `${n} ${key_word(n)}`

const SIDES = ['buy', 'sell']
// the visitor's side → the price of ours it uses: they buy at our sell price, they sell at our buy price
const PRICE_OF = { buy: 'sell', sell: 'buy' }

const init_keys = (root) => {
    if(!root){ return }
    const $ = (sel) => root.querySelector(sel)
    let status = null
    try { status = JSON.parse(document.getElementById('keybank-data')?.textContent || 'null') } catch (e) { status = null }

    const halves = Object.fromEntries(SIDES.map((side) => [side, root.querySelector(`[data-kb-half="${side}"]`)]))
    // each half's own choice: how many keys and which bot (chosen: the visitor picked it)
    const ui = { busy: false, sending: null, updated: Date.now(), buy: { n: 1, bot: null, chosen: false }, sell: { n: 1, bot: null, chosen: false } }
    const signed_in = typeof user != 'undefined' && user != 'no_session'

    const on = () => !!(status && status.enabled && status.price && !status.stale)
    const max_keys = () => Math.max(1, Number(status?.max_keys) || 5)
    const unit = (side) => status?.price?.[PRICE_OF[side]]
    const bot_of = (id) => (status?.bots || []).find((b) => b.steamid == id) || null
    // keys this bot can do for the visitor's side now: sell them keys (they buy) / buy theirs (they sell)
    const cap_of = (side, b) => b && b.online ? Math.min(max_keys(), side == 'buy' ? b.can_sell : b.can_buy) : 0
    // online and able to do the most for this side
    const best_bot = (side) => (status?.bots || []).filter((b) => b.online).sort((a, b) => cap_of(side, b) - cap_of(side, a))[0] || null
    // a half keeps its bot while it's online; one the visitor didn't pick gives way when it can't do that side
    const pick_bots = () => {
        for(const side of SIDES){
            const h = ui[side]
            const b = bot_of(h.bot)
            if(!b?.online || (!h.chosen && cap_of(side, b) == 0)){ h.bot = best_bot(side)?.steamid || null; h.chosen = false }
        }
    }

    // ---------------------------------------------------------------- drawing

    const draw_live = () => {
        const live = $('[data-kb-live]')
        const state = !status || !status.enabled || !status.price ? 'off' : status.stale ? 'stale' : 'live'
        live.dataset.state = state
        const ago = Math.max(0, Math.round((Date.now() - ui.updated) / 1000))
        $('[data-kb-updated]').textContent = state == 'off' ? __('keys.off') : state == 'stale' ? __('keys.stale')
            : ago < 5 ? __('keys.live') : __('keys.updated_ago', { s: ago < 60 ? `${ago} s` : `${Math.floor(ago / 60)} min` })
    }

    const draw_notice = () => {
        const notice = $('[data-kb-notice]')
        notice.hidden = on()
        notice.textContent = !status ? __('keys.unavailable') : status.stale ? __('keys.stale_notice') : __('keys.paused')
    }

    // the bot list in a half's select (names can change, bots come and go)
    const draw_select = (side) => {
        const select = halves[side]?.querySelector('[data-kb-bot]')
        if(!select){ return }
        const bots = status?.bots || []
        const sig = bots.map((b) => `${b.steamid}:${b.name}:${b.online}`).join('|')
        if(select.dataset.sig != sig){
            select.dataset.sig = sig
            select.replaceChildren(...bots.map((b) => {
                const o = document.createElement('option')
                o.value = b.steamid
                o.disabled = !b.online
                o.textContent = (b.name || b.steamid) + (b.online ? '' : ` (${__('keys.offline')})`)
                return o
            }))
        }
        if(ui[side].bot){ select.value = ui[side].bot }
        select.disabled = !bots.some((b) => b.online)
    }

    const draw_half = (side) => {
        const el = halves[side]
        if(!el){ return }
        const h = ui[side]
        const b = bot_of(h.bot)
        const cap = on() ? cap_of(side, b) : 0
        if(cap > 0 && h.n > cap){ h.n = cap }
        const price = unit(side)
        el.querySelector('[data-kb-price]').textContent = price ? fmt(price) : '—'
        el.querySelectorAll('[data-kb-n]').forEach((pip) => {
            const n = Number(pip.dataset.kbN)
            pip.disabled = n > cap
            pip.classList.toggle('is-on', n <= h.n && n <= cap)
            pip.setAttribute('aria-pressed', String(n <= h.n && n <= cap))
        })
        draw_select(side)
        el.querySelector('[data-kb-cap]').textContent = !on() ? '' : !b ? __('keys.pick_bot')
            : cap == 0 ? __(side == 'buy' ? 'keys.cap_none_sell' : 'keys.cap_none_buy', { name: b.name || '' })
            : __(side == 'buy' ? 'keys.cap_sell' : 'keys.cap_buy', { name: b.name || '', n: cap })
        const n = cap > 0 ? h.n : Math.min(h.n, max_keys())
        const total = price ? R(S(price) * n).toFixed(2) : '—'
        const value = el.querySelector('[data-kb-total] b')
        if(value){ value.textContent = total }
        const go = el.querySelector('[data-kb-go]')
        if(go && go.tagName == 'BUTTON'){
            const sending = ui.busy && ui.sending == side
            go.disabled = ui.busy || !on() || cap == 0 || window.site_settings?.trading === false
            go.classList.toggle('is-busy', sending)
            go.textContent = sending ? __('keys.requesting')
                : __(side == 'buy' ? 'keys.request_buy' : 'keys.request_sell', { what: plural_keys(n), total })
        }
    }

    const draw = () => { draw_live(); draw_notice(); SIDES.forEach(draw_half) }

    // ---------------------------------------------------------------- the status changes

    const update = (next, { fresh = true } = {}) => {
        if(!next || typeof next != 'object'){ return }
        const before = status
        status = next
        if(fresh){ ui.updated = Date.now() }
        pick_bots()
        // a price moved: it lights up once (the visitor may be about to press the button)
        for(const side of SIDES){
            const was = before?.price?.[PRICE_OF[side]]
            const now = unit(side)
            if(was && now && S(was) != S(now) && !ui.busy){
                const el = halves[side]?.querySelector('[data-kb-price]')
                el?.classList.remove('is-moved'); void el?.offsetWidth; el?.classList.add('is-moved')
            }
        }
        draw()
    }

    // ---------------------------------------------------------------- input

    root.addEventListener('click', (e) => {
        const half = e.target.closest('[data-kb-half]')
        if(!half){ return }
        const side = half.dataset.kbHalf
        const pip = e.target.closest('[data-kb-n]')
        if(pip && !pip.disabled){
            ui[side].n = Number(pip.dataset.kbN)
            draw_half(side)
            return
        }
        if(e.target.closest('[data-kb-go]')){ send(side) }
    })
    root.addEventListener('change', (e) => {
        const select = e.target.closest('[data-kb-bot]')
        const half = select?.closest('[data-kb-half]')
        if(!half){ return }
        const side = half.dataset.kbHalf
        ui[side].bot = select.value
        ui[side].chosen = true
        draw_half(side)
    })

    const REASON_KEYS = ['price_changed', 'not_enough_stock', 'bot_unavailable', 'key_bank_off', 'offer_open', 'user_not_enough_keys', 'user_not_enough_metal', 'bank_no_change', 'no_price']
    const send = async (side) => {
        if(ui.busy || !signed_in){ return }
        if(window.site_settings?.trading === false){
            iziToast.warning({ title: __('site.trading_paused_title'), message: __('site.trading_paused') })
            return
        }
        const h = ui[side]
        const b = bot_of(h.bot)
        const price = unit(side)
        if(!b || !price){ return }
        ui.busy = true
        ui.sending = side
        SIDES.forEach(draw_half)
        let res = null
        try {
            const r = await fetch('/api/keys/trade', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ bot: b.steamid, side, keys: h.n, price, hash: typeof user_id != 'undefined' ? user_id : '' })
            })
            res = await r.json().catch(() => null)
        } catch (e) {
            res = null
        }
        ui.busy = false
        ui.sending = null
        if(res?.success == 1){
            SIDES.forEach(draw_half)
            tradeOfferConnection({ status: 'creating', requested: Date.now() }, 'open')
            // (when our price moved in the visitor's favour meanwhile, the answer's total is the offer's)
            iziToast.success({ title: __('keys.requested_title'), message: __('keys.requested', { what: plural_keys(res.keys || h.n), total: fmt(res.total) }) })
            return
        }
        if(res?.keybank){ update(res.keybank, { fresh: true }) } else { SIDES.forEach(draw_half) }
        const reason = res?.reason
        if(reason == 'offer_open'){ tradeOfferConnection(localStorage.getItem(`tradeoffer${user}`), 'open') }
        iziToast.error({
            title: reason == 'price_changed' ? __('keys.price_changed_title') : __('common.error'),
            message: reason == 'price_changed' ? __('keys.err.price_changed', { price: fmt(res?.price) })
                : REASON_KEYS.includes(reason) ? __('keys.err.' + reason) : (res?.message || __('trade.create_failed'))
        })
    }

    // ---------------------------------------------------------------- start

    pick_bots()
    draw()

    if(typeof socket != 'undefined'){
        const watch = () => socket.emit('keybank:watch', (s) => update(s))
        socket.on('keybank:status', (s) => update(s))
        socket.on('connect', watch)
        watch()
    }

    // "updated 20 s ago" and, without the socket, a fresh look every minute
    setInterval(draw_live, 5000)
    setInterval(() => {
        if(typeof socket != 'undefined' && socket.connected){ return }
        fetch('/api/keys', { headers: { 'Accept': 'application/json' } }).then((r) => r.ok ? r.json() : null).then((r) => r?.keybank && update(r.keybank)).catch(() => {})
    }, 60 * 1000)
}

export { init_keys }
