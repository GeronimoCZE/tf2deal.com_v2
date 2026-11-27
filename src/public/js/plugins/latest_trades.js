import { render_trade, timeAgoTrade } from './trades_render.js'

// Home page "Latest trades": today's trades, newest on top, one under the other. The newest 5 first, and "Show 5 more"
// loads the next 5 for as long as today has more (Nikolas 2026-11-27: no limit, only trades made today). Trades that
// happen while the page is open appear on top as they come in (site socket, service/latest_trades.js on the server).
// "Today" starts at midnight UTC, like the "N today" under the trade total above, by the server's clock (the visitor's
// may be off); a page left open past it drops the day before's trades.

const DAY_MS = 24 * 60 * 60 * 1000
// midnight UTC of the day `time` falls in, in ms (service/latest_trades.js start_of_day)
const start_of_day = (time) => {
    const d = new Date(time)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

const init_latest_trades = async (box) => {
    const list_el = box.querySelector('.trades')
    const more_btn = box.querySelector('.trades-more')
    const foot_el = box.querySelector('.trades-foot')
    const count_el = box.querySelector('.trades-count')
    const shown = new Set() // ids of the trades on the page
    let count = 0 // today's trades, as the server last counted them (plus the live ones since)
    let more = false
    let day = 0 // when today started, and how far the server's clock is from ours (the server says both)
    let offset = 0

    const element = (trade) => {
        const html = trade?.id ? render_trade(trade) : ''
        if(!html){ return null }
        const tpl = document.createElement('template')
        tpl.innerHTML = html.trim()
        const el = tpl.content.firstElementChild
        el.dataset.id = trade.id
        el.dataset.time = Number(trade.timestamp) || 0
        return el
    }

    const message = (text) => { list_el.innerHTML = `<div class="info fade-in">${text}</div>` }

    // "Show 5 more" while today has more, with "15 of 42 trades today" under it (like the /items page)
    const foot = () => {
        foot_el.hidden = !more
        more_btn.hidden = !more
        const lang = document.documentElement.lang || undefined
        count_el.textContent = (more && count > shown.size)
            ? __('home.trades_shown', { shown: shown.size.toLocaleString(lang), count: count.toLocaleString(lang) }) : ''
    }

    // the last trade loaded by "Show 5 more" (not a live one), so the server knows where to go on
    let last = null
    const load = async () => {
        const query = last ? `?after=${encodeURIComponent(last.id)}&before=${Number(last.timestamp) || 0}` : ''
        const res = await fetch('/api/latest_trades' + query).then((r) => r.ok ? r.json() : Promise.reject(r.status))
        if(Number(res?.now) > 0){ offset = Number(res.now) - Date.now() }
        if(Number(res?.day) > 0){ day = Number(res.day) }
        for (const trade of (res?.trades || [])) {
            last = trade
            if(shown.has(trade?.id)){ continue }
            const el = element(trade)
            if(!el){ continue }
            shown.add(trade.id)
            list_el.append(el)
        }
        more = res?.more === true
        count = Math.max(Number(res?.count) || 0, shown.size)
        foot()
    }

    try {
        await load().finally(() => list_el.querySelector(':scope > .skeleton')?.remove())
    } catch (e) {
        message(__('home.trades_error'))
        return
    }
    if(!shown.size){ message(__('home.no_trades_today')) }

    more_btn.addEventListener('click', async () => {
        more_btn.disabled = true
        try { await load() } catch (e) { /* the button stays, so it can be tried again */ }
        more_btn.disabled = false
    })

    const add_live = (trade) => {
        if(!trade?.id || shown.has(trade.id) || Number(trade.timestamp) < day){ return }
        const el = element(trade)
        if(!el){ return }
        shown.add(trade.id)
        count++
        el.classList.add('trade-new')
        list_el.querySelector(':scope > .info')?.remove()
        list_el.prepend(el)
        foot()
    }

    // the server answers with today's newest trades: anything not on the page yet came in while we were away
    const watch = () => socket.emit('latest_trades:watch', (list) => {
        (Array.isArray(list) ? list : []).filter((t) => !shown.has(t?.id)).sort((a, b) => a.timestamp - b.timestamp).forEach(add_live)
    })
    socket.on('latest_trade', add_live)
    socket.on('connect', watch)
    watch()

    // a new day (UTC) while the page is open: the day before's trades leave, and "Show 5 more" starts from today's
    const new_day = () => {
        const now = Date.now() + offset
        if(!(day > 0) || now < day + DAY_MS){ return }
        day = start_of_day(now)
        list_el.querySelectorAll(':scope > .trade[data-time]').forEach((el) => {
            if(Number(el.dataset.time) < day){ shown.delete(el.dataset.id); el.remove() }
        })
        last = null
        more = false
        count = shown.size
        foot()
        if(!shown.size){ message(__('home.no_trades_today')) }
    }

    // keep "5 minutes ago" correct while the page stays open
    setInterval(() => {
        new_day()
        list_el.querySelectorAll('.time-ago[data-time]').forEach((el) => { el.textContent = timeAgoTrade(Number(el.dataset.time)) })
    }, 30 * 1000)
}

export { init_latest_trades }
