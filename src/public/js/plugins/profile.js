import { round_ref, item_tooltip } from './trade.js'
import { render_trade } from './trades_render.js'

// Profile tabs: Trades, Wishlist, Giveaways, Tickets. Each view calls one load_* function.

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const api = async (url, body) => {
    const options = (body === undefined) ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    try {
        const res = await fetch(url, options)
        const data = await res.json().catch(() => ({}))
        if(!res.ok && !data.message){ data.message = (res.status == 429) ? __('common.too_many_requests') : __('common.something_wrong') }
        if(!res.ok){ data.status = 'error' }
        return data
    } catch (error) {
        return { status: 'error', message: __('common.server_unreachable') }
    }
}

const price_text = (ref, key_price) => {
    if(typeof ref != 'number' || !(key_price > 0)){ return '' }
    let keys = Math.floor(ref / key_price)
    let metal = round_ref(ref - keys * key_price)
    if(metal >= key_price){ metal = round_ref(metal - key_price); keys++ }
    return (keys > 0) ? `${keys} key ${metal} ref` : `${metal} ref`
}

const date_text = (ms) => new Date(ms).toLocaleDateString(TD_LANG)
const datetime_text = (ms) => new Date(ms).toLocaleString(TD_LANG)

// ticket topics are saved in English ("Trade Issue"), shown translated
const topic_text = (title) => { const key = 'tickets.topics.' + String(title).toLowerCase().replace(/[^a-z]+/g, '_'); const t = __(key); return t == key ? title : t }
const message_box = (html) => `<div class="profile-message">${html}</div>`

const particle_bg = (effectID) => (effectID > 0) ? `url(https://api.backpack.tf/images/440/particles/${Number(effectID)}_94x94.png)` : 'none'

/* ========================= TRADES ========================= */

export const load_trades = () => {
    const list = document.getElementById('profile-trades')
    const more = document.getElementById('trades-more')
    let page = 0

    const load = async () => {
        more.classList.add('hidden')
        const res = await api(`/api/user/trades?page=${page}`)
        if(page == 0){ list.innerHTML = '' }

        if(res.status != 'ok'){
            list.insertAdjacentHTML('beforeend', message_box(esc(res.message)))
            return
        }

        const html = res.trades.map(render_trade).join('')
        if(page == 0 && !html){
            list.innerHTML = message_box(__('profile.no_trades_html', { url: lurl('/trade') }))
            return
        }
        list.insertAdjacentHTML('beforeend', html)
        more.classList.toggle('hidden', !res.more)
        page++
    }

    more.addEventListener('click', load)

    // item tooltips, same as the home page
    list.addEventListener('mouseover', (e) => {
        if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
            item_tooltip('show', e.target, e.target.parentElement.getAttribute('id').replace('-grid', ''))
        }
    })
    list.addEventListener('mouseout', (e) => {
        if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
            item_tooltip('hide')
        }
    })
    document.addEventListener('scroll', () => item_tooltip('hide'))

    load()
}

/* ========================= WISHLIST ========================= */

export const load_wishlist = async () => {
    const grid = document.getElementById('profile-wishlist')
    const empty = message_box(__('profile.wishlist_empty_html'))

    const card = (item) => {
        const stock = item.stock?.items?.length ?? item.stock?.cur ?? 0
        const price = price_text(item.sell, item.bptf_data?.update_key_price)
        const data = item.missing
            ? `<div class="wish-data"><span class="stock no">${__('profile.no_longer_listed')}</span></div>`
            : `<div class="wish-data"><span class="stock ${stock > 0 ? 'yes' : 'no'}">${__('common.in_stock', { count: stock })}</span><span class="price">${esc(price)}</span></div>`

        return `<div class="wish-card q-${esc(item.qualityID)}" data-sku="${esc(item.bp_sku)}">
            <a href="${lurl('/items/' + encodeURIComponent(item.bp_sku))}" class="wish-link">
                <img src="${esc(item.image || '/img/group-icon.png')}" style="background-image: ${particle_bg(item.effectID)}" loading="lazy" alt="">
                <div class="wish-name" translate="no">${esc(item.bp_sku)}</div>
                ${data}
            </a>
            <button class="wish-remove" title="${__('profile.remove_from_wishlist')}">&#10005;</button>
        </div>`
    }

    grid.addEventListener('click', async (e) => {
        if(!e.target.classList.contains('wish-remove')){ return }
        const el = e.target.closest('.wish-card')
        e.target.disabled = true

        const res = await api('/api/user/remove_wishlist', { bp_sku: el.dataset.sku })
        if(res.status == 'ok'){
            el.remove()
            iziToast.success({ title: __('profile.removed'), message: __('profile.removed_msg') })
            if(!grid.querySelector('.wish-card')){ grid.innerHTML = empty }
        } else {
            e.target.disabled = false
            iziToast.error({ title: __('common.error'), message: res.message || __('profile.remove_failed') })
        }
    })

    const res = await api('/api/user/wishlist')
    if(res.status != 'ok'){ grid.innerHTML = message_box(esc(res.message)); return }
    grid.innerHTML = res.items.length ? res.items.map(card).join('') : empty
}

/* ========================= GIVEAWAYS ========================= */

