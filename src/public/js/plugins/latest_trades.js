import { render_trade, timeAgoTrade } from './trades_render.js'

// Home page "Latest trades": the newest 5, "Show 5 more" twice (15 in total), and trades that happen while the page
// is open appear on top as they come in (site socket, service/latest_trades.js on the server).

const STEP = 5

const init_latest_trades = async (box) => {
    const list_el = box.querySelector('.trades')
    const more_btn = box.querySelector('.trades-more')
    const shown = new Set() // ids of the trades on the page

    const element = (trade) => {
        const html = trade?.id ? render_trade(trade) : ''
        if(!html){ return null }
        const tpl = document.createElement('template')
        tpl.innerHTML = html.trim()
        const el = tpl.content.firstElementChild
        el.dataset.id = trade.id
        return el
    }

    const message = (text) => { list_el.innerHTML = `<div class="info fade-in">${text}</div>` }

    let res
    try {
        res = await fetch('/api/latest_trades').then((r) => r.ok ? r.json() : Promise.reject(r.status))
    } catch (e) {
        message(__('home.trades_error'))
        return
    }

    list_el.innerHTML = ''
    for (const trade of (res?.trades || [])) {
        if(shown.has(trade?.id)){ continue }
        const el = element(trade)
        if(!el){ continue }
        el.hidden = shown.size >= STEP
        shown.add(trade.id)
        list_el.append(el)
    }
    if(!shown.size){ message(__('home.no_trades')) }

    // "Show 5 more" opens the next 5 of the 15 loaded, so it is there twice at most
    const update_more = () => { more_btn.hidden = !list_el.querySelector(':scope > .trade[hidden]') }
    more_btn.addEventListener('click', () => {
        list_el.querySelectorAll(':scope > .trade[hidden]').forEach((el, i) => { if(i < STEP){ el.hidden = false } })
        update_more()
    })
    update_more()

    const add_live = (trade) => {
        if(!trade?.id || shown.has(trade.id)){ return }
        const el = element(trade)
        if(!el){ return }
        shown.add(trade.id)
        el.classList.add('trade-new')
        list_el.querySelector(':scope > .info')?.remove()
        list_el.prepend(el)
    }

    // the server answers with its current list: anything not on the page yet came in while we were away
    const watch = () => socket.emit('latest_trades:watch', (list) => {
        (Array.isArray(list) ? list : []).filter((t) => !shown.has(t?.id)).sort((a, b) => a.timestamp - b.timestamp).forEach(add_live)
    })
    socket.on('latest_trade', add_live)
    socket.on('connect', watch)
    watch()

    // keep "5 minutes ago" correct while the page stays open
    setInterval(() => {
        list_el.querySelectorAll('.time-ago[data-time]').forEach((el) => { el.textContent = timeAgoTrade(Number(el.dataset.time)) })
    }, 30 * 1000)
}

export { init_latest_trades }
