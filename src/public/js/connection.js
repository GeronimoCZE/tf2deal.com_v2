// A small notice in the corner when the open page can't be trusted to be live:
//   offline       the browser has no internet connection
//   reconnecting  the site socket (trade updates, live settings, latest trades) has been down for a few seconds
//   update        the site was updated after this page was loaded (service/site_version.js), offers a reload
//   back          a short "connected again" after offline or reconnecting
// Loaded with defer right after js/socket.js. Texts: js.connection in src/locales.
(() => {
    const SHOW_AFTER = 5000   // a short drop (a site restart, a network switch) shows nothing
    const FIRST_WAIT = 10000  // the first connection on a slow phone can take a while
    const BACK_FOR = 3000
    const page_version = window.TD_VERSION || ''

    let sock = null
    try { sock = socket } catch (e) {} // js/socket.js failed (no socket.io): only the offline notice works

    let offline = navigator.onLine === false
    let show_at = sock && !sock.connected ? Date.now() + FIRST_WAIT : null // when a socket drop gets shown
    let server_version = sock?.site_version || null
    let dismissed = null // the server version whose update notice was closed
    let back_until = 0
    let shown = null
    let timer = null

    // after a reload for a version the page still doesn't have (an old copy from a cache), don't offer it again
    const reloaded_for = () => { try { return sessionStorage.getItem('td_reload_for') } catch (e) { return null } }

    const bar = document.createElement('div')
    bar.className = 'connection-bar'
    bar.id = 'connection-bar'
    bar.setAttribute('role', 'status')
    bar.setAttribute('aria-live', 'polite') // stays in the page (empty while nothing is wrong), so screen readers hear each change
    document.body.appendChild(bar)

    const text = (key) => __('connection.' + key)
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

    const VIEWS = {
        offline: () => ({ title: text('offline_title'), body: text('offline_text') }),
        reconnecting: () => ({ title: text('reconnecting_title'), body: text('reconnecting_text') }),
        update: () => ({ title: text('update_title'), body: text('update_text'), reload: true, close: true }),
        back: () => ({ title: text('back') }),
    }

    const problem = () => shown == 'offline' || shown == 'reconnecting'

    const state = () => {
        if (offline) { return 'offline' }
        const down = sock && !sock.connected && show_at != null
        if (down && (problem() || Date.now() >= show_at)) { return 'reconnecting' }
        if (server_version && page_version && server_version != page_version && dismissed != server_version && reloaded_for() != server_version) { return 'update' }
        if (Date.now() < back_until) { return 'back' }
        if (problem() && (!sock || sock.connected)) { back_until = Date.now() + BACK_FOR; return 'back' }
        return null
    }

    // keep clear of the cookie banner while it is up (both sit at the bottom of the screen)
    const place = () => {
        const banner = document.querySelector('.cookie-banner')
        let bottom = ''
        if (banner && !banner.classList.contains('cookie-hidden') && getComputedStyle(banner).display != 'none') {
            const top = banner.getBoundingClientRect().top
            if (top > 0 && top < window.innerHeight) { bottom = Math.round(window.innerHeight - top + 8) + 'px' }
        }
        bar.style.bottom = bottom
    }

    const render = () => {
        clearTimeout(timer)
        const next = state()
        if (next != shown) {
            shown = next
            if (next) {
                const v = VIEWS[next]()
                bar.dataset.state = next
                bar.innerHTML = `<span class="connection-dot" aria-hidden="true"></span>`
                    + `<span class="connection-text"><strong>${esc(v.title)}</strong>${v.body ? `<span>${esc(v.body)}</span>` : ''}</span>`
                    + (v.reload ? `<button type="button" class="connection-reload">${esc(text('reload'))}</button>` : '')
                    + (v.close ? `<button type="button" class="connection-close" aria-label="${esc(text('close'))}">&times;</button>` : '')
                place()
                bar.classList.add('show')
            } else {
                bar.classList.remove('show')
                // emptied after the fade, so its buttons are out of the way of the keyboard
                setTimeout(() => { if (!shown) { bar.innerHTML = ''; delete bar.dataset.state } }, 300)
            }
        }
        // wake up for the next change that only time brings
        const now = Date.now()
        const due = [show_at, back_until].filter((t) => t && t > now)
        if (due.length) { timer = setTimeout(render, Math.min(...due) - now + 20) }
    }

    bar.addEventListener('click', (e) => {
        if (e.target.closest('.connection-reload')) {
            try { sessionStorage.setItem('td_reload_for', server_version) } catch (err) {}
            location.reload()
        } else if (e.target.closest('.connection-close')) {
            dismissed = server_version
            render()
        }
    })

    window.addEventListener('offline', () => { offline = true; render() })
    window.addEventListener('online', () => {
        offline = false
        if (sock && !sock.connected && show_at == null) { show_at = Date.now() + SHOW_AFTER }
        render()
    })
    window.addEventListener('resize', () => { if (shown) { place() } })
    // a page brought back with the back button: it may be from before an update; the socket reconnects (js/socket.js)
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) { return }
        offline = navigator.onLine === false
        back_until = 0
        shown = null
        bar.classList.remove('show')
        bar.innerHTML = ''
        if (sock && !sock.connected) { show_at = Date.now() + FIRST_WAIT }
        render()
    })
    const banner = document.querySelector('.cookie-banner')
    if (banner && window.MutationObserver) {
        new MutationObserver(() => { if (shown) { place() } }).observe(banner, { attributes: true, attributeFilter: ['class', 'style'] })
    }

    if (sock) {
        sock.on('connect', () => { show_at = null; render() })
        sock.on('disconnect', (reason) => {
            // our own disconnect (the visitor leaves the page, js/socket.js) is not a lost connection
            show_at = reason == 'io client disconnect' ? null : Date.now() + SHOW_AFTER
            render()
        })
        sock.on('connect_error', () => {
            if (show_at == null && sock.active) { show_at = Date.now() + SHOW_AFTER }
            render()
        })
        sock.on('site_version', (version) => { server_version = version; render() })
    }

    render()
})()
