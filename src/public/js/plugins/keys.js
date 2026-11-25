import { tradeOfferConnection } from './trade.js'

// The key banking page (/keys, view keys.ejs, styles scss/partials/views/_keys.scss). The server draws it once with the
// key bank's status (service/key_bank.js); this keeps it live ('keybank:status' over the site socket) and sends the
// request (POST /api/keys/trade). The user picks:
//   - buy keys (pay metal at our sell price) or sell keys (get metal at our buy price),
//   - 1 to max_keys keys: key pictures, the ones the picked bot can't do now are off,
//   - a bank bot: each says how many keys it can sell you / buy from you now.
// Prices are counted in scrap (9 a ref) like the bots do, so 5 × 60.66 ref is 303.33 ref, not 303.30.

const S = (ref) => Math.round(Number(ref) * 9)
const R = (scrap) => Math.floor(scrap / 9 * 100 + 1e-6) / 100
const fmt = (ref) => (Number.isFinite(Number(ref)) ? R(S(ref)).toFixed(2) : '—')
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// "key" / "keys" in the page's language (Czech and Russian have a form for 2 to 4 and one for 5)
const plural_rules = new Intl.PluralRules(window.TD_LANG || 'en')
const key_word = (n) => { const word = __('keys.word.' + plural_rules.select(n)); return word.startsWith('keys.') ? __('keys.word.other') : word }
const plural_keys = (n) => `${n} ${key_word(n)}`

