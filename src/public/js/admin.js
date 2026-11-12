/* Admin panel: Overview, Inventory value, Flips, Live settings, Users, Ratings, Trade records, Notifications, Tickets, Blog, Giveaways (talk to /api/admin/*).
   Bot manager is in js/admin_bot_manager.js (it also sends the old #stock and #listings links to its tabs).
   Live settings also listen on the /settings socket, so changes made by other apps show up right away. */
(() => {
    const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const when = (ms) => ms ? new Date(ms).toLocaleString() : ''

    const api = async (url, body) => {
        const options = (body === undefined) ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        try {
            const res = await fetch(url, options)
            const data = await res.json().catch(() => ({}))
            if(!res.ok){ data.status = 'error'; data.message = data.message || `Request failed (${res.status})` }
            return data
        } catch (error) {
            return { status: 'error', message: "Couldn't reach the server." }
        }
    }

    // iziToast shows its message as HTML: pass anything that came from users through esc() first
    const toast = (res, ok_message) => {
        if(res.status == 'ok'){ iziToast.success({ title: 'Done', message: ok_message || '' }) }
        else { iziToast.error({ title: 'Error', message: esc(res.message || 'Something failed.') }) }
        return res.status == 'ok'
    }

    /* ========================= TICKETS ========================= */

    const tickets = async (root, filter = 'open') => {
        root.innerHTML = head('Tickets', 'Questions users sent from the Support page. Open ones are waiting for your reply.') + `
            <div class="admin-tabs">
                ${['open', 'answered', 'closed', 'all'].map((f) => `<button data-filter="${f}" class="${f == filter ? 'active' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
            </div>
            <div class="admin-list" id="admin-tickets">Loading...</div>`

        root.querySelectorAll('.admin-tabs button').forEach((btn) => btn.addEventListener('click', () => tickets(root, btn.dataset.filter)))

        const res = await api(`/api/admin/tickets${filter == 'all' ? '' : '?status=' + filter}`)
        const list = root.querySelector('#admin-tickets')
        if(res.status != 'ok'){ list.textContent = res.message; return }
        if(res.tickets.length == 0){ list.innerHTML = '<p class="admin-empty">No tickets here.</p>'; return }

        list.innerHTML = res.tickets.map((t) => `<div class="admin-ticket ${esc(t.status)}" data-id="${esc(t._id)}">
            <div class="row">
                <strong>${esc(t.title)}</strong>
                <span class="badge ${esc(t.status)}">${esc(t.status)}</span>
                <a href="https://steamcommunity.com/profiles/${esc(t.steamid)}" target="_blank" rel="nofollow">${esc(t.name || t.steamid)}</a>
                <span class="muted">${when(t.updated)}</span>
            </div>
            <div class="thread">
                ${t.messages.map((m) => `<div class="msg from-${m.from == 'admin' ? 'admin' : 'user'}"><span class="muted">${m.from == 'admin' ? 'You' : 'User'}, ${when(m.created)}</span><div>${esc(m.text)}</div></div>`).join('')}
            </div>
            ${t.status == 'closed' ? '' : `<textarea rows="3" maxlength="2000" placeholder="Reply to the user..."></textarea>
            <div class="actions"><button class="close-ticket">Close</button> <button class="reply-ticket primary">Send reply</button></div>`}
        </div>`).join('')

        list.addEventListener('click', async (e) => {
            const el = e.target.closest('.admin-ticket')
            if(!el){ return }
            if(e.target.classList.contains('reply-ticket')){
                const res = await api(`/api/admin/tickets/${el.dataset.id}/reply`, { text: el.querySelector('textarea').value })
                if(toast(res, 'Reply sent.')){ tickets(root, filter) }
            }
            if(e.target.classList.contains('close-ticket')){
                const res = await api(`/api/admin/tickets/${el.dataset.id}/close`, {})
                if(toast(res, 'Ticket closed.')){ tickets(root, filter) }
            }
        })
    }

    /* ========================= BLOG ========================= */

    // the post list and the block editor live in js/admin_blog.js (loaded after this file)
    const blog = (root, ...args) => window.admin_blog(root, ...args)

    // the languages a giveaway description can be written in
    const LANG_OPTIONS = [['en', 'English'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский'], ['zh', '中文']]

    /* ========================= GIVEAWAYS ========================= */

    // "Steam group: posted · Facebook: removed" (announcements, see src/service/giveaway_posts.js)
    const POST_SERVICES = { steam: 'Steam group', facebook: 'Facebook' }
    const post_link = (key, post, info) => !post.id ? '' : key == 'steam' ? `https://steamcommunity.com/gid/${info.steam_group}/announcements/detail/${post.id}` : `https://www.facebook.com/${post.id}`
    const post_states = (g, info) => Object.entries(POST_SERVICES).map(([key, name]) => {
        const post = g.posts?.[key]
        if(!post?.state){ return '' }
        const link = post_link(key, post, info)
        const error = `<span class="tr-error" title="${esc(post.error)}">${esc(post.error)}</span>`
        // a post on a giveaway that ended is about to be removed
        const state = (post.state == 'posted' && g.status != 'active') ? 'removing' : post.state
        const text = {
            posting: '<span class="muted">posting…</span>',
            posted: (link ? `<a href="${esc(link)}" target="_blank" rel="nofollow">posted</a>` : 'posted') + (post.error ? ` <span class="muted">(${esc(post.error)})</span>` : ''),
            post_failed: `not posted: ${error}`,
            removing: '<span class="muted">removing…</span>',
            removed: '<span class="tr-done">removed</span>',
            remove_failed: (post.tries >= info.max_tries ? 'couldn\'t remove it, please delete it by hand: ' : 'removing failed, trying again in 10 minutes: ') + error
        }[state] || esc(state)
        return `${name}: ${text}`
    }).filter(Boolean).join(' &middot; ')
    const posts_busy = (list) => list.some((g) => Object.values(g.posts || {}).some((post) => post?.state == 'posting' || post?.state == 'removing' || (post?.state == 'posted' && g.status != 'active')))

    // the prize, as bot_manager keeps it on the bank bot (src/service/giveaway_prize.js)
    const prize_line = (g) => {
        const p = g.prize
        if(!p?.state){ return '' }
        const offer = g.offer_link && ['sent', 'accepted', 'declined'].includes(p.state) ? ` · <a href="${esc(g.offer_link)}" target="_blank" rel="nofollow">trade offer</a>` : ''
        const error = p.error ? ` <span class="tr-error" title="${esc(p.error)}">${esc(p.error == 'no_trade_link' ? 'The winner has no trade link yet: it goes out when they add one.' : p.error)}</span>` : ''
        const cls = p.state == 'accepted' ? 'tr-done' : ['move_failed', 'send_failed', 'declined'].includes(p.state) ? 'tr-error' : ''
        return `<span class="${cls}">${esc(g.prize_text)}</span>${offer}${error}`
    }
    const prize_actions = (g) => {
        const p = g.prize
        if(!p?.state){ return g.winner?.steamid ? `<label class="check"><input type="checkbox" class="prize-sent" ${g.prize_sent ? 'checked' : ''}> Prize sent</label>` : '' }
        if(g.status == 'active' && p.state == 'move_failed'){ return '<button class="move-prize">Try moving it again</button>' }
        if(g.status == 'ended' && g.winner?.steamid && !g.prize_sent && ['held', 'send_failed', 'declined', 'sent'].includes(p.state)){
            return `<button class="send-prize">${p.state == 'held' ? 'Send the offer now' : 'Send the offer again'}</button>`
        }
        return ''
    }
    const PRIZE_BLOCKED = {
        offline: 'bot_manager is not connected, so prizes can\'t be picked or sent right now.',
        old: 'bot_manager doesn\'t have giveaway prizes yet. Give it the events in <code>docs/GIVEAWAY_PRIZES.md</code>, then the prize picker shows the items on your bots.'
    }

    // everything about the winner the admin needs to deliver the prize or check them
    const winner_card = (g) => {
        const w = g.winner, u = g.winner_user
        const profile = `https://steamcommunity.com/profiles/${esc(w.steamid)}`
        return `<div class="admin-card gw-winner" data-id="${esc(g._id)}">
            <div class="admin-card-head"><h3>Winner of ${esc(g.item.bp_sku)}</h3><span class="muted">drawn ${when(w.drawn || g.end)}</span></div>
            <div class="gw-winner-body">
                <img src="${esc(w.avatar || '/img/new_user-96.webp')}" alt="" width="64" height="64">
                <dl class="gw-winner-meta">
                    <dt>Name</dt><dd><a href="${profile}" target="_blank" rel="nofollow">${esc(w.name || w.steamid)}</a></dd>
                    <dt>SteamID64</dt><dd><code>${esc(w.steamid)}</code></dd>
                    ${w.entered ? `<dt>Entered</dt><dd>${when(w.entered)}</dd>` : ''}
                    <dt>Trade link</dt><dd>${g.winner_tradelink ? `<a href="${esc(g.winner_tradelink)}" target="_blank" rel="nofollow">${esc(g.winner_tradelink.replace(/^https:\/\/steamcommunity\.com/, ''))}</a>` : '<span class="muted">none yet</span>'}</dd>
                    ${u ? `<dt>On the site</dt><dd>${num(u.trades)} trade${u.trades == 1 ? '' : 's'} · ${num(u.entries)} giveaway${u.entries == 1 ? '' : 's'} entered · ${num(u.won)} won</dd>` : ''}
                    <dt>Prize</dt><dd>${prize_line(g) || (g.prize_sent ? '<span class="tr-done">Sent</span>' : '<span class="muted">Send it yourself</span>')}</dd>
                </dl>
            </div>
            <div class="actions">${prize_actions(g)}</div>
        </div>`
    }

    // one tile of the prize picker
    const prize_tile = (i) => `<button type="button" class="gw-pick" data-bot="${esc(i.bot)}" data-assetid="${esc(i.assetid)}" title="${esc(i.name)}">
        <img class="q-${esc(i.qualityID ?? 6)}" src="${esc(i.image || '/img/group-icon.png')}" alt="" loading="lazy" ${Number(i.effectID) > 0 ? `style="background-image:url(https://api.backpack.tf/images/440/particles/${Number(i.effectID)}_94x94.png)"` : ''}>
        <span class="gw-pick-name">${esc(i.name)}</span>
        <span class="gw-pick-meta">${esc(i.botName || i.bot)}${i.priced === false ? ' · <span class="admin-tag">unpriced</span>' : ''}${i.onBank ? ' · <span class="admin-tag">bank</span>' : ''}</span>
    </button>`

    const giveaways = async (root) => {
        root.innerHTML = head('Giveaways', 'One giveaway runs at a time. A random entrant wins when it ends and the bank bot sends them the prize.') + `<div id="admin-giveaways"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>`
        const box = root.querySelector('#admin-giveaways')

        const res = await api('/api/admin/giveaways')
        if(res.status != 'ok'){ box.textContent = res.message; return }

        const active = res.giveaways.find((g) => g.status == 'active')
        const past = res.giveaways.filter((g) => g.status != 'active')
        const latest_win = past.find((g) => g.status == 'ended' && g.winner?.steamid)

        const default_end = new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        const posts_off = Object.keys(POST_SERVICES).filter((key) => !res.posts?.[key]).map((key) => POST_SERVICES[key])
        // only when something is off: when both work, the announcements need no note
        const posts_note = posts_off.length == 0 ? ''
            : `<p class="admin-note">${posts_off.join(' and ')} announcement${posts_off.length > 1 ? 's are' : ' is'} off. To announce new giveaways there, add the settings to <code>.env</code> and restart (see <code>docs/SETUP.md</code>).</p>`
        const prizes_note = PRIZE_BLOCKED[res.prizes] ? `<p class="admin-note">${PRIZE_BLOCKED[res.prizes]}</p>` : ''

        box.innerHTML = posts_note + prizes_note + (active ? `<div class="admin-giveaway active" data-id="${esc(active._id)}">
                <img class="q-${esc(active.item.qualityID)}" src="${esc(active.item.image)}" alt="${esc(active.item.bp_sku)}">
                <div>
                    <strong>${esc(active.item.bp_sku)}</strong>${active.prize?.priced === false ? ' <span class="admin-tag">unpriced</span>' : ''}
                    <div>Ends ${when(active.end)} &middot; ${active.entry_count} entries</div>
                    ${active.entrants?.length ? `<div class="gw-mini-avatars">${active.entrants.map((e) => `<img src="${esc(e.avatar || '/img/new_user-96.webp')}" alt="" title="${esc(e.name)}" width="24" height="24">`).join('')}${active.entry_count > active.entrants.length ? `<span>+ ${active.entry_count - active.entrants.length}</span>` : ''}</div>` : ''}
                    <div class="muted">Requirements: ${[active.requirements?.steam_group && 'Steam group', active.requirements?.trade && '1 trade'].filter(Boolean).join(', ') || 'none'}</div>
                    ${active.prize?.state ? `<div class="muted" data-prize="${esc(active._id)}">Prize: ${prize_line(active)}</div>` : ''}
                    <div class="muted" data-posts="${esc(active._id)}">${post_states(active, res.posts)}</div>
                    <div class="actions"><button class="end-giveaway primary">End now &amp; draw winner</button> <button class="cancel-giveaway">Cancel giveaway</button> ${prize_actions(active)}</div>
                </div>
            </div>` : `<form class="admin-card admin-form gw-form" id="giveaway-form">
                <h3>Start a giveaway</h3>
                <div class="gw-bank" id="gw-bank"><span class="muted">Loading the bank bot…</span></div>
                <div class="gw-prize">
                    <label>Prize: an item on your bots (unpriced items too)
                        <input type="search" name="q" autocomplete="off" placeholder="Search by name, e.g. Team Captain" ${res.prizes != 'ready' ? 'disabled' : ''}>
                    </label>
                    <div class="gw-picked" id="gw-picked" hidden></div>
                    <div class="gw-picker" id="gw-picker">${res.prizes == 'ready' ? '<span class="muted">Loading the items…</span>' : '<span class="muted">The items show once bot_manager has giveaway prizes.</span>'}</div>
                    <button type="button" class="gw-more-items" id="gw-more-items" hidden>Show more items</button>
                </div>
                <label>Ends <input type="datetime-local" name="end" required value="${default_end}"></label>
                <label>Description (optional) <input name="description" maxlength="500"></label>
                <label>Description written in
                    <select name="lang">${LANG_OPTIONS.map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join('')}</select>
                </label>
                <label class="check"><input type="checkbox" name="steam_group" checked> Must be in our Steam group</label>
                <label class="check"><input type="checkbox" name="trade" checked> Must make 1 trade during the giveaway</label>
                <div class="actions"><button type="submit" class="primary" ${res.prizes != 'ready' ? 'disabled' : ''}>Start giveaway</button></div>
                <p class="muted small">The prize moves to the bank bot right away, so nothing else can trade it.</p>
            </form>`) + (latest_win ? winner_card(latest_win) : '') + `
            <h3>Previous giveaways</h3>
            ${past.length == 0 ? '<p class="admin-empty">None yet.</p>' : `<div class="admin-table-wrap"><table>
                <tr><th>Item</th><th>Ended</th><th>Entries</th><th>Winner</th><th>Prize</th><th>Announcements</th></tr>
                ${past.map((g) => `<tr data-id="${esc(g._id)}">
                    <td>${esc(g.item.bp_sku)}</td>
                    <td>${g.status == 'cancelled' ? 'Cancelled' : when(g.end)}</td>
                    <td>${g.entry_count}</td>
                    <td>${g.winner?.steamid ? `<a href="https://steamcommunity.com/profiles/${esc(g.winner.steamid)}" target="_blank" rel="nofollow">${esc(g.winner.name || g.winner.steamid)}</a>
                        ${g.winner_tradelink ? '' : '<br><span class="muted">no trade link</span>'}` : '-'}</td>
                    <td data-prize="${esc(g._id)}">${prize_line(g) || (g.winner?.steamid ? '' : '-')} ${prize_actions(g)}</td>
                    <td data-posts="${esc(g._id)}">${post_states(g, res.posts) || '-'}</td>
                </tr>`).join('')}
            </table></div>`}`

        // posting and removing run in the background, and so do the prize's move and offer: keep those up to date
        const prize_busy = (list) => list.some((g) => ['moving', 'sending', 'sent'].includes(g.prize?.state) || (g.prize?.state == 'held' && g.status == 'ended' && g.winner?.steamid))
        const watch = async (list, round = 0) => {
            if((!posts_busy(list) && !prize_busy(list)) || round >= 60){ return }
            await new Promise((resolve) => setTimeout(resolve, round < 20 ? 3000 : 10000))
            if(!box.isConnected){ return }
            const r = await api('/api/admin/giveaways')
            if(r.status != 'ok'){ return }
            for (const g of r.giveaways) {
                const el = box.querySelector(`[data-posts="${g._id}"]`)
                if(el){ el.innerHTML = post_states(g, r.posts) || (el.tagName == 'TD' ? '-' : '') }
                const pr = box.querySelector(`[data-prize="${g._id}"]`)
                if(pr){ pr.innerHTML = pr.tagName == 'TD' ? `${prize_line(g) || '-'} ${prize_actions(g)}` : `Prize: ${prize_line(g)}` }
            }
            watch(r.giveaways, round + 1)
        }
        watch(res.giveaways)

        const form = box.querySelector('#giveaway-form')
        if(form){
            // the bank bot: where prizes wait for their winner
            const bank_box = form.querySelector('#gw-bank')
            const load_bank = async () => {
                if(res.prizes != 'ready'){ bank_box.innerHTML = ''; return }
                const b = await api('/api/admin/giveaways/bank')
                if(b.status != 'ok'){ bank_box.innerHTML = `<span class="admin-error">${esc(b.message)}</span>`; return }
                const list = b.candidates || []
                bank_box.innerHTML = `<label>Bank bot (keeps the prizes until the winner gets them)
                    <span class="admin-inline-form">
                        <select name="bank">${b.bank ? '' : '<option value="">Pick a bot…</option>'}${list.map((c) => `<option value="${esc(c.steamid)}" ${c.steamid == b.bank ? 'selected' : ''}>${esc(c.name || c.steamid)}${c.type ? ` (${esc(c.type)})` : ''}${c.online === false ? ' – offline' : ''}</option>`).join('')}</select>
                        <button type="button" class="save-bank">Save</button>
                    </span></label>
                    ${b.bank ? '' : '<p class="admin-error">Pick the bank bot before starting a giveaway. A warehouse account that doesn\'t trade or list works best.</p>'}`
            }
            load_bank()
            bank_box.addEventListener('click', async (e) => {
                if(!e.target.classList.contains('save-bank')){ return }
                const steamid = bank_box.querySelector('select').value
                if(toast(await api('/api/admin/giveaways/bank', { steamid }), 'Bank bot saved.')){ load_bank(); load_items(true) }
            })

            // the prize picker
            const picker = form.querySelector('#gw-picker'), more = form.querySelector('#gw-more-items'), picked_box = form.querySelector('#gw-picked')
            let found = [], offset = 0, picked = null, search_timer, request = 0
            const load_items = async (fresh) => {
                if(res.prizes != 'ready'){ return }
                if(fresh){ found = []; offset = 0; picker.innerHTML = '<span class="muted">Loading the items…</span>' }
                const mine = ++request
                const r = await api(`/api/admin/giveaways/prize_items?q=${encodeURIComponent(form.q.value)}&offset=${offset}&limit=60`)
                if(mine != request){ return }
                if(r.status != 'ok'){ picker.innerHTML = `<span class="admin-error">${esc(r.message)}</span>`; more.hidden = true; return }
                const items = r.items || []
                found = found.concat(items)
                offset += items.length
                picker.innerHTML = found.length ? found.map(prize_tile).join('') : `<span class="muted">${form.q.value ? 'No item on the bots matches that.' : 'The bots have no tradable items.'}</span>`
                if(picked){ picker.querySelector(`[data-assetid="${CSS.escape(picked.assetid)}"]`)?.classList.add('is-picked') }
                more.hidden = !(r.total > found.length)
            }
            load_items(true)
            form.q.addEventListener('input', () => { clearTimeout(search_timer); search_timer = setTimeout(() => load_items(true), 250) })
            more.addEventListener('click', () => load_items(false))
            picker.addEventListener('click', (e) => {
                const tile = e.target.closest('.gw-pick')
                if(!tile){ return }
                picked = found.find((i) => i.assetid == tile.dataset.assetid && i.bot == tile.dataset.bot) || null
                picker.querySelectorAll('.is-picked').forEach((el) => el.classList.remove('is-picked'))
                tile.classList.add('is-picked')
                picked_box.hidden = !picked
                if(picked){ picked_box.innerHTML = `Prize: <strong>${esc(picked.name)}</strong> <span class="muted">from ${esc(picked.botName || picked.bot)}, asset ${esc(picked.assetid)}${picked.priced === false ? ', unpriced' : ''}</span>` }
            })

            form.addEventListener('submit', async (e) => {
                e.preventDefault()
                if(!picked){ toast({ status: 'error', message: 'Pick the prize from the items on your bots.' }); return }
                const button = form.querySelector('button[type="submit"]')
                button.disabled = true
                const r = await api('/api/admin/giveaways', {
                    bot: picked.bot,
                    assetid: picked.assetid,
                    bp_sku: picked.bp_sku || '',
                    name: picked.name,
                    image: picked.image || '',
                    qualityID: picked.qualityID,
                    effectID: picked.effectID,
                    priced: picked.priced !== false,
                    end: new Date(form.end.value).getTime(),
                    description: form.description.value,
                    lang: form.lang.value,
                    steam_group: form.steam_group.checked,
                    trade: form.trade.checked
                })
                button.disabled = false
                if(toast(r, 'Giveaway started. The prize is on its way to the bank bot.')){ giveaways(root) }
            })
        }

        box.addEventListener('click', async (e) => {
            const id = e.target.closest('[data-id]')?.dataset.id
            if(!id){ return }
            if(e.target.classList.contains('end-giveaway') && confirm('End the giveaway now and draw a winner?')){
                const r = await api(`/api/admin/giveaways/${id}/end`, {})
                const left = r.skipped ? ` Skipped ${r.skipped} who had left the Steam group.` : ''
                if(toast(r, r.winner ? `Winner: ${esc(r.winner.name || r.winner.steamid)}.${left}` : r.skipped ? 'Ended without a winner: everyone had left the Steam group.' : 'Ended, there were no entries.')){ giveaways(root) }
            }
            if(e.target.classList.contains('cancel-giveaway') && confirm('Cancel the giveaway without a winner? The prize stays on the bank bot as a normal item.')){
                const r = await api(`/api/admin/giveaways/${id}/cancel`, {})
                if(toast(r, 'Giveaway cancelled.')){ giveaways(root) }
            }
            if(e.target.classList.contains('send-prize')){
                e.target.disabled = true
                if(toast(await api(`/api/admin/giveaways/${id}/send_prize`, {}), 'Offer sent to the winner.')){ giveaways(root) } else { e.target.disabled = false }
            }
            if(e.target.classList.contains('move-prize')){
                e.target.disabled = true
                if(toast(await api(`/api/admin/giveaways/${id}/move_prize`, {}), 'Moving the prize to the bank bot.')){ giveaways(root) } else { e.target.disabled = false }
            }
            if(e.target.classList.contains('prize-sent')){
                toast(await api(`/api/admin/giveaways/${id}/prize_sent`, { prize_sent: e.target.checked }), 'Saved.')
            }
        })
    }

    /* ========================= SHARED ========================= */

    const num = (n) => (n == null || Number.isNaN(Number(n))) ? '–' : Number(n).toLocaleString()
    const ago = (ms) => {
        if(!ms){ return 'never' }
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
        if(s < 45){ return 'just now' }
        if(s < 3600){ return `${Math.round(s / 60)} min ago` }
        if(s < 86400){ return `${Math.round(s / 3600)} h ago` }
        return when(ms)
    }
    const uptime = (s) => {
        const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
        return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
    }
    const head = (title, sub = '', actions = '') => `<header class="admin-head">
            <div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
            ${actions ? `<div class="admin-head-actions">${actions}</div>` : ''}
        </header>`
    const pill = (ok, yes = 'Online', no = 'Offline') => `<span class="admin-pill ${ok ? 'ok' : 'bad'}"><i></i>${ok ? yes : no}</span>`
    const by_label = (by) => by ? (by.kind == 'admin' ? 'Admin panel' : esc(by.name || 'app')) : 'unknown'
    const parse_by = (text) => { const [kind, ...rest] = String(text || '').split(':'); return text ? { kind, name: rest.join(':') } : null }
    // quality names by quality id (Bot manager uses them through window.admin_kit)
    const QUALITY_NAMES = { 0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made', 11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated' }
    const SETTING_NAMES = { trading_state: 'Trading', min_item_key: 'Min. price', max_item_key: 'Max. price', item_blacklist: 'Blacklist', announcement: 'Banner', reviews: 'Ratings', season: 'Season', listings: 'Listings', extra: 'App values' }

    /* ========================= LIVE SETTINGS (socket /settings) ========================= */

    const live = { socket: null, settings: null, clients: [], log: [], listeners: new Set() }
    const notify = (type, event) => live.listeners.forEach((fn) => { try { fn(type, event) } catch (e) { console.log(e) } })

    const set_live_state = (state, text) => {
        const el = document.getElementById('admin-live')
        if(!el){ return }
        el.dataset.state = state
        el.querySelector('span').textContent = text
    }

    const refresh_clients = () => {
        if(!live.socket?.connected){ return }
        live.socket.emit('settings:clients', (r) => {
            if(r?.status == 'ok'){ live.clients = r.clients; notify('clients') }
        })
    }

    const connect_live = async () => {
        const res = await api('/api/admin/settings')
        if(res.status != 'ok'){ set_live_state('offline', 'Offline'); return }
        live.settings = res.settings
        live.clients = res.clients || []
        if(res.settings.updated){ live.log.push({ time: res.settings.updated, by: parse_by(res.settings.updated_by), changed: null }) }
        notify('init')

        if(typeof io != 'function'){ set_live_state('offline', 'No socket'); return }

        const socket = io('/settings', { auth: { admin_token: res.socket.token } })
        live.socket = socket

        socket.on('connect', () => { set_live_state('online', 'Live'); refresh_clients() })
        socket.on('disconnect', () => set_live_state('offline', 'Reconnecting…'))
        socket.on('connect_error', async (err) => {
            set_live_state('offline', 'Offline')
            if(err?.message == 'unauthorized'){ // token expired: get a new one, socket.io retries by itself
                const r = await api('/api/admin/settings')
                if(r.status == 'ok'){ socket.auth.admin_token = r.socket.token }
            }
        })
        socket.on('settings:init', ({ settings }) => { live.settings = settings; notify('init') })
        socket.on('settings:changed', (event) => {
            live.settings = event.settings
            live.log.unshift({ time: event.updated, by: event.by, changed: event.changed })
            live.log = live.log.slice(0, 25)
            notify('changed', event)
            if(event.by?.kind != 'admin'){
                iziToast.info({ title: `${by_label(event.by)} changed settings`, message: event.changed.map((k) => SETTING_NAMES[k] || k).join(', ') })
            }
        })
        socket.on('settings:clients_changed', refresh_clients)
        // bot_manager changed something / worked out its stock limits again (js/admin_bot_manager.js listens)
        socket.on('bot_manager:changed', (event) => notify('bot_manager', event))
        socket.on('bot_manager:stock_updated', (status) => notify('bot_manager_stock', status))
    }

    // through the socket when it's up, otherwise through the REST route
    const save_settings = (patch) => new Promise((resolve) => {
        if(live.socket?.connected){
            live.socket.timeout(8000).emit('settings:update', patch, (err, r) => resolve(err ? { status: 'error', message: 'The server did not answer.' } : r))
        } else {
            api('/api/admin/settings', { patch }).then(resolve)
        }
    }).then((r) => {
        if(r?.status == 'ok' && r.settings){ live.settings = r.settings }
        return r
    })

    /* ========================= OVERVIEW ========================= */

    const stat = (label, value, sub = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="admin-stat">
            <span class="label">${label}</span>
            <strong>${value}</strong>
            ${sub ? `<span class="sub">${sub}</span>` : ''}
        </${href ? 'a' : 'div'}>`

    const overview = async (root) => {
        root.innerHTML = head('Overview', 'What is happening on the site right now. Updates by itself every 15 seconds.') + '<div id="ov-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>'

        const draw = async () => {
            const res = await api('/api/admin/overview')
            const box = root.querySelector('#ov-body')
            if(!box){ return }
            if(res.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            const o = res.overview
            const trading = live.settings ? live.settings.trading_state === 1 : o.trading

            // six numbers: each one answers "is something wrong or waiting for me?"
            box.innerHTML = `<div class="admin-stats">
                    ${stat('Online now', num(o.users_online), `${num(o.users_trading)} trading · ${num(o.users_total)} registered`, '#users')}
                    ${stat('Trades, 24 h', num(o.trades_day), o.trades_total != null ? `${num(o.trades_total)} all time` : '', '#trades')}
                    ${stat('Items in stock', num(o.items), `on ${num(o.bots)} bot${o.bots == 1 ? '' : 's'}`, '#bots/stock')}
                    ${stat('Key price', o.key_price ? `${num(o.key_price)}<small> ref</small>` : '–')}
                    ${stat('Open tickets', num(o.tickets_open), o.tickets_open ? 'waiting for a reply' : 'all answered', '#tickets')}
                    ${stat('Rating', o.rating?.avg != null ? `${o.rating.avg.toFixed(1)}<small> ★</small>` : '–', o.rating?.count ? `${num(o.rating.count)} rating${o.rating.count == 1 ? '' : 's'}` : 'no ratings yet', '#ratings')}
                </div>
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>Status</h3>
                        <ul class="admin-rows">
                            <li><label for="ov-trading">Trading${trading ? '' : ' <span class="admin-bad">paused</span>'}</label>
                                <label class="admin-switch" title="${trading ? 'Pause trading' : 'Turn trading on'}"><input type="checkbox" id="ov-trading" ${trading ? 'checked' : ''}><span></span></label></li>
                            <li><span>Bot server</span>${pill(o.bot_server == 'online')}</li>
                            <li><span>Item server</span>${pill(o.item_server == 'online')}</li>
                            <li><span>Database</span>${pill(o.db, 'Connected', 'Disconnected')}</li>
                            <li><span>Website</span><span class="muted">up ${uptime(o.uptime)}${o.memory ? ` · <span title="${num(o.memory.heap_used)} MB of it is in use; the rest is freed memory given back every few minutes">${num(o.memory.rss)} MB</span>${o.memory.capped ? '' : ' · <span class="admin-bad" title="Start the site with pm2 start ecosystem.config.cjs (docs/UBUNTU.md) so it stays smaller">no heap cap</span>'}` : ''}</span></li>
                        </ul>
                    </div>
                    <div class="admin-card">
                        <h3>Giveaway</h3>
                        ${o.giveaway ? `<div class="admin-giveaway-mini">
                                <img src="${esc(o.giveaway.image)}" alt="${esc(o.giveaway.bp_sku)}">
                                <div><strong>${esc(o.giveaway.bp_sku)}</strong>
                                <span class="muted">${num(o.giveaway.entries)} entries · ends ${when(o.giveaway.end)}</span></div>
                            </div>` : '<p class="admin-empty">No giveaway is running.</p>'}
                        <a class="admin-link" href="#giveaways">Manage giveaways →</a>
                        ${live.settings?.announcement?.enabled && live.settings.announcement.text ? `<h3>Banner shown to visitors</h3>
                            <div class="site-announcement level-${esc(live.settings.announcement.level)} admin-banner-preview"><span class="site-announcement-dot"></span><span class="site-announcement-text">${esc(live.settings.announcement.text)}</span></div>` : ''}
                    </div>
                </div>`

            const badge = document.getElementById('nav-tickets-count')
            if(badge){ badge.hidden = !o.tickets_open; badge.textContent = o.tickets_open || '' }

            box.querySelector('#ov-trading')?.addEventListener('change', async (e) => {
                const on = e.target.checked
                if(!on && !confirm('Pause trading? Visitors can\'t create new trades until you turn it back on.')){ e.target.checked = true; return }
                if(toast(await save_settings({ trading_state: on ? 1 : 0 }), on ? 'Trading is on.' : 'Trading is paused.')){ draw() } else { e.target.checked = !on }
            })
        }

        await draw()
        const timer = setInterval(() => { if(!document.hidden){ draw() } }, 15000)
        const on_live = (type) => { if(type == 'changed' || type == 'init'){ draw() } }
        live.listeners.add(on_live)
        return () => { clearInterval(timer); live.listeners.delete(on_live) }
    }

    /* ========================= INVENTORY VALUE ========================= */

    // What the bots hold (item copies at their current prices + keys + metal), measured every 15 minutes by
    // service/inventory_value.js, and how much it grew over a period: the profit.
    const IV_DAY = 24 * 60 * 60 * 1000
    const IV_PERIODS = [['1d', '1 day'], ['7d', '7 days'], ['1m', '1 month'], ['1y', '1 year'], ['custom', 'Custom']]
    const iv_state = { period: '7d', basis: 'sell', from: '', to: '' }

    const iv_round = (n) => Math.round((Number(n) || 0) * 100) / 100
    // 1272.11 ref with a key at 60 -> "21 keys 12.11 ref"; negative values keep their sign in front
    const iv_money = (ref, key, signed = false) => {
        const sign = ref < 0 ? '−' : (signed && ref > 0 ? '+' : '')
        let rest = Math.abs(iv_round(ref))
        const keys = key > 0 ? Math.floor(rest / key) : 0
        rest = iv_round(rest - keys * key)
        const parts = []
        // a number and its unit stay on one line
        if(keys){ parts.push(`${keys.toLocaleString()}\u00a0${keys == 1 ? 'key' : 'keys'}`) }
        if(rest || !keys){ parts.push(`${rest.toLocaleString(undefined, { maximumFractionDigits: 2 })}\u00a0ref`) }
        return sign + parts.join(' ')
    }
    const iv_ref = (ref) => `${iv_round(ref).toLocaleString(undefined, { maximumFractionDigits: 2 })} ref`
    const iv_range = () => {
        const now = Date.now()
        if(iv_state.period == 'custom'){
            const from = Date.parse(iv_state.from + 'T00:00:00')
            const to = Date.parse(iv_state.to + 'T23:59:59')
            return { from: Number.isFinite(from) ? from : now - 7 * IV_DAY, to: Number.isFinite(to) ? Math.min(to, now) : now }
        }
        const d = new Date(now)
        if(iv_state.period == '1m'){ d.setMonth(d.getMonth() - 1); return { from: d.getTime(), to: now } }
        if(iv_state.period == '1y'){ d.setFullYear(d.getFullYear() - 1); return { from: d.getTime(), to: now } }
        return { from: now - (iv_state.period == '1d' ? 1 : 7) * IV_DAY, to: now }
    }
    const iv_date = (ms, span) => new Date(ms).toLocaleString(undefined, span <= 2 * IV_DAY ? { hour: '2-digit', minute: '2-digit' } : span <= 120 * IV_DAY ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' })

    // the value line: one series, so no legend; the crosshair shows every number of the nearest measurement
    const iv_chart = (box, tip, points, basis, key_now) => {
        const NS = 'http://www.w3.org/2000/svg'
        const el = (name, attrs) => { const e = document.createElementNS(NS, name); for(const [k, v] of Object.entries(attrs)){ e.setAttribute(k, v) } return e }
        box.textContent = ''
        if(points.length < 2){ box.innerHTML = '<p class="admin-empty">Not enough measurements in this period to draw a line yet.</p>'; return }
        const W = Math.max(300, box.clientWidth), H = 260, L = 64, R = 14, T = 14, B = 30
        const vals = points.map((p) => p[basis])
        let lo = Math.min(...vals), hi = Math.max(...vals)
        const pad = Math.max((hi - lo) * 0.12, hi * 0.005, 1)
        lo = Math.max(0, lo - pad); hi = hi + pad
        const t0 = points[0].t, t1 = points[points.length - 1].t, span = Math.max(1, t1 - t0)
        const x = (t) => L + (t - t0) / span * (W - L - R)
        const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
        const in_keys = key_now > 0 && hi >= key_now * 2
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Inventory value from ${iv_date(t0, span)} to ${iv_date(t1, span)}` })

        // y grid: about 4 clean steps
        const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stepv = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
        for(let v = Math.ceil(lo / stepv) * stepv; v <= hi; v += stepv){
            svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'iv-grid' }))
            const label = el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'iv-axis' })
            label.textContent = in_keys ? `${(v / key_now).toLocaleString(undefined, { maximumFractionDigits: v / key_now >= 100 ? 0 : 1 })} keys` : `${Math.round(v).toLocaleString()} ref`
            svg.append(label)
        }
        // x labels: 5 evenly spaced (3 on a phone)
        const xn = W < 520 ? 2 : 4
        for(let i = 0; i <= xn; i++){
            const t = t0 + span * i / xn
            const label = el('text', { x: x(t), y: H - 8, 'text-anchor': i == 0 ? 'start' : i == xn ? 'end' : 'middle', class: 'iv-axis' })
            label.textContent = iv_date(t, span)
            svg.append(label)
        }
        // the line breaks where measurements are missing (site or bot server down)
        const gap = Math.max(3 * 15 * 60 * 1000, span / 400 * 3)
        let line = '', area = '', run = []
        const close = () => {
            if(run.length > 1){ area += `M${x(run[0].t)},${y(lo)} ` + run.map((p) => `L${x(p.t)},${y(p[basis])}`).join(' ') + ` L${x(run[run.length - 1].t)},${y(lo)} Z ` }
            run = []
        }
        points.forEach((p, i) => {
            const fresh = i == 0 || p.t - points[i - 1].t > gap
            if(fresh){ close() }
            line += `${fresh ? 'M' : 'L'}${x(p.t)},${y(p[basis])} `
            run.push(p)
        })
        close()
        svg.append(el('path', { d: area, class: 'iv-area' }), el('path', { d: line, class: 'iv-line' }))
        const last = points[points.length - 1]
        svg.append(el('circle', { cx: x(last.t), cy: y(last[basis]), r: 4, class: 'iv-dot' }))
        const hair = el('line', { y1: T, y2: H - B, class: 'iv-hair', visibility: 'hidden' })
        const dot = el('circle', { r: 4, class: 'iv-dot', visibility: 'hidden' })
        svg.append(hair, dot)
        box.append(svg)

        const show = (i) => {
            const p = points[i]
            hair.setAttribute('x1', x(p.t)); hair.setAttribute('x2', x(p.t)); hair.setAttribute('visibility', 'visible')
            dot.setAttribute('cx', x(p.t)); dot.setAttribute('cy', y(p[basis])); dot.setAttribute('visibility', 'visible')
            tip.innerHTML = ''
            const strong = document.createElement('strong'); strong.textContent = iv_money(p[basis], p.key_price)
            const rows = [`Items ${iv_ref(p.items?.[basis])} (${num(p.items?.count)} copies)`, `Keys ${num(p.keys)} at ${iv_ref(p.key_price)}`, `Metal ${iv_ref(p.metal)}`, new Date(p.t).toLocaleString()]
            tip.append(strong, ...rows.map((text) => { const s = document.createElement('span'); s.textContent = text; return s }))
            tip.hidden = false
            const left = Math.min(Math.max(x(p.t) + 12, 0), W - tip.offsetWidth - 4)
            tip.style.left = `${x(p.t) > W - tip.offsetWidth - 20 ? x(p.t) - tip.offsetWidth - 12 : left}px`
            tip.style.top = `${Math.max(0, y(p[basis]) - tip.offsetHeight - 10)}px`
        }
        const hide = () => { hair.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true }
        const nearest = (px) => {
            const t = t0 + (px - L) / (W - L - R) * span
            let best = 0
            points.forEach((p, i) => { if(Math.abs(p.t - t) < Math.abs(points[best].t - t)){ best = i } })
            return best
        }
        let current = points.length - 1
        svg.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); current = nearest((e.clientX - r.left) * W / r.width); show(current) })
        svg.addEventListener('pointerleave', hide)
        box.tabIndex = 0
        box.onkeydown = (e) => {
            if(e.key == 'ArrowLeft' || e.key == 'ArrowRight'){ e.preventDefault(); current = Math.min(points.length - 1, Math.max(0, current + (e.key == 'ArrowLeft' ? -1 : 1))); show(current) }
            if(e.key == 'Escape'){ hide() }
        }
        box.onfocus = () => show(current)
        box.onblur = hide
    }

    const inventory_value = async (root) => {
        root.innerHTML = head('Inventory value', 'Everything the bots hold: item copies at their current prices plus keys and metal, measured every 15 minutes. Profit is how much that grew over the period.', '<button id="iv-measure">Measure now</button>') +
            `<div class="iv-filters">
                <div class="admin-segment" role="radiogroup" aria-label="Period" id="iv-period">${IV_PERIODS.map(([v, t]) => `<button type="button" role="radio" data-period="${v}">${t}</button>`).join('')}</div>
                <div class="iv-custom" id="iv-custom" hidden>
                    <label>From <input type="date" id="iv-from"></label>
                    <label>To <input type="date" id="iv-to"></label>
                </div>
                <div class="admin-segment" role="radiogroup" aria-label="Value the items at" id="iv-basis">
                    <button type="button" role="radio" data-basis="sell" title="What the site sells each copy for">Sell prices</button>
                    <button type="button" role="radio" data-basis="buy" title="What the bots pay for each copy">Buy prices</button>
                </div>
            </div>
            <div id="iv-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>`

        const today = new Date(), week = new Date(Date.now() - 7 * IV_DAY)
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if(!iv_state.from){ iv_state.from = ymd(week); iv_state.to = ymd(today) }
        root.querySelector('#iv-from').value = iv_state.from
        root.querySelector('#iv-to').value = iv_state.to
        root.querySelector('#iv-from').max = root.querySelector('#iv-to').max = ymd(today)

        let data = null
        const paint = () => {
            root.querySelectorAll('#iv-period button').forEach((b) => b.setAttribute('aria-checked', b.dataset.period == iv_state.period))
            root.querySelectorAll('#iv-basis button').forEach((b) => b.setAttribute('aria-checked', b.dataset.basis == iv_state.basis))
            root.querySelector('#iv-custom').hidden = iv_state.period != 'custom'
            const box = root.querySelector('#iv-body')
            if(!data){ return }
            if(data.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(data.message)}</p>`; return }
            const b = iv_state.basis
            const st = data.state || {}
            const status_line = `<p class="muted small iv-status">Last measured ${esc(ago(st.last))}${st.error ? ` · <span class="iv-error">Last try failed: ${esc(st.error)} (${esc(ago(st.error_at))})</span>` : ''}</p>`
            if(!data.end){
                box.innerHTML = `<div class="admin-card"><p class="admin-empty">${data.first_ever ? 'No measurements in this period. The first one is from ' + esc(when(data.first_ever)) + '.' : 'No measurements yet. The first one is taken within 15 minutes of the site starting, or now with Measure now.'}</p></div>${status_line}`
                return
            }
            const s = data.start, e = data.end
            const key = e.key_price
            const change = e[b] - s[b]
            const pct = s[b] > 0 ? change / s[b] * 100 : 0
            const dir = change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat'
            const arrow = { up: '▲', down: '▼', flat: '■' }[dir]
            const period_name = iv_state.period == 'custom' ? 'this period' : `the last ${IV_PERIODS.find(([v]) => v == iv_state.period)[1]}`
            const partial = data.first_ever && data.first_ever > data.from + 30 * 60 * 1000
            const d_items = e.items[b] - s.items[b], d_keys = e.keys - s.keys, d_metal = e.metal - s.metal
            const bots = Object.entries(data.bots || {}).sort((x, y) => y[1][b] - x[1][b])
            const total_count = bots.reduce((n, [, v]) => n + v.count, 0)

            box.innerHTML = `<div class="iv-kpis">
                    <div class="iv-hero ${dir}">
                        <span class="label">Profit, ${esc(period_name)}</span>
                        <strong>${iv_money(change, key, true)}</strong>
                        <span class="sub"><b>${arrow} ${Math.abs(pct).toFixed(1)}%</b> · ${iv_ref(s[b])} → ${iv_ref(e[b])}${data.trades != null ? ` · ${num(data.trades)} trade${data.trades == 1 ? '' : 's'}` : ''}</span>
                        ${partial ? `<span class="sub">Measured since ${esc(when(data.first_ever))}, so this covers less than the whole period.</span>` : ''}
                    </div>
                    ${stat('Worth now', iv_money(e[b], key), iv_ref(e[b]))}
                    ${stat('Items', iv_money(e.items[b], key), `${num(e.items.count)} copies · ${iv_money(d_items, key, true)}`)}
                    ${stat('Keys', num(e.keys), `${d_keys > 0 ? '+' : d_keys < 0 ? '−' : ''}${Math.abs(num(d_keys))} · 1 key = ${iv_ref(key)}`)}
                    ${stat('Metal', iv_ref(e.metal), `${d_metal > 0 ? '+' : d_metal < 0 ? '−' : ''}${iv_ref(Math.abs(d_metal))}`)}
                </div>
                <div class="admin-card iv-chart-card">
                    <h3>Worth over time <span class="muted">(items at ${b == 'sell' ? 'sell' : 'buy'} prices + keys + metal)</span></h3>
                    <div class="iv-chart-wrap"><div class="iv-chart" id="iv-chart" aria-describedby="iv-help"></div><div class="iv-tip" id="iv-tip" hidden></div></div>
                    <p class="muted small" id="iv-help">Point at the line (or focus it and use the arrow keys) to see each measurement.</p>
                    <details class="iv-table"><summary>Show as a table</summary>
                        <table><tr><th>Time</th><th>Worth</th><th>Items</th><th>Keys</th><th>Metal</th></tr>
                        ${[...data.points].reverse().map((p) => `<tr><td>${esc(new Date(p.t).toLocaleString())}</td><td>${iv_ref(p[b])}</td><td>${iv_ref(p.items?.[b])}</td><td>${num(p.keys)}</td><td>${iv_ref(p.metal)}</td></tr>`).join('')}
                        </table>
                    </details>
                </div>
                <div class="admin-card">
                    <h3>Items by bot <span class="muted">(${esc(when(e.t))})</span></h3>
                    ${bots.length ? `<table class="iv-bots"><tr><th>Bot</th><th>Copies</th><th>Worth</th></tr>
                        ${bots.map(([id, v]) => `<tr><td>${esc(data.bot_names?.[id] || (id == 'unknown' ? 'Bot not recorded' : id))}</td><td>${num(v.count)}</td><td>${iv_money(v[b], key)}</td></tr>`).join('')}
                        <tr class="iv-sum"><td>All bots</td><td>${num(total_count)}</td><td>${iv_money(e.items[b], key)}</td></tr></table>` : '<p class="admin-empty">The bots hold no items.</p>'}
                    <p class="muted small">Keys and metal are counted for all bots together (the bot server sends their sum).${data.unpriced ? ` ${num(data.unpriced)} cop${data.unpriced == 1 ? 'y has' : 'ies have'} no price yet and count as 0.` : ''}</p>
                </div>
                ${status_line}`
            iv_chart(box.querySelector('#iv-chart'), box.querySelector('#iv-tip'), data.points, b, key)
        }

        const load = async () => {
            const body = root.querySelector('#iv-body')
            body.classList.add('is-loading')
            const { from, to } = iv_range()
            data = await api(`/api/admin/inventory_value?from=${from}&to=${to}`)
            body.classList.remove('is-loading')
            paint()
        }

        root.querySelector('#iv-period').addEventListener('click', (e) => {
            const v = e.target.closest('[data-period]')?.dataset.period
            if(!v || v == iv_state.period){ return }
            iv_state.period = v
            paint(); load()
        })
        root.querySelector('#iv-basis').addEventListener('click', (e) => {
            const v = e.target.closest('[data-basis]')?.dataset.basis
            if(!v || v == iv_state.basis){ return }
            iv_state.basis = v
            paint() // both values are already loaded
        })
        for(const id of ['#iv-from', '#iv-to']){
            root.querySelector(id).addEventListener('change', () => {
                iv_state.from = root.querySelector('#iv-from').value
                iv_state.to = root.querySelector('#iv-to').value
                if(iv_state.from && iv_state.to && iv_state.from <= iv_state.to){ load() }
            })
        }
        root.querySelector('#iv-measure').addEventListener('click', async (e) => {
            e.target.disabled = true
            const res = await api('/api/admin/inventory_value/measure', {})
            e.target.disabled = false
            if(toast(res, 'Measured.')){ load() }
        })
        let width = root.clientWidth
        const on_resize = () => { if(root.clientWidth != width){ width = root.clientWidth; paint() } }
        window.addEventListener('resize', on_resize)
        paint()
        await load()
        const timer = setInterval(() => { if(!document.hidden && iv_state.period != 'custom'){ load() } }, 5 * 60 * 1000)
        return () => { clearInterval(timer); window.removeEventListener('resize', on_resize) }
    }

    /* ========================= FLIPS ========================= */

    // Each item copy the bots sold, against what they paid for it (service/flips.js). Same periods as Inventory value.
    const fl_state = { period: '7d', from: '', to: '' }
    const fl_range = () => {
        const now = Date.now()
        if(fl_state.period == 'custom'){
            const from = Date.parse(fl_state.from + 'T00:00:00')
            const to = Date.parse(fl_state.to + 'T23:59:59')
            return { from: Number.isFinite(from) ? from : now - 7 * IV_DAY, to: Number.isFinite(to) ? Math.min(to, now) : now }
        }
        const d = new Date(now)
        if(fl_state.period == '1m'){ d.setMonth(d.getMonth() - 1); return { from: d.getTime(), to: now } }
        if(fl_state.period == '1y'){ d.setFullYear(d.getFullYear() - 1); return { from: d.getTime(), to: now } }
        return { from: now - (fl_state.period == '1d' ? 1 : 7) * IV_DAY, to: now }
    }
    // 5400000 -> "1.5 h", 3 days -> "3 days"
    const fl_held = (ms) => {
        if(ms == null){ return '–' }
        const h = ms / 3600000
        if(h < 1){ return `${Math.max(1, Math.round(ms / 60000))} min` }
        if(h < 48){ return `${Math.round(h * 10) / 10} h` }
        return `${Math.round(h / 24 * 10) / 10} days`
    }
    const fl_profit = (ref, key) => ref == null ? '<span class="muted">–</span>' : `<span class="${ref > 0.005 ? 'fl-up' : ref < -0.005 ? 'fl-down' : ''}">${iv_money(ref, key, true)}</span>`

    const flips_section = async (root) => {
        root.innerHTML = head('Flips', 'Every item copy the bots sold, against what they paid for it. The bots\' saved trades are read every 2 minutes.', '<button id="fl-check">Check now</button>') +
            `<div class="iv-filters">
                <div class="admin-segment" role="radiogroup" aria-label="Period" id="fl-period">${IV_PERIODS.map(([v, t]) => `<button type="button" role="radio" data-period="${v}">${t}</button>`).join('')}</div>
                <div class="iv-custom" id="fl-custom" hidden>
                    <label>From <input type="date" id="fl-from"></label>
                    <label>To <input type="date" id="fl-to"></label>
                </div>
            </div>
            <div id="fl-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>`

        const today = new Date(), week = new Date(Date.now() - 7 * IV_DAY)
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if(!fl_state.from){ fl_state.from = ymd(week); fl_state.to = ymd(today) }
        root.querySelector('#fl-from').value = fl_state.from
        root.querySelector('#fl-to').value = fl_state.to
        root.querySelector('#fl-from').max = root.querySelector('#fl-to').max = ymd(today)

        let data = null
        const paint = () => {
            root.querySelectorAll('#fl-period button').forEach((b) => b.setAttribute('aria-checked', b.dataset.period == fl_state.period))
            root.querySelector('#fl-custom').hidden = fl_state.period != 'custom'
            const box = root.querySelector('#fl-body')
            if(!data){ return }
            if(data.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(data.message)}</p>`; return }
            const st = data.state || {}
            const status_line = `<p class="muted small iv-status">Last checked ${esc(ago(st.last))}${st.error && st.error_at > st.last ? ` · <span class="iv-error">Last try failed: ${esc(st.error)} (${esc(ago(st.error_at))})</span>` : ''}</p>`
            const s = data.summary, key = data.key_price
            if(!s.flips && !s.unknown){
                box.innerHTML = `<div class="admin-card"><p class="admin-empty">No sold copies in this period. Flips are counted from the trades the bots save: on the first run from the saved trades of the last 3 weeks, then as trades come in.</p></div>${status_line}`
                return
            }
            const dir = s.average > 0.005 ? 'up' : s.average < -0.005 ? 'down' : 'flat'
            const arrow = { up: '▲', down: '▼', flat: '■' }[dir]
            const period_name = fl_state.period == 'custom' ? 'this period' : `the last ${IV_PERIODS.find(([v]) => v == fl_state.period)[1]}`
            const names = data.bot_names || {}
            box.innerHTML = `<div class="iv-kpis">
                    <div class="iv-hero ${dir}">
                        <span class="label">Average profit per flip, ${esc(period_name)}</span>
                        <strong>${s.average == null ? '–' : iv_money(s.average, key, true)}</strong>
                        <span class="sub">${s.margin == null ? '' : `<b>${arrow} ${Math.abs(s.margin).toFixed(1)}%</b> on what the bots paid · `}${num(s.flips)} flip${s.flips == 1 ? '' : 's'}${s.held != null ? ` · held ${esc(fl_held(s.held))} on average` : ''}</span>
                    </div>
                    ${stat('Total profit', s.flips ? iv_money(s.profit, key, true) : '–', `${num(s.wins)} with profit · ${num(s.losses)} at a loss`)}
                    ${stat('Flips', num(s.flips), s.unknown ? `${num(s.unknown)} more sold without a known bought price` : 'every sold copy has a bought price')}
                    ${stat('Bought prices', `${num(s.paid)} exact`, `${num(s.estimated)} estimated from saved purchases`)}
                    ${stat('Time held', fl_held(s.held), 'from buying to selling')}
                </div>
                <div class="admin-card fl-card">
                    <h3>By item <span class="muted">(most flipped first)</span></h3>
                    ${data.items.length ? `<div class="fl-scroll"><table class="iv-bots fl-table"><tr><th>Item</th><th>Flips</th><th>Avg profit</th><th>Margin</th><th>Total</th><th>Held</th></tr>
                        ${data.items.map((i) => `<tr><td class="fl-name"><a href="/items/${encodeURIComponent(i.bp_sku)}" target="_blank" rel="noopener" translate="no">${esc(i.name)}</a></td><td>${num(i.flips)}${i.unknown ? ` <span class="muted" title="Sold without a known bought price">+${num(i.unknown)}</span>` : ''}</td><td>${fl_profit(i.average, key)}</td><td>${i.margin == null ? '–' : `${i.margin > 0 ? '+' : ''}${i.margin}%`}</td><td>${fl_profit(i.profit, key)}</td><td>${esc(fl_held(i.held))}</td></tr>`).join('')}
                        </table></div>` : '<p class="admin-empty">No sold copy in this period has a known bought price.</p>'}
                </div>
                <div class="admin-card fl-card">
                    <h3>Latest sold copies <span class="muted">(newest ${num(data.recent.length)})</span></h3>
                    <div class="fl-scroll"><table class="iv-bots fl-table"><tr><th>Sold</th><th>Item</th><th>Paid</th><th>Sold for</th><th>Profit</th><th>Held</th></tr>
                    ${data.recent.map((r) => `<tr><td title="${esc(names[r.bot] || r.bot)}">${esc(when(r.sold_at))}</td><td class="fl-name" translate="no">${esc(r.name)}</td><td>${r.cost == null ? '<span class="muted" title="Bought price not known">–</span>' : `${r.source == 'trade' ? '<span class="muted" title="Estimated: the oldest saved purchase of this item">≈</span> ' : ''}${iv_money(r.cost, key)}`}</td><td>${iv_money(r.sold, key)}</td><td>${fl_profit(r.profit, key)}</td><td>${esc(fl_held(r.held))}</td></tr>`).join('')}
                    </table></div>
                </div>
                <p class="muted small">Prices are counted in keys and ref as the items were priced, so a key price change between buying and selling isn't profit or loss; they're shown at today's key price (1 key = ${esc(iv_ref(key))}). Exact bought prices come from the bot server's record of what it paid for each copy; copies it has no record of get the oldest saved purchase of the same item (≈).</p>
                ${status_line}`
        }

        const load = async () => {
            const body = root.querySelector('#fl-body')
            body.classList.add('is-loading')
            const { from, to } = fl_range()
            data = await api(`/api/admin/flips?from=${from}&to=${to}`)
            body.classList.remove('is-loading')
            paint()
        }

        root.querySelector('#fl-period').addEventListener('click', (e) => {
            const v = e.target.closest('[data-period]')?.dataset.period
            if(!v || v == fl_state.period){ return }
            fl_state.period = v
            paint(); load()
        })
        for(const id of ['#fl-from', '#fl-to']){
            root.querySelector(id).addEventListener('change', () => {
                fl_state.from = root.querySelector('#fl-from').value
                fl_state.to = root.querySelector('#fl-to').value
                if(fl_state.from && fl_state.to && fl_state.from <= fl_state.to){ load() }
            })
        }
        root.querySelector('#fl-check').addEventListener('click', async (e) => {
            e.target.disabled = true
            const res = await api('/api/admin/flips/collect', {})
            e.target.disabled = false
            if(toast(res, 'Checked.')){ load() }
        })
        paint()
        await load()
        const timer = setInterval(() => { if(!document.hidden && fl_state.period != 'custom'){ load() } }, 2 * 60 * 1000)
        return () => clearInterval(timer)
    }

    /* ========================= SETTINGS ========================= */

    const LEVELS = [['info', 'Info'], ['warning', 'Warning'], ['danger', 'Important']]
    const SEASON_CHOICES = [['auto', 'Auto'], ['off', 'Off'], ['summer', 'Summer'], ['halloween', 'Scream Fortress'], ['smissmas', 'Smissmas']]

    const settings_section = async (root) => {
        if(!live.settings){
            const r = await api('/api/admin/settings')
            if(r.status != 'ok'){ root.innerHTML = head('Live settings') + `<p class="admin-error">${esc(r.message)}</p>`; return }
            live.settings = r.settings
            live.clients = r.clients || []
        }

        root.innerHTML = head('Live settings', 'Changes apply to the website right away and are sent to every connected app.') + `
            <div class="admin-meta" id="set-meta"></div>
            <div class="admin-setting-list">
                <div class="admin-card admin-setting" data-card="trading">
                    <div class="admin-setting-info"><h3>Trading</h3><p class="muted">Pause to stop new trade offers. Visitors see a notice; offers already sent are not touched.</p></div>
                    <div class="admin-setting-body">
                        <div class="admin-toggle-row"><label class="admin-switch"><input type="checkbox" id="set-trading" aria-label="Trading"><span></span></label><span class="admin-state" id="set-trading-state"></span></div>
                    </div>
                </div>

                <div class="admin-card admin-setting" data-card="announcement">
                    <div class="admin-setting-info"><h3>Announcement banner</h3><p class="muted">A short line under the menu on every page.</p></div>
                    <div class="admin-setting-body">
                        <label class="admin-toggle-row"><span class="admin-switch"><input type="checkbox" id="set-ann-enabled"><span></span></span>Show the banner</label>
                        <label class="admin-field">Text
                            <textarea id="set-ann-text" rows="2" maxlength="300" placeholder="e.g. Steam is having trouble, trades may be slow."></textarea>
                            <span class="admin-counter" id="set-ann-count"></span>
                        </label>
                        <div class="admin-segment" id="set-ann-level" role="radiogroup" aria-label="Banner color">
                            ${LEVELS.map(([v, t]) => `<button type="button" role="radio" data-level="${v}" class="lvl-${v}">${t}</button>`).join('')}
                        </div>
                        <div class="site-announcement admin-banner-preview" id="set-ann-preview"><span class="site-announcement-dot"></span><span class="site-announcement-text"></span></div>
                        <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save banner</button></div>
                    </div>
                </div>

                <div class="admin-card admin-setting" data-card="limits">
                    <div class="admin-setting-info"><h3>Item price limits</h3><p class="muted">The cheapest and dearest item the bot and item servers deal in.</p></div>
                    <div class="admin-setting-body">
                        <div class="admin-row-fields">
                            <label class="admin-field">Minimum <span class="admin-input-unit"><input type="number" id="set-min" min="0" step="0.01"><em>keys</em></span></label>
                            <label class="admin-field">Maximum <span class="admin-input-unit"><input type="number" id="set-max" min="0" step="0.01"><em>keys</em></span></label>
                        </div>
                        <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save limits</button></div>
                    </div>
                </div>

                <div class="admin-card admin-setting" data-card="reviews">
                    <div class="admin-setting-info"><h3>Ratings after trades</h3><p class="muted">After an accepted trade, users can rate the site with 1 to 5 stars. 4 or 5 stars also get a button to your Trustpilot page. See them under <a href="#ratings">Ratings</a>.</p></div>
                    <div class="admin-setting-body">
                        <label class="admin-toggle-row"><span class="admin-switch"><input type="checkbox" id="set-rev-enabled"><span></span></span>Ask for a rating</label>
                        <label class="admin-field">Trustpilot review link
                            <input type="url" id="set-rev-url" placeholder="https://www.trustpilot.com/review/tf2deal.com">
                            <span class="admin-help">Leave it empty to only collect ratings on the site.</span>
                        </label>
                        <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save link</button></div>
                    </div>
                </div>

                <div class="admin-card admin-setting" data-card="season">
                    <div class="admin-setting-info"><h3>Seasonal theme</h3><p class="muted">The look visitors get during TF2 events. Auto follows the event dates on teamfortress.com. Visitors can still pick their own theme in the menu.</p></div>
                    <div class="admin-setting-body">
                        <div class="admin-segment wrap" id="set-season" role="radiogroup" aria-label="Seasonal theme">
                            ${SEASON_CHOICES.map(([v, t]) => `<button type="button" role="radio" data-season="${v}">${t}</button>`).join('')}
                        </div>
                        <p class="muted small" id="set-season-state"></p>
                    </div>
                </div>

                <div class="admin-card admin-setting" data-card="blacklist">
                    <div class="admin-setting-info"><h3>Item blacklist <span class="admin-count" id="set-bl-count"></span></h3><p class="muted">The website refuses trades with these items. The list also goes to the bot server.</p></div>
                    <div class="admin-setting-body">
                        <form class="admin-inline-form" id="set-bl-form">
                            <input id="set-bl-input" list="set-bl-items" autocomplete="off" placeholder="Item name, e.g. Team Captain (paste several, one per line)">
                            <datalist id="set-bl-items"></datalist>
                            <button type="submit">Add</button>
                        </form>
                        <input type="search" class="admin-filter" id="set-bl-filter" placeholder="Filter the list…" hidden>
                        <div class="admin-chips" id="set-bl-list"></div>
                    </div>
                </div>

                <details class="admin-card wide admin-dev" id="set-dev">
                    <summary><span>For developers</span> <span class="muted" id="set-dev-sum"></span></summary>
                    <div class="admin-dev-body">
                        <section data-card="clients">
                            <h3>Connected apps</h3>
                            <ul class="admin-clients" id="set-clients"></ul>
                        </section>
                        <section data-card="activity">
                            <h3>Recent changes</h3>
                            <ul class="admin-activity" id="set-activity"></ul>
                        </section>
                        <section data-card="extra">
                            <h3>App values</h3>
                            <p class="muted">Your own settings for other apps, as a JSON object. Apps read them from <code>settings.extra</code> and can change them too.</p>
                            <textarea id="set-extra" class="admin-code" rows="6" spellcheck="false"></textarea>
                            <p class="admin-error" id="set-extra-error" hidden></p>
                            <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save values</button></div>
                        </section>
                        <section>
                            <h3>Connect another app</h3>
                            <p class="muted">Use the same <code>SERVER_TOKEN</code> and <code>SERVER_SECRET</code> as the bot and item servers. Full guide: <code>SETTINGS.md</code> in the project.</p>
<pre class="admin-code"><code>import { io } from "socket.io-client";

const live = io("${esc(location.origin)}/settings", {
  auth: { server_token: process.env.SERVER_TOKEN, server_secret: process.env.SERVER_SECRET, app: "bot server" }
});

live.on("settings:init", ({ settings }) =&gt; apply(settings));
live.on("settings:changed", ({ settings, changed, by }) =&gt; apply(settings));

// change something (only the fields you send are changed)
live.emit("settings:update", { trading_state: 0 }, (res) =&gt; console.log(res.status, res.message));</code></pre>
                        </section>
                    </div>
                </details>
            </div>`

        const $ = (sel) => root.querySelector(sel)
        const card = (name) => root.querySelector(`[data-card="${name}"]`)
        const dirty = new Set()
        const mark = (name, on = true) => {
            on ? dirty.add(name) : dirty.delete(name)
            card(name)?.classList.toggle('is-dirty', on)
            card(name)?.classList.remove('is-stale')
        }
        let ann_level = 'info'

        const fill_trading = () => {
            const on = live.settings.trading_state === 1
            $('#set-trading').checked = on
            $('#set-trading-state').innerHTML = on ? 'On: visitors can trade.' : '<span class="admin-bad">Paused:</span> visitors can\'t create new trades.'
        }
        const ann_preview = () => {
            const text = $('#set-ann-text').value.trim()
            $('#set-ann-count').textContent = `${$('#set-ann-text').value.length}/300`
            $('#set-ann-preview').className = `site-announcement admin-banner-preview level-${ann_level} ${text ? '' : 'is-empty'}`
            $('#set-ann-preview .site-announcement-text').textContent = text || 'The banner text shows here.'
            root.querySelectorAll('#set-ann-level button').forEach((b) => b.setAttribute('aria-checked', b.dataset.level == ann_level))
        }
        const fill_announcement = () => {
            const a = live.settings.announcement
            $('#set-ann-enabled').checked = a.enabled
            $('#set-ann-text').value = a.text
            ann_level = a.level
            ann_preview()
        }
        const fill_limits = () => {
            $('#set-min').value = live.settings.min_item_key
            $('#set-max').value = live.settings.max_item_key
        }
        const fill_blacklist = () => {
            const list = live.settings.item_blacklist
            const filter = $('#set-bl-filter').value.trim().toLowerCase()
            $('#set-bl-count').textContent = list.length
            $('#set-bl-filter').hidden = list.length < 12
            const shown = filter ? list.filter((n) => n.toLowerCase().includes(filter)) : list
            $('#set-bl-list').innerHTML = list.length == 0 ? '<p class="admin-empty">No items are blacklisted.</p>'
                : shown.map((n) => `<span class="admin-chip">${esc(n)}<button type="button" data-remove="${esc(n)}" aria-label="Remove ${esc(n)}">×</button></span>`).join('') || '<p class="admin-empty">Nothing matches.</p>'
        }
        const fill_reviews = () => {
            const v = live.settings.reviews || { enabled: true, trustpilot_url: '' }
            $('#set-rev-enabled').checked = v.enabled
            $('#set-rev-url').value = v.trustpilot_url
        }
        const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        const fill_season = async () => {
            const choice = live.settings.season || 'auto'
            root.querySelectorAll('#set-season button').forEach((b) => b.setAttribute('aria-checked', b.dataset.season == choice))
            const r = await api('/api/admin/settings')
            const st = r?.season
            if(!st){ $('#set-season-state').textContent = ''; return }
            const a = st.active, d = st.detected
            const now = a.id ? `Now showing: <strong>${esc(a.name)}</strong>${a.ends ? ` until ${day(a.ends)}` : ''} (${esc(a.source)}).` : `Now showing: the normal look${a.source ? ` (${esc(a.source)})` : ''}.`
            const auto = choice != 'auto' ? ` On Auto it would be ${d.id ? `${esc(d.name)}` : 'the normal look'}.` : ''
            const src = st.source.ok ? `teamfortress.com read ${ago(st.source.fetched)}.` : st.source.error ? `teamfortress.com could not be read (${esc(st.source.error)}), using the usual dates.` : 'teamfortress.com not read yet.'
            $('#set-season-state').innerHTML = `${now}${auto} ${src}`
        }
        const fill_extra = () => {
            $('#set-extra').value = JSON.stringify(live.settings.extra || {}, null, 2)
            $('#set-extra-error').hidden = true
        }
        const fill_meta = () => {
            const s = live.settings
            $('#set-meta').innerHTML = s.updated ? `Last change ${ago(s.updated)}${s.updated_by ? ` by ${by_label(parse_by(s.updated_by))}` : ''}` : ''
        }
        const fill_clients = () => {
            const apps = live.clients.filter((c) => c.kind != 'admin').length
            $('#set-dev-sum').textContent = `${apps} app${apps == 1 ? '' : 's'} connected`
            $('#set-clients').innerHTML = live.clients.length == 0 ? '<li class="admin-empty">No app is connected.</li>'
                : live.clients.map((c) => `<li><span class="admin-dot kind-${c.kind}"></span><div><strong>${c.kind == 'admin' ? 'Admin panel' : esc(c.name)}</strong>
                    <span class="muted">${c.can_write ? 'read & write' : 'read only'} · connected ${ago(c.since)}</span></div></li>`).join('')
        }
        const fill_activity = () => {
            $('#set-activity').innerHTML = live.log.length == 0 ? '<li class="admin-empty">No changes yet.</li>'
                : live.log.map((l) => `<li><span class="muted">${when(l.time)}</span><span>${by_label(l.by)}</span><span>${l.changed ? l.changed.map((k) => `<span class="admin-tag">${SETTING_NAMES[k] || esc(k)}</span>`).join(' ') : '<span class="muted">last saved change</span>'}</span></li>`).join('')
        }

        const FILL = { trading: fill_trading, announcement: fill_announcement, limits: fill_limits, reviews: fill_reviews, season: fill_season, blacklist: fill_blacklist, extra: fill_extra }
        const KEYS = { trading: ['trading_state'], announcement: ['announcement'], limits: ['min_item_key', 'max_item_key'], reviews: ['reviews'], season: ['season'], blacklist: ['item_blacklist'], extra: ['extra'] }
        const fill_all = (changed) => {
            for (const [name, fill] of Object.entries(FILL)) {
                if(changed && !KEYS[name].some((k) => changed.includes(k))){ continue }
                if(dirty.has(name)){ card(name)?.classList.add('is-stale'); continue } // keep what the admin is typing
                fill()
            }
            fill_meta(); fill_clients(); fill_activity()
        }
        fill_all()

        // trading
        $('#set-trading').addEventListener('change', async (e) => {
            const on = e.target.checked
            if(!on && !confirm('Pause trading? Visitors can\'t create new trades until you turn it back on.')){ e.target.checked = true; return }
            if(!toast(await save_settings({ trading_state: on ? 1 : 0 }), on ? 'Trading is on.' : 'Trading is paused.')){ e.target.checked = !on }
            fill_trading()
        })

        // announcement
        $('#set-ann-text').addEventListener('input', () => { mark('announcement'); ann_preview() })
        $('#set-ann-level').addEventListener('click', (e) => {
            const level = e.target.closest('button')?.dataset.level
            if(level){ ann_level = level; mark('announcement'); ann_preview() }
        })
        const save_announcement = async (enabled) => {
            const text = $('#set-ann-text').value.trim()
            if(enabled && !text){ iziToast.warning({ title: 'Write the banner text first', message: '' }); $('#set-ann-enabled').checked = false; return }
            const ok = toast(await save_settings({ announcement: { enabled, text, level: ann_level } }), enabled ? 'Banner saved and shown.' : 'Banner saved.')
            if(ok){ mark('announcement', false); fill_announcement() } else { $('#set-ann-enabled').checked = live.settings.announcement.enabled }
        }
        $('#set-ann-enabled').addEventListener('change', (e) => save_announcement(e.target.checked))
        card('announcement').querySelector('[data-save]').addEventListener('click', () => save_announcement($('#set-ann-enabled').checked))

        // limits
        root.querySelectorAll('#set-min, #set-max').forEach((el) => el.addEventListener('input', () => mark('limits')))
        card('limits').querySelector('[data-save]').addEventListener('click', async () => {
            const r = await save_settings({ min_item_key: $('#set-min').value, max_item_key: $('#set-max').value })
            if(toast(r, 'Price limits saved.')){ mark('limits', false); fill_limits() }
        })

        // ratings
        $('#set-rev-url').addEventListener('input', () => mark('reviews'))
        $('#set-rev-enabled').addEventListener('change', async (e) => {
            const on = e.target.checked
            if(!toast(await save_settings({ reviews: { enabled: on } }), on ? 'Ratings are on.' : 'Ratings are off.')){ e.target.checked = !on }
        })
        card('reviews').querySelector('[data-save]').addEventListener('click', async () => {
            const r = await save_settings({ reviews: { trustpilot_url: $('#set-rev-url').value.trim() } })
            if(toast(r, 'Trustpilot link saved.')){ mark('reviews', false); fill_reviews() }
        })

        // seasonal theme
        $('#set-season').addEventListener('click', async (e) => {
            const value = e.target.closest('button')?.dataset.season
            if(!value || value == (live.settings.season || 'auto')){ return }
            const label = SEASON_CHOICES.find(([v]) => v == value)[1]
            if(toast(await save_settings({ season: value }), `Seasonal theme: ${label}.`)){ fill_season() }
        })

        // blacklist
        let search_timer
        $('#set-bl-input').addEventListener('input', () => {
            clearTimeout(search_timer)
            const q = $('#set-bl-input').value
            if(q.includes('\n') || q.length < 2){ return }
            search_timer = setTimeout(async () => {
                const r = await api(`/api/admin/items/search?q=${encodeURIComponent(q)}`)
                $('#set-bl-items').innerHTML = (r.items || []).map((i) => `<option value="${esc(i.bp_sku)}">`).join('')
            }, 250)
        })
        $('#set-bl-input').addEventListener('paste', (e) => {
            const text = e.clipboardData?.getData('text') || ''
            if(text.includes('\n')){
                e.preventDefault()
                $('#set-bl-input').value = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(' | ')
            }
        })
        $('#set-bl-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const names = $('#set-bl-input').value.split('|').map((s) => s.trim()).filter(Boolean)
            if(names.length == 0){ return }
            if(toast(await save_settings({ item_blacklist: { add: names } }), names.length == 1 ? `${esc(names[0])} is blacklisted.` : `${names.length} items blacklisted.`)){
                $('#set-bl-input').value = ''
                fill_blacklist()
            }
        })
        $('#set-bl-filter').addEventListener('input', fill_blacklist)
        $('#set-bl-list').addEventListener('click', async (e) => {
            const name = e.target.closest('[data-remove]')?.dataset.remove
            if(name && toast(await save_settings({ item_blacklist: { remove: [name] } }), `${esc(name)} removed from the blacklist.`)){ fill_blacklist() }
        })

        // extra (app values)
        $('#set-extra').addEventListener('input', () => mark('extra'))
        card('extra').querySelector('[data-save]').addEventListener('click', async () => {
            const error = $('#set-extra-error')
            let next
            try { next = JSON.parse($('#set-extra').value || '{}') } catch (err) { error.textContent = `That's not valid JSON: ${err.message}`; error.hidden = false; return }
            if(next == null || typeof next != 'object' || Array.isArray(next)){ error.textContent = 'App values must be a JSON object: { "key": value }.'; error.hidden = false; return }
            error.hidden = true
            const patch = { ...next }
            for (const key of Object.keys(live.settings.extra || {})) { if(!(key in next)){ patch[key] = null } } // removed keys
            if(toast(await save_settings({ extra: patch }), 'App values saved.')){ mark('extra', false); fill_extra() }
        })

        // discard buttons
        root.querySelectorAll('[data-discard]').forEach((btn) => btn.addEventListener('click', () => {
            const name = btn.closest('[data-card]').dataset.card
            mark(name, false)
            FILL[name]()
        }))

        const on_live = (type, event) => {
            if(type == 'clients'){ fill_clients(); return }
            fill_all(type == 'changed' ? event?.changed : null)
        }
        live.listeners.add(on_live)
        const ticker = setInterval(() => { fill_meta(); fill_clients() }, 30000)
        refresh_clients()
        return () => { live.listeners.delete(on_live); clearInterval(ticker) }
    }

    /* ========================= USERS ========================= */

    const ROLES = [[0, 'Banned'], [1, 'User'], [2, 'Premium'], [3, 'Admin']]

    const users = async (root) => {
        root.innerHTML = head('Users', 'Find a user by SteamID64 or by part of their trade link. Banned users can\'t create trades.') + `
            <form class="admin-inline-form" id="user-search">
                <input type="search" name="q" placeholder="SteamID64 or trade link…" autocomplete="off">
                <button type="submit" class="primary">Search</button>
            </form>
            <div id="user-list"></div>`

        const list = root.querySelector('#user-list')
        const load = async (q = '') => {
            list.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span> Loading…</div>'
            const res = await api(`/api/admin/users?q=${encodeURIComponent(q)}`)
            if(res.status != 'ok'){ list.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            if(res.users.length == 0){ list.innerHTML = '<p class="admin-empty">No users found.</p>'; return }
            list.innerHTML = `<p class="muted">${q ? `${res.users.length} result${res.users.length == 1 ? '' : 's'}` : 'Newest users'}</p>
                <div class="admin-table-wrap"><table class="admin-table">
                <thead><tr><th>User</th><th>Joined</th><th>Trades</th><th>Giveaways</th><th>Trade link</th><th>Role</th></tr></thead>
                <tbody>${res.users.map((u) => `<tr data-steamid="${esc(u.steamid)}" class="${u.role === 0 ? 'is-banned' : ''}">
                    <td><span class="admin-dot ${u.online ? 'online' : ''}" title="${u.online ? 'Online now' : 'Offline'}"></span>
                        <a href="https://steamcommunity.com/profiles/${esc(u.steamid)}" target="_blank" rel="nofollow">${esc(u.steamid)}</a>
                        ${u.group_member ? '<span class="admin-tag">group</span>' : ''}</td>
                    <td>${u.firstlogin ? new Date(u.firstlogin).toLocaleDateString() : '–'}</td>
                    <td>${num(u.trades)}</td>
                    <td>${num(u.giveaways?.entries || 0)} / ${num(u.giveaways?.won || 0)} won</td>
                    <td>${u.tradelink ? `<a href="${esc(u.tradelink)}" target="_blank" rel="nofollow">Open</a>` : '<span class="muted">none</span>'}</td>
                    <td><select class="role-select" aria-label="Role">${ROLES.map(([v, t]) => `<option value="${v}" ${u.role == v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
                </tr>`).join('')}</tbody></table></div>`
        }

        root.querySelector('#user-search').addEventListener('submit', (e) => { e.preventDefault(); load(e.target.q.value.trim()) })
        list.addEventListener('change', async (e) => {
            if(!e.target.classList.contains('role-select')){ return }
            const row = e.target.closest('tr')
            const role = Number(e.target.value)
            if(role === 0 && !confirm('Ban this user? They won\'t be able to create trades.')){ load(root.querySelector('#user-search').q.value.trim()); return }
            const r = await api(`/api/admin/users/${row.dataset.steamid}/role`, { role })
            if(toast(r, `Role changed to ${ROLES.find(([v]) => v == role)[1]}.`)){ row.classList.toggle('is-banned', role === 0) }
        })
        load()
    }

    /* ========================= RATINGS ========================= */

    const stars_html = (n) => `<span class="admin-stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<span>${'★'.repeat(5 - n)}</span></span>`

    const ratings = async (root) => {
        root.innerHTML = head('Ratings', 'Stars users gave after an accepted trade, newest first.') + '<div id="rt-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>'
        let filter = 0

        const draw = async () => {
            const res = await api(`/api/admin/ratings${filter ? `?stars=${filter}` : ''}`)
            const box = root.querySelector('#rt-body')
            if(!box){ return }
            if(res.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            const { summary, ratings } = res
            const max = Math.max(1, ...summary.dist)
            box.innerHTML = `<div class="admin-grid">
                    <div class="admin-card admin-rating-summary">
                        <strong class="admin-rating-avg">${summary.avg != null ? summary.avg.toFixed(1) : '–'}</strong>
                        ${summary.avg != null ? stars_html(Math.round(summary.avg)) : ''}
                        <span class="muted">${num(summary.count)} rating${summary.count == 1 ? '' : 's'}</span>
                    </div>
                    <div class="admin-card">
                        <h3>Stars</h3>
                        <div class="admin-rating-bars">${[5, 4, 3, 2, 1].map((n) => `<button type="button" data-stars="${n}" class="${filter == n ? 'active' : ''}" title="Show only ${n} star ratings">
                            <span>${n} ★</span><span class="bar"><i style="width:${Math.round(summary.dist[n - 1] / max * 100)}%"></i></span><span class="muted">${num(summary.dist[n - 1])}</span></button>`).join('')}</div>
                        ${filter ? '<button type="button" class="admin-link" data-stars="0">Show all ratings</button>' : ''}
                    </div>
                </div>
                ${ratings.length == 0 ? '<p class="admin-empty">No ratings yet.</p>' : `<ul class="admin-ratings">${ratings.map((r) => `<li>
                    <div class="admin-rating-top">${stars_html(r.stars)}
                        <a href="https://steamcommunity.com/profiles/${esc(r.steamid)}" target="_blank" rel="nofollow">${esc(r.name || r.steamid)}</a>
                        ${r.verified ? '<span class="admin-tag">traded</span>' : ''}
                        ${r.trustpilot ? '<span class="admin-tag">opened Trustpilot</span>' : ''}
                        <span class="muted">${when(r.created)}</span></div>
                    ${r.comment ? `<p class="admin-rating-comment">${esc(r.comment)}</p>` : ''}
                </li>`).join('')}</ul>`}`
        }

        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-stars]')
            if(!btn){ return }
            const n = Number(btn.dataset.stars)
            filter = filter == n ? 0 : n
            draw()
        })
        await draw()
    }

    /* ========================= TRADE RECORDS ========================= */
    // The newest records the bots saved in `trades`, and whether Latest trades on the home page shows each one.

    const TR_STATUS = { shown: 'Shown', skipped: 'Skipped', duplicate: 'Duplicate', older: 'Not in the newest 15' }

    const trade_records = async (root) => {
        root.innerHTML = head('Trade records', "The newest trades the bots saved, and whether Latest trades on the home page shows each one.",
            '<button type="button" id="tr-copy-all">Copy all records</button> <button type="button" id="tr-reload">Reload</button>') + '<div id="tr-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>'
        let records = []

        const copy = async (text) => {
            try { await navigator.clipboard.writeText(text); iziToast.success({ title: 'Copied', message: '' }) }
            catch (e) { iziToast.error({ title: 'Error', message: "Couldn't copy. Open the record and select its text instead." }) }
        }
        const draw = async () => {
            const res = await api('/api/admin/trade_records')
            const box = root.querySelector('#tr-body')
            if(!box){ return }
            if(res.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            records = res.records
            box.innerHTML = records.length == 0 ? '<p class="admin-empty">No trade records yet.</p>' : `<ul class="admin-trade-records">${records.map((r, i) => `<li>
                    <div class="admin-tr-top"><span class="admin-tag tr-${esc(r.status)}">${esc(TR_STATUS[r.status] || r.status)}</span>
                        <span>Bot gave ${esc(r.gave)}, got ${esc(r.got)}</span>
                        <span class="muted">${r.time ? when(r.time) : 'no time'}${r.partner ? ` · <a href="https://steamcommunity.com/profiles/${esc(r.partner)}" target="_blank" rel="nofollow">user</a>` : ''}${r.bot ? ` · bot ${esc(r.bot)}` : ''}</span></div>
                    ${r.reason ? `<p class="admin-tr-reason">${esc(r.reason)}</p>` : ''}
                    <details><summary>Record as saved</summary><p class="muted small">${esc(r.layout)}</p><pre>${esc(r.raw)}</pre><button type="button" data-copy="${i}">Copy record</button></details>
                </li>`).join('')}</ul>`
        }

        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-copy]')
            if(btn){ copy(records[Number(btn.dataset.copy)]?.raw || '') }
        })
        root.querySelector('#tr-copy-all').addEventListener('click', () => copy(records.map((r) => r.raw).join(',\n')))
        root.querySelector('#tr-reload').addEventListener('click', draw)
        await draw()
    }

    /* ========================= NOTIFICATIONS ========================= */
    // The bell in the site nav. New giveaways, giveaway winners and ticket replies are added automatically;
    // this sends an announcement to everyone (guests included) and lists what everyone currently sees.

    const NOTIF_LABEL = { announcement: 'Announcement', giveaway_new: 'New giveaway', giveaway_ended: 'Giveaway ended' }
    const notif_text = (n) => n.type == 'announcement' ? esc(n.text)
        : n.type == 'giveaway_new' ? `${esc(n.vars?.item)} is up for grabs.`
        : n.type == 'giveaway_ended' ? (n.vars?.winner ? `${esc(n.vars.winner)} won ${esc(n.vars?.item)}.` : `${esc(n.vars?.item)} ended without entries.`)
        : esc(n.type)

    const notifications_section = async (root) => {
        root.innerHTML = head('Notifications', 'Messages under the bell in the menu. New giveaways and winners are added by themselves.') + `
            <div class="admin-card">
                <h3>Send to everyone</h3>
                <form class="admin-form" id="notif-form">
                    <label>Message <textarea name="text" rows="3" maxlength="300" required placeholder="Trading is paused tonight from 22:00 to 23:00 UTC for bot maintenance."></textarea></label>
                    <label>Link (optional) <input name="link" maxlength="300" placeholder="/items or https://..."></label>
                    <div class="actions"><button type="submit" class="primary">Send notification</button></div>
                    <p class="muted small">It shows up right away on open pages. It is written as is: it isn't translated.</p>
                </form>
            </div>
            <h3>Sent to everyone</h3>
            <div id="notif-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>`

        const draw = async () => {
            const res = await api('/api/admin/notifications')
            const box = root.querySelector('#notif-body')
            if(!box){ return }
            if(res.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            box.innerHTML = res.notifications.length == 0 ? '<p class="admin-empty">Nothing yet.</p>' : `<ul class="admin-notifs">${res.notifications.map((n) => `<li data-id="${esc(n.id)}">
                    <div class="admin-notif-top"><span class="admin-tag">${esc(NOTIF_LABEL[n.type] || n.type)}</span><span class="muted">${when(n.created)}</span>
                        <button type="button" class="admin-link danger" data-delete>Delete</button></div>
                    <p>${notif_text(n)}</p>
                    ${n.link ? `<a class="muted small" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.link)}</a>` : ''}
                </li>`).join('')}</ul>`
        }

        root.querySelector('#notif-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const form = e.target
            const button = form.querySelector('button[type="submit"]')
            button.disabled = true
            const res = await api('/api/admin/notifications', { text: form.text.value, link: form.link.value })
            button.disabled = false
            if(toast(res, 'Sent to everyone.')){ form.reset(); draw() }
        })
        root.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-delete]')
            if(!btn){ return }
            const li = btn.closest('li')
            if(!confirm('Delete this notification? It disappears from everyone\'s bell.')){ return }
            if(toast(await api(`/api/admin/notifications/${li.dataset.id}/delete`, {}), 'Deleted.')){ draw() }
        })
        await draw()
    }

    /* ========================= ROUTER ========================= */

    const sections = { overview, value: inventory_value, flips: flips_section, settings: settings_section, users, ratings, trades: trade_records, notifications: notifications_section, tickets: (root) => tickets(root), blog, giveaways }
    let route_id = 0
    let cleanup = null

    const route = () => {
        const [wanted, ...args] = location.hash.slice(1).split('/') // #blog/edit/<id>: section + what to open in it
        const name = sections[wanted] ? wanted : 'overview'
        document.querySelectorAll('.admin-nav a').forEach((a) => {
            const open = a.dataset.section == name
            a.classList.toggle('active', open)
            if(open){ a.setAttribute('aria-current', 'page') } else { a.removeAttribute('aria-current') }
        })
        // phones and narrow windows: the links are one row that scrolls sideways, so bring the open one into view (without moving the page)
        const nav = document.querySelector('.admin-nav'), open_link = nav?.querySelector('a.active')
        if(open_link && nav.scrollWidth > nav.clientWidth){ nav.scrollLeft = open_link.offsetLeft - (nav.clientWidth - open_link.offsetWidth) / 2 }
        if(cleanup){ cleanup(); cleanup = null }

        const id = ++route_id
        const root = document.getElementById('admin-content')
        root.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span> Loading…</div>'
        Promise.resolve(sections[name](root, ...args)).then((stop) => {
            if(typeof stop != 'function'){ return }
            if(id == route_id){ cleanup = stop } else { stop() }
        })
    }

    window.admin_sections = sections
    // for the sections in other files (js/admin_bot_manager.js), loaded after this one
    window.admin_kit = {
        esc, when, ago, num, uptime, api, toast, head, stat, pill, QUALITY_NAMES,
        on_live: (fn) => { live.listeners.add(fn); return () => live.listeners.delete(fn) }
    }
    window.addEventListener('hashchange', route)
    document.addEventListener('DOMContentLoaded', () => {
        route()
        connect_live()
    })
})();
