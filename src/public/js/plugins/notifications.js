// The bell in the nav (view/partials/nav.ejs, styles: scss/partials/_notifications.scss).
//
// Signed-in users only (giveaways need an account). Lists the latest notifications from /api/notifications:
// the ones for everyone (new giveaway, giveaway winner, announcements from the admin panel) and the user's own
// (they won a giveaway, support replied). The red count is what came in since the panel was last opened, saved
// on the account. New ones arrive live over the site socket.

const state = {
    items: [],
    seen: 0,
    loaded: false,
    loading: null,
    open_bell: null
}

const logged_in = () => typeof user != 'undefined' && user != 'no_session'
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const panel = () => document.getElementById('notif-panel')
const bells = () => document.querySelectorAll('[data-notif-bell]')

const ICONS = {
    gift: '<path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a2 2 0 0 0-2 2v3h20V9a2 2 0 0 0-2-2zM9 7a1 1 0 1 1 1-1v1zm6 0h-1V6a1 1 0 1 1 1 1zM3 14v6a2 2 0 0 0 2 2h6v-8zm10 8h6a2 2 0 0 0 2-2v-6h-8z"/>',
    trophy: '<path d="M19 4h-2V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 5 5 5 0 0 0 3.6 3.9V18H8a1 1 0 0 0-1 1v2h10v-2a1 1 0 0 0-1-1h-3v-2.1a5 5 0 0 0 3.6-3.9A5 5 0 0 0 21 7V6a2 2 0 0 0-2-2zM5 7V6h2v4a3 3 0 0 1-2-3zm14 0a3 3 0 0 1-2 3V6h2z"/>',
    chat: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>',
    megaphone: '<path d="M18 3v2.2L7.6 8H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1l1.5 5h3L8 16l10 2.8V21h2V3zm-4 9z"/>'
}
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`

// item names stay English (like everywhere else on the site)
const item_html = (name) => `<b translate="no">${esc(name)}</b>`

// title, text and icon for one notification, in the page's language
const describe = (n) => {
    const v = n.vars || {}
    switch (n.type) {
        case 'giveaway_new':
            return { icon: 'gift', title: __('notifications.giveaway_new_title'), text: __('notifications.giveaway_new', { item: item_html(v.item) }) }
        case 'giveaway_ended':
            return { icon: 'trophy', title: __('notifications.giveaway_ended_title'), text: v.winner
                ? __('notifications.giveaway_ended', { winner: `<b>${esc(v.winner)}</b>`, item: item_html(v.item) })
                : __('notifications.giveaway_ended_nowinner', { item: item_html(v.item) }) }
        case 'giveaway_won':
            return { icon: 'trophy', title: __('notifications.giveaway_won_title'), text: __('notifications.giveaway_won', { item: item_html(v.item) }) }
        case 'ticket_reply':
            return { icon: 'chat', title: __('notifications.ticket_reply_title'), text: __('notifications.ticket_reply') }
        default:
            return { icon: 'megaphone', title: __('notifications.announcement_title'), text: esc(n.text) }
    }
}

const relative = (time) => {
    const diff = (time - Date.now()) / 1000
    if(Math.abs(diff) < 60){ return __('notifications.just_now') }
    let rtf
    try { rtf = new Intl.RelativeTimeFormat(window.TD_LANG || 'en', { numeric: 'auto' }) } catch (e) { return new Date(time).toLocaleString() }
    for (const [unit, sec] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
        if(Math.abs(diff) >= sec){ return rtf.format(Math.round(diff / sec), unit) }
    }
    return __('notifications.just_now')
}

const unread = () => state.items.filter((n) => n.created > state.seen).length

const render_count = () => {
    const count = unread()
    bells().forEach((bell) => {
        const badge = bell.querySelector('.nav-bell-count')
        if(badge){
            badge.hidden = count == 0
            badge.textContent = count > 9 ? '9+' : String(count)
        }
        bell.classList.toggle('has-unread', count > 0)
    })
}

const render_list = (seen_before) => {
    const list = document.getElementById('notif-list')
    if(!list){ return }
    if(!state.loaded){
        list.innerHTML = `<div class="notif-empty"><span class="notif-spinner"></span></div>`
        return
    }
    if(state.items.length == 0){
        list.innerHTML = `<div class="notif-empty">${icon('megaphone')}<span>${esc(__('notifications.empty'))}</span></div>`
        return
    }
    list.innerHTML = state.items.map((n) => {
        const d = describe(n)
        const external = /^https:\/\//.test(n.link)
        const href = n.link ? (external ? n.link : window.lurl(n.link)) : ''
        const tag = href ? 'a' : 'div'
        const attrs = href ? ` href="${esc(href)}"${external ? ' target="_blank" rel="noopener nofollow"' : ''}` : ''
        return `<${tag} class="notif-item type-${esc(n.type)}${n.created > seen_before ? ' unread' : ''}"${attrs}>
            <span class="notif-icon">${icon(d.icon)}</span>
            <span class="notif-body">
                <strong>${esc(d.title)}</strong>
                <span class="notif-text">${d.text}</span>
                <time datetime="${new Date(n.created).toISOString()}">${esc(relative(n.created))}</time>
            </span>
        </${tag}>`
    }).join('')
}

const load = () => {
    if(state.loading){ return state.loading }
    state.loading = fetch('/api/notifications', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
        .then((res) => res.json())
        .then((res) => {
            if(res?.status != 'ok'){ return }
            state.items = Array.isArray(res.items) ? res.items : []
            state.seen = Number(res.seen) || 0
            state.loaded = true
            render_count()
            if(state.open_bell){ render_list(state.open_seen ?? state.seen) }
        })
        .catch(() => {})
        .finally(() => { state.loading = null })
    return state.loading
}

// everything shown is now read: the count goes away, the highlight stays until the panel closes
const mark_seen = () => {
    const newest = state.items.reduce((max, n) => Math.max(max, n.created), 0)
    if(!newest || newest <= state.seen){ return }
    state.seen = newest
    render_count()
    fetch('/api/notifications/seen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: '{}' }).catch(() => {})
}

const place = (bell) => {
    const el = panel()
    const rect = bell.getBoundingClientRect()
    el.style.top = `${Math.round(rect.bottom + 10)}px`
    if(window.innerWidth <= 677){
        el.style.left = '12px'
        el.style.right = '12px'
    } else {
        el.style.left = 'auto'
        el.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`
    }
}