const init_keys = (root) => {
    if(!root){ return }
    const $ = (sel) => root.querySelector(sel)
    const $$ = (sel) => Array.from(root.querySelectorAll(sel))
    let status = null
    try { status = JSON.parse(document.getElementById('keybank-data')?.textContent || 'null') } catch (e) { status = null }

    const ui = { side: 'buy', n: 1, bot: null, chosen: false, busy: false, updated: Date.now(), history_sig: '' }
    const signed_in = typeof user != 'undefined' && user != 'no_session'

    const on = () => !!(status && status.enabled && status.price && !status.stale)
    const max_keys = () => Math.max(1, Number(status?.max_keys) || 5)
    const unit = () => ui.side == 'buy' ? status?.price?.sell : status?.price?.buy
    const bot_of = (id) => (status?.bots || []).find((b) => b.steamid == id) || null
    // keys the picked bot can do for this side now
    const cap_of = (b) => b && b.online ? Math.min(max_keys(), ui.side == 'buy' ? b.can_sell : b.can_buy) : 0

    // the bot to start with (or after the picked one went away): online and able to do the most for this side
    const best_bot = () => (status?.bots || []).filter((b) => b.online).sort((a, b) => cap_of(b) - cap_of(a))[0] || null

    // ---------------------------------------------------------------- drawing

    const draw_board = () => {
        root.querySelector('[data-kb-price="sell"]').textContent = status?.price ? fmt(status.price.sell) : '—'
        root.querySelector('[data-kb-price="buy"]').textContent = status?.price ? fmt(status.price.buy) : '—'
        $('[data-kb-spread]').textContent = status?.price ? `${R(S(status.price.sell) - S(status.price.buy)).toFixed(2)} ref` : '—'
        $('[data-kb-market]').textContent = status?.market?.buy && status?.market?.sell ? `${fmt(status.market.buy)} / ${fmt(status.market.sell)} ref` : '—'
        const notice = $('[data-kb-notice]')
        notice.hidden = on()
        notice.textContent = !status ? __('keys.unavailable') : status.stale ? __('keys.stale_notice') : __('keys.paused')
        draw_live()
    }

    const draw_live = () => {
        const live = $('[data-kb-live]')
        const state = !status || !status.enabled || !status.price ? 'off' : status.stale ? 'stale' : 'live'
        live.dataset.state = state
        const ago = Math.max(0, Math.round((Date.now() - ui.updated) / 1000))
        $('[data-kb-updated]').textContent = state == 'off' ? __('keys.off') : state == 'stale' ? __('keys.stale')
            : ago < 5 ? __('keys.live') : __('keys.updated_ago', { s: ago < 60 ? `${ago} s` : `${Math.floor(ago / 60)} min` })
    }

    const cells = (n) => Array.from({ length: max_keys() }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')
    const draw_bots = () => {
        const list = $('[data-kb-bots]')
        const bots = status?.bots || []
        if(!bots.length){
            list.innerHTML = `<p class="kb-empty">${esc(__('keys.no_bots'))}</p>`
            return
        }
        list.innerHTML = bots.map((b) => `
            <label class="kb-bot${b.online ? '' : ' is-offline'}${cap_of(b) ? '' : ' is-empty'}">
                <input type="radio" name="kb-bot" value="${esc(b.steamid)}" ${b.online ? '' : 'disabled'} ${b.steamid == ui.bot ? 'checked' : ''}>
                <img class="kb-bot-avatar" src="${esc(b.avatar || '/img/icon96x96.png')}" alt="" width="40" height="40">
                <span class="kb-bot-name">${esc(b.name || b.steamid)}</span>
                <span class="kb-bot-state">${esc(b.online ? __('keys.online') : __('keys.offline'))}</span>
                <span class="kb-meter${ui.side == 'buy' ? ' is-active' : ''}" data-dir="sell"><span class="kb-meter-label">${esc(__('keys.sells'))}</span><span class="kb-cells">${cells(b.can_sell)}</span><b>${Number(b.can_sell) || 0}</b></span>
                <span class="kb-meter${ui.side == 'sell' ? ' is-active' : ''}" data-dir="buy"><span class="kb-meter-label">${esc(__('keys.buys'))}</span><span class="kb-cells">${cells(b.can_buy)}</span><b>${Number(b.can_buy) || 0}</b></span>
            </label>`).join('')
    }

    const draw_swap = () => {
        $$('[data-kb-side]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.kbSide == ui.side)))
        root.dataset.side = ui.side
        const b = bot_of(ui.bot)
        const cap = on() ? cap_of(b) : 0
        if(cap > 0 && ui.n > cap){ ui.n = cap }
        $$('[data-kb-n]').forEach((el) => {
            const n = Number(el.dataset.kbN)
            el.disabled = n > cap
            el.classList.toggle('is-on', n <= ui.n && n <= cap)
            el.setAttribute('aria-pressed', String(n <= ui.n && n <= cap))
        })
        $('[data-kb-cap]').textContent = !on() ? '' : !b ? __('keys.pick_bot')
            : cap == 0 ? __(ui.side == 'buy' ? 'keys.cap_none_sell' : 'keys.cap_none_buy', { name: b.name || '' })
            : __(ui.side == 'buy' ? 'keys.cap_sell' : 'keys.cap_buy', { name: b.name || '', n: cap })

        const price = unit()
        const n = cap > 0 ? ui.n : Math.min(ui.n, max_keys())
        const total = price ? R(S(price) * n).toFixed(2) : '—'
        const metal = (value) => `<img src="${esc(ref_src)}" alt="" data-no-fade><b>${value}</b> ref`
        const keys = (count) => `<img src="${esc(key_src)}" alt="" data-no-fade><b>${count}</b> ${esc(key_word(count))}`
        $('[data-kb-pay]').innerHTML = ui.side == 'buy' ? metal(total) : keys(n)
        $('[data-kb-get]').innerHTML = ui.side == 'buy' ? keys(n) : metal(total)
        $('[data-kb-each]').textContent = price ? __('keys.each', { price: fmt(price) }) : ''
        const go = $('[data-kb-go]')
        if(go && go.tagName == 'BUTTON'){
            go.disabled = ui.busy || !on() || cap == 0 || window.site_settings?.trading === false
            go.classList.toggle('is-busy', ui.busy)
            go.textContent = ui.busy ? __('keys.requesting') : ui.side == 'buy'
                ? __('keys.request_buy', { what: plural_keys(n), total })
                : __('keys.request_sell', { what: plural_keys(n), total })
        }
    }

    // 7 days of [hour, middle, best buy, best sell] as an SVG: the band between backpack.tf's best automated buy order
    // and cheapest real seller, the middle as a line, the lowest / highest price and the days along the bottom
    const draw_chart = () => {
        const box = $('[data-kb-chart]')
        const h = (status?.history || []).filter((p) => Array.isArray(p) && p[1] > 0)
        const sig = h.length ? `${box.clientWidth}|${h.length}|${h[0][0]}|${h[h.length - 1].join(',')}` : ''
        if(sig == ui.history_sig){ return }
        ui.history_sig = sig
        if(h.length < 2){
            box.innerHTML = `<p class="kb-chart-empty">${esc(box.dataset.empty || '')}</p>`
            return
        }
        // drawn at the box's own width, so the labels keep their size on a phone
        const W = Math.max(280, Math.round(box.clientWidth || 720)), H = 200, L = 46, Rm = 10, T = 14, B = 26
        const t0 = h[0][0], t1 = h[h.length - 1][0]
        let lo = Math.min(...h.map((p) => p[2])), hi = Math.max(...h.map((p) => p[3]))
        if(hi - lo < 0.5){ const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25 }
        const pad = (hi - lo) * 0.12
        lo -= pad; hi += pad
        const x = (t) => L + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - L - Rm)
        const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
        const pt = (t, v) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`
        const band = [...h.map((p) => pt(p[0], p[3])), ...[...h].reverse().map((p) => pt(p[0], p[2]))].join(' ')
        const mid = h.map((p) => pt(p[0], p[1])).join(' ')
        const ticks = [lo + pad, (lo + hi) / 2, hi - pad]
        const day = 24 * 3600 * 1000
        const days = []
        for(let d = Math.ceil(t0 / day) * day; d <= t1; d += day){ days.push(d) }
        // a label at least every 56 px
        const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor((W - L - Rm) / 56))))
        const dayfmt = new Intl.DateTimeFormat(window.TD_LANG || 'en', { weekday: 'short' })
        const last = h[h.length - 1]
        box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(__('keys.chart_label', { lo: fmt(Math.min(...h.map((p) => p[1]))), hi: fmt(Math.max(...h.map((p) => p[1]))), now: fmt(last[1]) }))}">
            ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - Rm}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('')}
            ${days.map((d, i) => `<line class="day" x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${T}" y2="${H - B}"/>${i % every ? '' : `<text class="axis" x="${x(d).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(dayfmt.format(new Date(d)))}</text>`}`).join('')}
            <polygon class="band" points="${band}"/>
            <polyline class="mid" points="${mid}"/>
            <circle class="now" cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3.5"/>
        </svg>`
    }

    const draw = () => { draw_board(); draw_bots(); draw_swap(); draw_chart() }

    // ---------------------------------------------------------------- the status changes

    const update = (next, { fresh = true } = {}) => {
        if(!next || typeof next != 'object'){ return }
        const before = status
        status = next
        if(fresh){ ui.updated = Date.now() }
        // the picked bot left or went offline: the best one instead
        if(!bot_of(ui.bot)?.online){ ui.bot = best_bot()?.steamid || null }
        // the price of the side being looked at moved: say so, the user may be about to press the button
        const was = ui.side == 'buy' ? before?.price?.sell : before?.price?.buy
        const now = unit()
        if(was && now && S(was) != S(now) && !ui.busy){
            const el = root.querySelector(`[data-kb-price="${ui.side == 'buy' ? 'sell' : 'buy'}"]`)
            el?.classList.remove('is-moved'); void el?.offsetWidth; el?.classList.add('is-moved')
        }
        draw()
    }

    // ---------------------------------------------------------------- input

    // buy or sell: the bot that can do the most for that side, unless the visitor picked one that still can
    const set_side = (side) => {
        ui.side = side == 'sell' ? 'sell' : 'buy'
        if(!ui.chosen || cap_of(bot_of(ui.bot)) == 0){ ui.bot = best_bot()?.steamid || ui.bot }
        draw_bots(); draw_swap()
    }

    root.addEventListener('click', (e) => {
        const side = e.target.closest('[data-kb-side]')
        if(side){
            set_side(side.dataset.kbSide)
            return
        }
        const pip = e.target.closest('[data-kb-n]')
        if(pip && !pip.disabled){
            ui.n = Number(pip.dataset.kbN)
            draw_swap()
            return
        }
        if(e.target.closest('[data-kb-go]')){ send() }
    })
    // arrow keys move between the two sides, like radio buttons
    $('.kb-sides').addEventListener('keydown', (e) => {
        if(!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)){ return }
        e.preventDefault()
        set_side(ui.side == 'buy' ? 'sell' : 'buy')
        root.querySelector(`[data-kb-side="${ui.side}"]`)?.focus()
    })
    root.addEventListener('change', (e) => {
        if(e.target.name == 'kb-bot'){
            ui.bot = e.target.value
            ui.chosen = true
            draw_bots(); draw_swap()
        }
    })

    const REASON_KEYS = ['price_changed', 'not_enough_stock', 'bot_unavailable', 'key_bank_off', 'offer_open', 'user_not_enough_keys', 'user_not_enough_metal', 'bank_no_change', 'no_price']
    const send = async () => {
        if(ui.busy || !signed_in){ return }
        if(window.site_settings?.trading === false){
            iziToast.warning({ title: __('site.trading_paused_title'), message: __('site.trading_paused') })
            return
        }
        const b = bot_of(ui.bot)
        const price = unit()
        if(!b || !price){ return }
        ui.busy = true
        draw_swap()
        let res = null
        try {
            const r = await fetch('/api/keys/trade', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ bot: b.steamid, side: ui.side, keys: ui.n, price, hash: typeof user_id != 'undefined' ? user_id : '' })
            })
            res = await r.json().catch(() => null)
        } catch (e) {
            res = null
        }
        ui.busy = false
        if(res?.success == 1){
            draw_swap()
            tradeOfferConnection({ status: 'creating', requested: Date.now() }, 'open')
            iziToast.success({ title: __('keys.requested_title'), message: __('keys.requested', { what: plural_keys(res.keys || ui.n), total: fmt(res.total) }) })
            return
        }
        if(res?.keybank){ update(res.keybank, { fresh: true }) } else { draw_swap() }
        const reason = res?.reason
        if(reason == 'offer_open'){ tradeOfferConnection(localStorage.getItem(`tradeoffer${user}`), 'open') }
        iziToast.error({
            title: reason == 'price_changed' ? __('keys.price_changed_title') : __('common.error'),
            message: reason == 'price_changed' ? __('keys.err.price_changed', { price: fmt(res?.price) })
                : REASON_KEYS.includes(reason) ? __('keys.err.' + reason) : (res?.message || __('trade.create_failed'))
        })
    }

    // ---------------------------------------------------------------- start

    const key_src = root.querySelector('.kb-pip img')?.getAttribute('src') || ''
    const ref_src = root.querySelector('[data-kb-pay] img')?.getAttribute('src') || ''
    ui.bot = best_bot()?.steamid || null
    draw()

    if(typeof socket != 'undefined'){
        const watch = () => socket.emit('keybank:watch', (s) => update(s))
        socket.on('keybank:status', (s) => update(s))
        socket.on('connect', watch)
        watch()
    }
    let resize_timer = null
    window.addEventListener('resize', () => { clearTimeout(resize_timer); resize_timer = setTimeout(draw_chart, 200) })

    // "updated 20 s ago" and, without the socket, a fresh look every minute
    setInterval(draw_live, 5000)
    setInterval(() => {
        if(typeof socket != 'undefined' && socket.connected){ return }
        fetch('/api/keys', { headers: { 'Accept': 'application/json' } }).then((r) => r.ok ? r.json() : null).then((r) => r?.keybank && update(r.keybank)).catch(() => {})
    }, 60 * 1000)
}

export { init_keys }
