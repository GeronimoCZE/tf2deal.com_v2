// Admin bar (view/partials/admin_bar.ejs): only on pages for the admin's Steam account.
//   - Trading on/paused: switches the live setting trading_state for everyone, after a confirm
//   - Unlocked: minutes left until the admin password is needed again
//   - the Admin and New menus also open on tap (they open on hover and keyboard focus with a mouse)
(() => {
    const bar = document.getElementById('admin-bar')
    if (!bar) { return }

    const notify = (ok, message) => {
        if (window.iziToast) { iziToast[ok ? 'success' : 'error']({ title: ok ? 'Done' : 'Error', message }) } else if (!ok) { alert(message) }
    }

    // trading on / paused
    const trading = bar.querySelector('.ab-trading')
    const show_trading = (on) => {
        trading.dataset.state = on ? 'on' : 'off'
        trading.querySelector('span').textContent = on ? 'Trading on' : 'Trading paused'
        trading.title = on ? 'Click to pause trading for everyone' : 'Click to turn trading back on'
    }
    trading?.addEventListener('click', async () => {
        const on = trading.dataset.state != 'on'
        if (!confirm(on ? 'Turn trading back on for everyone?' : 'Pause trading for everyone? Nobody can send trade offers until you turn it back on.')) { return }
        trading.disabled = true
        try {
            const res = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trading_state: on ? 1 : 0 }) })
            const data = await res.json().catch(() => ({}))
            if (res.status == 511) { notify(false, 'Unlock the admin panel first (admin password).'); return }
            if (data.status != 'ok') { notify(false, data.message || 'Could not change trading.'); return }
            show_trading(on)
            notify(true, on ? 'Trading is on.' : 'Trading is paused.')
        } catch (e) {
            notify(false, "Couldn't reach the server.")
        } finally {
            trading.disabled = false
        }
    })

    // time left on the admin password
    const session = bar.querySelector('.ab-session')
    const tick = () => {
        const left = Number(session.dataset.until) - Date.now()
        if (left <= 0) {
            session.outerHTML = '<a class="ab-item ab-unlock" href="/login" title="Enter the admin password"><span class="ab-label">Unlock admin</span></a>'
            return
        }
        session.textContent = `Unlocked · ${Math.max(1, Math.round(left / 60000))} min`
        setTimeout(tick, 30000)
    }
    if (session) { tick() }

    // menus on touch screens: tap to open, tap elsewhere to close
    bar.addEventListener('click', (e) => {
        const menu = e.target.closest('.ab-menu')
        const head = e.target.closest('.ab-menu > .ab-item')
        bar.querySelectorAll('.ab-menu.open').forEach((m) => { if (m != menu) { m.classList.remove('open') } })
        if (head && matchMedia('(hover: none)').matches) {
            e.preventDefault()
            menu.classList.toggle('open')
        }
    })
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#admin-bar')) { bar.querySelectorAll('.ab-menu.open').forEach((m) => m.classList.remove('open')) }
    })
})();
