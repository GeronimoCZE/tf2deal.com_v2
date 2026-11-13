// Two windows over the page (styles: scss/partials/_welcome.scss):
//
// 1. The trade URL window (views/partials/trade_url_modal.ejs), for a signed-in user without a trade URL. It opens at
//    once and stays until they save the trade URL of their own Steam account (POST /api/user/update), then the page
//    loads again with their inventory. It can't be closed: Esc and clicks beside it do nothing, signing out is offered.
//
// 2. The welcome window (views/partials/welcome_modal.ejs, GET /api/welcome) for a new visitor: one whose browser has
//    no td_welcome record in localStorage or sessionStorage. It opens a moment after the page has loaded; closing it
//    (button, x, Esc, a click beside it) or following one of its links saves the record, and it doesn't come back.
//    Not while the trade URL window is up, and not for search engine robots.
(() => {
    const t = (key, vars) => (typeof window.__ == 'function' ? window.__(key, vars) : key)

    /* ========================= TRADE URL ========================= */

    const trade_url_window = document.getElementById('tradeUrlModal')
    if (trade_url_window) {
        const form = trade_url_window.querySelector('#tradeUrlForm')
        const input = form.querySelector('input')
        const button = form.querySelector('button[type="submit"]')
        const message = form.querySelector('.tu-msg')
        const accountid = trade_url_window.dataset.accountid || ''
        let saved = false

        const say = (text, state) => {
            message.textContent = text || ''
            message.className = 'tu-msg' + (state ? ' ' + state : '')
            input.setAttribute('aria-invalid', String(state == 'error'))
            // on a short screen the message can sit below the fold of the window
            if (text) { message.scrollIntoView({ block: 'nearest' }) }
        }

        // the same check as the server (service/trade_url.js), so most mistakes are explained before anything is sent
        const check = (value) => {
            value = value.trim()
            if (!value) return 'empty'
            let url
            try { url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value) } catch (e) { return 'format' }
            const partner = url.searchParams.get('partner') || ''
            if (!/^(www\.)?steamcommunity\.com$/i.test(url.hostname) || !/^\/tradeoffer\/new\/?$/i.test(url.pathname) ||
                !/^\d{1,10}$/.test(partner) || !/^[A-Za-z0-9_-]{6,16}$/.test(url.searchParams.get('token') || '')) return 'format'
            if (accountid && String(Number(partner)) !== accountid) return 'other_account'
            return 'ok'
        }

        // the window itself takes the focus (not the first thing in it), so reading starts at its heading
        const open = () => { if (!trade_url_window.open) { trade_url_window.showModal(); trade_url_window.focus() } }
        // Esc: stays open (a browser may close it anyway on a second Esc: then it opens again)
        trade_url_window.addEventListener('cancel', (e) => e.preventDefault())
        trade_url_window.addEventListener('close', () => { if (!saved) { open() } })

        input.addEventListener('input', () => {
            const result = check(input.value)
            if (result == 'ok') { say(t('trade_url.looks_right'), 'ok') }
            else if (result == 'other_account') { say(t('trade_url.other_account'), 'error') }
            else { say('') }
        })

        form.addEventListener('submit', async (e) => {
            e.preventDefault()
            if (button.disabled) { return }
            const result = check(input.value)
            if (result != 'ok') {
                say(t('trade_url.' + result), 'error')
                input.focus()
                return
            }
            button.disabled = true
            input.readOnly = true
            button.textContent = t('trade_url.saving')
            say('')
            try {
                const response = await fetch('/api/user/update', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ tradeurl: input.value.trim() })
                })
                const answer = await response.json().catch(() => null)
                if (response.ok && answer?.status == 'OK') {
                    saved = true
                    button.textContent = t('trade_url.saved_button')
                    say(t('trade_url.saved'), 'ok')
                    // the page again, now with the inventory and everything else that waited for the trade URL
                    setTimeout(() => location.reload(), 1200)
                    return
                }
                say(typeof answer?.message == 'string' && answer.message ? answer.message : t('trade_url.failed'), 'error')
            } catch (error) {
                say(t('trade_url.failed'), 'error')
            }
            button.disabled = false
            input.readOnly = false
            button.textContent = t('trade_url.save_button')
        })

        // the inventory box on the trade and item pages offers the window again (public/js/plugins/trade.js)
        window.td_trade_url_window = () => { open(); input.focus() }
        open()
        // with a mouse the field is ready for pasting; on touch screens the keyboard waits for a tap
        if (window.matchMedia?.('(pointer: fine)').matches) { input.focus() }
        return // no welcome window over this one
    }

    /* ========================= WELCOME ========================= */

    const KEY = 'td_welcome'
    const read = (store) => { try { return window[store].getItem(KEY) } catch (e) { return null } }
    const remember = () => {
        const value = new Date().toISOString().slice(0, 10) // the day it was seen
        for (const store of ['localStorage', 'sessionStorage']) { try { window[store].setItem(KEY, value) } catch (e) {} }
    }
    if (read('localStorage') || read('sessionStorage')) { return }
    if (/bot|crawl|spider|slurp|lighthouse|preview/i.test(navigator.userAgent || '')) { return }

    const show = async () => {
        if (document.querySelector('dialog[open]')) { return } // another window is up: the next page tries again
        let html = ''
        try {
            const response = await fetch('/api/welcome', { credentials: 'same-origin', headers: { 'Accept': 'text/html' } })
            if (!response.ok) { return }
            html = await response.text()
        } catch (e) { return }
        const template = document.createElement('template')
        template.innerHTML = html
        const dialog = template.content.querySelector('dialog')
        if (!dialog || document.querySelector('dialog[open]')) { return }
        document.body.append(dialog)

        dialog.addEventListener('close', () => { remember(); dialog.remove() })
        dialog.addEventListener('click', (e) => {
            if (e.target.closest('[data-welcome-close]')) { dialog.close(); return }
            if (e.target.closest('a[href]')) { remember(); return } // off to that page: seen
            // a click on the dimmed page beside the window
            if (e.target === dialog) {
                const box = dialog.getBoundingClientRect()
                if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) { dialog.close() }
            }
        })
        dialog.showModal()
        dialog.focus() // the window, not its x button: reading starts at the heading, Tab goes on from there
    }

    // after the page and its pictures are in, so the window doesn't hold the page up
    const later = () => setTimeout(show, 1200)
    if (document.readyState == 'complete') { later() } else { window.addEventListener('load', later, { once: true }) }
})()