export const load_giveaways = async () => {
    const list = document.getElementById('profile-giveaways')

    const status_text = (g) => {
        if(g.status == 'active'){ return `<span class="badge active">${__('profile.gw_entered')}</span> ${__('profile.gw_ends', { date: datetime_text(g.end) })}` }
        if(g.status == 'cancelled'){ return `<span class="badge closed">${__('profile.gw_cancelled')}</span>` }
        if(g.won){ return `<span class="badge won">${__('profile.gw_won')}</span> ${g.prize_sent ? __('profile.gw_prize_sent') : __('profile.gw_prize_soon')}` }
        return `<span class="badge closed">${__('profile.gw_ended')}</span> ${g.winner ? __('profile.gw_winner', { name: esc(g.winner) }) : __('profile.gw_no_winner')}`
    }

    const res = await api('/api/user/giveaways')
    if(res.status != 'ok'){ list.innerHTML = message_box(esc(res.message)); return }
    if(res.giveaways.length == 0){
        list.innerHTML = message_box(__('profile.no_giveaways_html', { url: lurl('/giveaway') }))
        return
    }

    list.innerHTML = res.giveaways.map((g) => `<div class="giveaway-record ${g.won ? 'won' : ''}">
        <img class="q-${esc(g.item?.qualityID)}" src="${esc(g.item?.image || '/img/group-icon.png')}" style="background-image: ${particle_bg(g.item?.effectID)}" loading="lazy" alt="">
        <div class="details">
            <a href="${lurl('/items/' + encodeURIComponent(g.item?.bp_sku || ''))}" class="name" translate="no">${esc(g.item?.bp_sku)}</a>
            <div class="dates">${date_text(g.start)} – ${date_text(g.end)}</div>
            <div class="status">${status_text(g)}</div>
        </div>
    </div>`).join('')
}

/* ========================= SUPPORT TICKETS ========================= */

const TICKET_STATUS = {
    open: __('tickets.status_open'),
    answered: __('tickets.status_answered'),
    closed: __('tickets.status_closed')
}

export const load_tickets = async () => {
    const list = document.getElementById('profile-tickets')

    const ticket_html = (t) => `<div class="ticket ${esc(t.status)}" data-id="${esc(t.id)}">
        <div class="ticket-head">
            <span class="ticket-title">${esc(topic_text(t.title))}</span>
            <span class="badge ${esc(t.status)}">${TICKET_STATUS[t.status] || esc(t.status)}</span>
            <span class="ticket-date">${datetime_text(t.updated)}</span>
        </div>
        <div class="ticket-thread">
            ${t.messages.map((m) => `<div class="msg ${m.from == 'admin' ? 'from-admin' : 'from-user'}">
                <div class="msg-meta"><span class="who">${m.from == 'admin' ? __('tickets.support') : __('tickets.you')}</span><span class="when">${datetime_text(m.created)}</span></div>
                <div class="msg-text">${esc(m.text)}</div>
            </div>`).join('')}
        </div>
        ${t.status == 'closed' ? '' : `<form class="ticket-reply">
            <textarea maxlength="2000" rows="3" placeholder="${__('tickets.reply_placeholder')}" required></textarea>
            <div class="ticket-actions">
                <button type="button" class="ticket-close">${__('tickets.close_ticket')}</button>
                <button type="submit">${__('tickets.send_reply')}</button>
            </div>
        </form>`}
    </div>`

    const render = (tickets) => {
        list.innerHTML = tickets.length
            ? tickets.map(ticket_html).join('')
            : message_box(__('tickets.none_html', { url: lurl('/support') }))
    }

    const replace = (ticket) => {
        const el = list.querySelector(`.ticket[data-id="${ticket.id}"]`)
        if(el){ el.outerHTML = ticket_html(ticket) }
    }

    list.addEventListener('submit', async (e) => {
        if(!e.target.classList.contains('ticket-reply')){ return }
        e.preventDefault()
        const id = e.target.closest('.ticket').dataset.id
        const textarea = e.target.querySelector('textarea')
        const button = e.target.querySelector('button[type="submit"]')
        button.disabled = true

        const res = await api(`/api/user/tickets/${id}/reply`, { text: textarea.value })
        if(res.status == 'ok'){
            replace(res.ticket)
            iziToast.success({ title: __('tickets.sent'), message: __('tickets.sent_msg') })
        } else {
            button.disabled = false
            iziToast.error({ title: __('common.error'), message: res.message })
        }
    })

    list.addEventListener('click', async (e) => {
        if(!e.target.classList.contains('ticket-close')){ return }
        const id = e.target.closest('.ticket').dataset.id
        e.target.disabled = true

        const res = await api(`/api/user/tickets/${id}/close`, {})
        if(res.status == 'ok'){ replace(res.ticket) }
        else {
            e.target.disabled = false
            iziToast.error({ title: __('common.error'), message: res.message })
        }
    })

    const res = await api('/api/user/tickets')
    if(res.status != 'ok'){ list.innerHTML = message_box(esc(res.message)); return }
    render(res.tickets)
}

/* ========================= CREATE TICKET (/support) ========================= */

export const init_ticket_form = () => {
    const form = document.getElementById('ticket-form')
    if(!form){ return }

    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        const button = form.querySelector('[type="submit"]')
        button.disabled = true

        const res = await api('/api/user/tickets', {
            title: form.querySelector('#ticket-title').value,
            details: form.querySelector('#ticket-details').value
        })

        if(res.status == 'ok'){
            iziToast.success({ title: __('tickets.created'), message: __('tickets.created_msg') })
            setTimeout(() => { window.location.href = lurl('/profile/tickets') }, 1500)
        } else {
            button.disabled = false
            iziToast.error({ title: __('common.error'), message: res.message })
        }
    })
}
