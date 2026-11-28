// The chat helper's window (views/partials/assistant.ejs, styles: scss/partials/_assistant.scss). The answers come from
// POST /api/assistant/chat (api/routes/assistant.js -> service/assistant.js), which keeps the chat itself on the
// server: this page only holds a random id for it, plus what it showed (sessionStorage), so the chat is still there on
// the next page of the visit.
//
// What an answer can draw here, and nothing more: text with **bold**, lists and links to the site (or its community
// pages), item cards (link to the item page) and one trade card. Everything is built from text (textContent or escaped),
// never from HTML in the answer, and every link is checked again here (allowed_link) whatever the server let through.
// The trade card's button sends the same request as a direct buy link (trade.create_trade('single_item')): the server
// checks it all again and the bot's Steam offer still has to be accepted in Steam.
import * as trade from "./trade.js";

const root = document.getElementById('tdAssistant')
const STORE = 'td_assistant'
const MAX = 600
const PHONE = window.matchMedia('(max-width: 640px)')
const T = (key, vars) => __('assistant.' + key, vars)

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* ========================= LINKS ========================= */

// the same rule as the server (service/assistant_firewall.js safe_link): a path on the site, the site's own address,
// or the community pages the site links to
const COMMUNITY = [
    ['steamcommunity.com', /^\/groups\/tradetf2deal(\/|$)/i],
    ['discord.gg', /^\/br3WvWaW5y\/?$/],
    ['reddit.com', /^\/r\/tf2deal(\/|$)/i],
    ['www.reddit.com', /^\/r\/tf2deal(\/|$)/i],
    ['www.trustpilot.com', /^\/review\/tf2deal\.com/i],
    ['backpack.tf', /^\//],
    ['wiki.teamfortress.com', /^\//]
]
const LANG_PREFIX = /^\/(cs|de|es|fr|pt|ru|zh)(\/|$)/
// -> { href, external } or null
const allowed_link = (url) => {
    const value = String(url || '').trim()
    if (/^\/(?![\/\\])[^\s<>"'`]*$/.test(value)) return { href: LANG_PREFIX.test(value) ? value : lurl(value), external: false }
    let parsed
    try { parsed = new URL(value) } catch (e) { return null }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
    const host = parsed.host.toLowerCase()
    if (host === location.host || host === 'tf2deal.com' || host === 'www.tf2deal.com') return { href: parsed.href, external: false }
    if (COMMUNITY.some(([h, path]) => h === host && path.test(parsed.pathname))) return { href: parsed.href, external: true }
    return null
}
const link_html = (label, url) => {
    const link = allowed_link(url)
    if (!link) return label
    return `<a href="${esc(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
}

/* ========================= TEXT ========================= */

// one line of an answer: escaped first, then **bold**, [label](link) and bare https links
const inline = (line) => {
    let html = esc(line)
    html = html.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,600})\)/g, (all, label, url) => link_html(label, url.replace(/&amp;/g, '&')))
    html = html.replace(/(^|[\s(])(https:\/\/[^\s<>()"'`]+)/g, (all, before, url) => {
        const clean = url.replace(/[.,;:!?]+$/, '')
        const raw = clean.replace(/&amp;/g, '&')
        return allowed_link(raw) ? before + link_html(clean, raw) + url.slice(clean.length) : all
    })
    return html.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
}

// an answer: paragraphs (blank lines), "- " / "* " / "1. " lists
const answer_html = (text) => {
    const blocks = String(text || '').trim().split(/\n{2,}/)
    return blocks.map((block) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
        if (!lines.length) return ''
        const bullets = lines.every((l) => /^[-*•]\s+/.test(l))
        const numbers = lines.every((l) => /^\d{1,2}[.)]\s+/.test(l))
        if (bullets) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`
        if (numbers) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d{1,2}[.)]\s+/, ''))}</li>`).join('')}</ol>`
        // a lead-in line followed by a list
        const first_bullet = lines.findIndex((l) => /^[-*•]\s+/.test(l))
        if (first_bullet > 0 && lines.slice(first_bullet).every((l) => /^[-*•]\s+/.test(l))) {
            return `<p>${lines.slice(0, first_bullet).map(inline).join('<br>')}</p><ul>${lines.slice(first_bullet).map((l) => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`
        }
        return `<p>${lines.map(inline).join('<br>')}</p>`
    }).join('')
}

/* ========================= CARDS ========================= */

const STEAM_IMG = /^https:\/\/[a-z0-9.-]+\.(steamstatic\.com|akamaihd\.net|steamcommunity\.com|steampowered\.com)\//i
const picture = (card) => {
    const src = typeof card.image == 'string' && STEAM_IMG.test(card.image) ? card.image : ''
    const effect = Number(card.effectID) > 0 ? ` style="background-image: url(https://api.backpack.tf/images/440/particles/${Number(card.effectID)}_94x94.png)"` : ''
    return src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async"${effect}>` : ''
}
const quality = (card) => /^\d{1,2}$/.test(String(card.qualityID)) ? ` q-${card.qualityID}` : ''
const site_path = (href) => allowed_link(href)?.external === false ? allowed_link(href).href : lurl('/items')

const item_card = (card) => {
    const stock = Number(card.stock) || 0
    const meta = stock > 0
        ? `<b>${esc(card.price)}</b><span>${esc(T('in_stock', { n: stock }))}</span>`
        : `<span>${esc(T('out_of_stock'))}</span>${card.bots_pay ? `<span>${esc(T('bots_pay', { price: card.bots_pay }))}</span>` : ''}`
    return `<a class="as-item${quality(card)}" href="${esc(site_path(card.href))}">
        <span class="as-thumb">${picture(card)}</span>
        <span class="as-item-body"><span class="as-item-name">${esc(card.name)}</span><span class="as-item-meta">${meta}</span></span>
        <svg class="as-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.4 6-1.4 1.4 4.6 4.6-4.6 4.6L9.4 18l6-6z"/></svg>
    </a>`
}

const trade_card = (card, index) => {
    const details = Array.isArray(card.details) ? card.details.filter((d) => typeof d == 'string').slice(0, 8) : []
    const from = [card.bot_name ? __('buy_link.from_bot', { name: card.bot_name }) : '', Number(card.copies) > 0 ? T('in_stock', { n: Number(card.copies) }) : ''].filter(Boolean).join(' · ')
    let action
    if (card.requested) {
        action = `<p class="as-done" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>${esc(T('requested'))}</p>`
    } else if (card.sign_in || typeof user == 'undefined' || user === 'no_session') {
        action = `<a class="as-signin" href="/auth/steam" data-as-leave>${esc(__('buy_link.sign_in'))}</a><p class="as-trade-note">${esc(__('buy_link.sign_in_note'))}</p>`
    } else {
        action = `<button type="button" class="as-request" data-as-request="${index}">${esc(__('buy_link.request'))}</button><p class="as-trade-note">${esc(__('buy_link.note'))}</p>`
    }
    return `<div class="as-trade${quality(card)}">
        <div class="as-trade-top">
            <a class="as-thumb as-thumb-lg" href="${esc(site_path(card.href))}" tabindex="-1" aria-hidden="true">${picture(card)}</a>
            <div class="as-trade-words">
                <a class="as-item-name" href="${esc(site_path(card.href))}">${esc(card.name)}</a>
                ${details.length ? `<p class="as-trade-details">${details.map(esc).join(' · ')}</p>` : ''}
                ${from ? `<p class="as-trade-from">${esc(from)}</p>` : ''}
            </div>
            <p class="as-trade-price">${esc(card.price)}</p>
        </div>
        ${action}
    </div>`
}

/* ========================= THE CHAT ========================= */

const random_id = () => {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// { chat, items: [{ role: 'you' | 'helper' | 'note', text, cards, reason, turns_left }], open }
let state = { chat: random_id(), items: [], open: false }
const load = () => {
    try {
        const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null')
        if (saved && typeof saved.chat == 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(saved.chat) && Array.isArray(saved.items)) {
            state = { chat: saved.chat, items: saved.items.slice(-60), open: saved.open === true }
        }
    } catch (e) {}
}
const save = () => {
    try { sessionStorage.setItem(STORE, JSON.stringify(state)) } catch (e) {}
}

const init = () => {
    if (!root) return
    const launcher = root.querySelector('#assistantLauncher')
    const panel = root.querySelector('#assistantPanel')
    const log = root.querySelector('#assistantLog')
    const intro = log.querySelector('.as-intro')
    const form = root.querySelector('#assistantForm')
    const input = root.querySelector('#assistantInput')
    const send_btn = root.querySelector('.as-send')
    const new_btn = root.querySelector('[data-as-new]')
    let waiting = false
    let typing = null
    let last_question = ''

    load()

    // The cookie banner sits at the bottom of the screen until it's answered and would cover the button and the text
    // field: while it's there, both sit above it (--as-lift, scss/partials/_assistant.scss)
    const banner = document.getElementById('cookie-banner')
    const lift = () => {
        const box = banner && !banner.classList.contains('cookie-hidden') ? banner.getBoundingClientRect() : null
        root.style.setProperty('--as-lift', box && box.height > 0 ? Math.ceil(box.height + 12) + 'px' : '0px')
    }
    lift()
    if (banner) new MutationObserver(lift).observe(banner, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('resize', lift, { passive: true })

    /* --- drawing --- */

    const scroll_end = () => { log.scrollTop = log.scrollHeight }

    const item_el = (item, index) => {
        const el = document.createElement('div')
        if (item.role === 'you') {
            el.className = 'as-msg as-you'
            el.innerHTML = `<span class="sr-only">${esc(T('you'))}: </span>`
            el.append(document.createTextNode(item.text))
            return el
        }
        if (item.role === 'note') {
            el.className = 'as-msg as-note-msg'
            el.innerHTML = `<p>${esc(item.text)}</p>`
            if (item.reason === 'turns' || item.reason === 'bad_chat') el.innerHTML += `<button type="button" class="as-inline-btn" data-as-new>${esc(T('new_chat'))}</button>`
            else if (item.retry && index === state.items.length - 1) el.innerHTML += `<button type="button" class="as-inline-btn" data-as-retry>${esc(T('retry'))}</button>`
            return el
        }
        el.className = 'as-msg as-helper'
        const cards = Array.isArray(item.cards) ? item.cards : []
        const items = cards.filter((c) => c?.kind === 'item').slice(0, 4)
        const trades = cards.filter((c) => c?.kind === 'trade').slice(0, 1)
        el.innerHTML = `<span class="sr-only">${esc(T('helper'))}: </span>`
            + (item.text ? `<div class="as-text">${answer_html(item.text)}</div>` : '')
            + (items.length ? `<div class="as-cards">${items.map(item_card).join('')}</div>` : '')
            + trades.map((card) => trade_card(card, index)).join('')
            + (Number(item.turns_left) > 0 && Number(item.turns_left) <= 3 && index === state.items.length - 1 ? `<p class="as-turns">${esc(T('turns_left', { n: item.turns_left }))}</p>` : '')
        return el
    }

    // keep: stay where the visitor scrolled to (a trade card that changed), else go to the newest message
    const draw = (keep = false) => {
        const top = log.scrollTop
        log.querySelectorAll('.as-msg').forEach((el) => el.remove())
        intro.hidden = state.items.length > 0
        new_btn.hidden = state.items.length === 0
        state.items.forEach((item, index) => log.append(item_el(item, index)))
        if (typing) log.append(typing)
        if (keep) log.scrollTop = top
        else scroll_end()
    }

    const add = (item) => {
        // a retry note only stays until the next message
        state.items = state.items.filter((it, i) => !(it.role === 'note' && it.retry && i === state.items.length - 1))
        state.items.push(item)
        state.items = state.items.slice(-60)
        save()
        draw()
    }

    const set_waiting = (on) => {
        waiting = on
        send_btn.disabled = on
        input.setAttribute('aria-busy', on ? 'true' : 'false')
        if (on) {
            typing = document.createElement('div')
            typing.className = 'as-msg as-helper as-typing'
            typing.innerHTML = `<span class="as-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">${esc(T('typing'))}</span>`
            log.append(typing)
        } else {
            typing?.remove()
            typing = null
        }
        scroll_end()
    }

    /* --- open / close --- */

    const lock_page = (on) => document.documentElement.classList.toggle('as-open', on && PHONE.matches)

    const open = (focus = true) => {
        panel.hidden = false
        launcher.hidden = true
        launcher.setAttribute('aria-expanded', 'true')
        requestAnimationFrame(() => panel.classList.add('show'))
        state.open = true
        save()
        lock_page(true)
        draw()
        // on a phone the keyboard would cover the greeting, so the chat gets the focus, not the text field
        if (focus) (PHONE.matches ? log : input).focus({ preventScroll: true })
    }
    const close = (focus = true) => {
        panel.classList.remove('show')
        panel.hidden = true
        launcher.hidden = false
        launcher.setAttribute('aria-expanded', 'false')
        state.open = false
        save()
        lock_page(false)
        if (focus) launcher.focus({ preventScroll: true })
    }

    launcher.addEventListener('click', () => open())
    window.addEventListener('td:assistant-open', () => { if (panel.hidden) open() ; else input.focus() })
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close() } })
    PHONE.addEventListener?.('change', () => lock_page(!panel.hidden))

    /* --- sending --- */

    const resize = () => {
        input.style.height = 'auto'
        input.style.height = Math.min(input.scrollHeight, 132) + 'px'
    }
    input.addEventListener('input', resize)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })) }
    })

    const ask = async (text) => {
        const message = String(text || '').trim().slice(0, MAX)
        if (!message || waiting) return
        last_question = message
        add({ role: 'you', text: message })
        set_waiting(true)
        const stop = new AbortController()
        const timer = setTimeout(() => stop.abort(), 65000)
        try {
            const res = await fetch('/api/assistant/chat', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ chat: state.chat, message, page: window.TD_PATH || location.pathname, lang: window.TD_LANG || 'en' }),
                signal: stop.signal
            })
            const data = await res.json().catch(() => null)
            set_waiting(false)
            if (res.status === 404 && data?.reason === 'off') { root.remove(); document.documentElement.classList.remove('as-open'); return } // switched off meanwhile
            if (data?.status === 'ok' && data.reply) {
                add({ role: 'helper', text: String(data.reply.text || ''), cards: Array.isArray(data.reply.cards) ? data.reply.cards : [], turns_left: Number(data.turns_left) || 0 })
                return
            }
            const reason = typeof data?.reason == 'string' ? data.reason : 'unavailable'
            add({ role: 'note', text: data?.message || T('offline'), reason, retry: ['busy_api', 'unavailable', 'too_long_to_answer'].includes(reason) })
        } catch (e) {
            set_waiting(false)
            add({ role: 'note', text: T('offline'), reason: 'offline', retry: true })
        } finally {
            clearTimeout(timer)
        }
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault()
        const text = input.value
        if (!text.trim() || waiting) return
        input.value = ''
        resize()
        ask(text)
    })

    const new_chat = () => {
        const old = state.chat
        state = { chat: random_id(), items: [], open: true }
        save()
        draw()
        input.focus()
        fetch('/api/assistant/reset', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: old }) }).catch(() => {})
    }

    /* --- clicks inside the window --- */

    panel.addEventListener('click', async (e) => {
        if (e.target.closest('[data-as-close]')) return close()
        if (e.target.closest('[data-as-new]')) return new_chat()
        const chip = e.target.closest('.as-chip')
        if (chip) return ask(chip.textContent)
        if (e.target.closest('[data-as-retry]')) {
            // the question goes again: drop the note and the question it was about
            const asked = state.items[state.items.length - 2]
            const question = asked?.role === 'you' ? asked.text : last_question
            state.items = state.items.slice(0, asked?.role === 'you' ? -2 : -1)
            save()
            return ask(question || '')
        }
        const request = e.target.closest('[data-as-request]')
        if (request) {
            const item = state.items[Number(request.dataset.asRequest)]
            const card = item?.cards?.find((c) => c?.kind === 'trade')
            if (!card?.assetid || request.disabled) return
            request.disabled = true
            request.classList.add('sending')
            request.textContent = __('buy_link.sending')
            const sent = await trade.create_trade('single_item', { assetid: card.assetid, bot: card.bot, bp_sku: card.bp_sku }, (ok) => {
                if (!ok) return reset_request(request)
                card.requested = true
                save()
                draw(true)
                log.querySelector('.as-done')?.scrollIntoView({ block: 'nearest' })
                // the trade window (trade.js) opens over the page in a moment; on a phone the chat steps aside for it
                if (PHONE.matches) setTimeout(() => close(false), 1200)
            })
            if (sent === false) reset_request(request)
            return
        }
        // a link to another page: on a phone the chat would cover that page, so it stays closed there
        const link = e.target.closest('a[href]')
        if (link && PHONE.matches && !link.target) { state.open = false; save() }
    })
    const reset_request = (button) => {
        button.disabled = false
        button.classList.remove('sending')
        button.textContent = __('buy_link.request')
    }

    // open on this page too when it was open on the last one (not on a phone: a whole-screen chat over a new page)
    if (state.items.length) draw()
    if (state.open && !PHONE.matches) open(false)
    else if (state.open) { state.open = false; save() }
}

init()