const open = (bell) => {
    const el = panel()
    if(!el){ return }
    state.open_bell = bell
    state.open_seen = state.seen
    place(bell)
    el.hidden = false
    el.classList.remove('is-open')
    void el.offsetWidth
    el.classList.add('is-open')
    bells().forEach((b) => b.setAttribute('aria-expanded', String(b == bell)))
    render_list(state.open_seen)
    const ready = state.loaded ? Promise.resolve() : load()
    ready.then(() => { if(state.open_bell == bell){ mark_seen() } })
}

const close = () => {
    const el = panel()
    if(!el || el.hidden){ return }
    el.hidden = true
    el.classList.remove('is-open')
    state.open_bell = null
    state.open_seen = null
    bells().forEach((b) => b.setAttribute('aria-expanded', 'false'))
}

const ring = () => {
    bells().forEach((bell) => {
        bell.classList.remove('ring')
        void bell.offsetWidth
        bell.classList.add('ring')
    })
}

document.addEventListener('click', (e) => {
    const bell = e.target.closest?.('[data-notif-bell]')
    if(bell){
        e.preventDefault()
        if(state.open_bell == bell){ close() } else { open(bell) }
        return
    }
    if(state.open_bell && !e.target.closest?.('#notif-panel')){ close() }
    if(e.target.closest?.('#notif-panel a')){ close() }
})
document.addEventListener('keydown', (e) => {
    if(e.key == 'Escape' && state.open_bell){
        const bell = state.open_bell
        close()
        bell.focus()
    }
})
window.addEventListener('resize', () => { if(state.open_bell){ place(state.open_bell) } })
window.addEventListener('scroll', () => { if(state.open_bell && window.scrollY > 75){ close() } }, { passive: true })

// live updates over the site socket (service/notifications.js)
if(logged_in() && panel()) try {
    socket.on('notification', (n) => {
        if(!n?.id || state.items.some((x) => x.id == n.id)){ return }
        state.items = [n, ...state.items].slice(0, 20)
        if(state.open_bell){
            render_list(state.open_seen)
            mark_seen()
        } else {
            render_count()
            ring()
        }
    })
    socket.on('notifications:refresh', () => {
        const before = unread()
        load().then(() => { if(unread() > before && !state.open_bell){ ring() } })
    })
} catch (error) {}

const start = () => { if(logged_in() && panel()){ load() } }
if(document.readyState == 'loading'){
    document.addEventListener('DOMContentLoaded', start)
} else {
    start()
}
