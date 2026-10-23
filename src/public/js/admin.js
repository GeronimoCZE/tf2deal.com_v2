/* Admin panel: Overview, Inventory value, Live settings, Users, Ratings, Trade records, Notifications, Tickets, Blog, Giveaways (talk to /api/admin/*).
   Bot manager is in js/admin_bot_manager.js; it replaces the Stock limits and Listings pages below, which bot_manager doesn't read.
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
        root.innerHTML = `<h2>Support tickets</h2>
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

    const LANG_OPTIONS = [['en', 'English'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский'], ['zh', '中文']]
    const LANG_NAME = Object.fromEntries(LANG_OPTIONS)

    // "5/7 ✓" in the post list (AI translations, see src/service/translate.js)
    const translation_summary = (post, info) => {
        if(!post.published){ return '<span class="muted">drafts aren\'t translated</span>' }
        if(!info?.enabled){ return '<span class="muted">off</span>' }
        const states = Object.values(post.translation?.status || {})
        const done = states.filter((s) => s == 'done').length
        const failed = Object.entries(post.translation?.errors || {})
        if(failed.length && !post.translation?.queued){
            return `<span class="tr-error" title="${esc(failed.map(([l, m]) => `${LANG_NAME[l] || l}: ${m}`).join('\n'))}">${done}/${states.length}, ${failed.length} failed</span>`
        }
        if(done == states.length){ return `<span class="tr-done">${done}/${states.length} ✓</span>` }
        return `<span class="muted">${done}/${states.length}, translating…</span>`
    }

    // per language in the editor, with a link to read each translation
    const translation_detail = (post) => {
        if(!post.published){ return '<span class="muted">Translated after you publish the post.</span>' }
        const status = post.translation?.status || {}
        const errors = post.translation?.errors || {}
        return Object.entries(status).map(([lang, state]) => {
            const mark = state == 'done' ? '<span class="tr-done">✓</span>' : state == 'error' ? `<span class="tr-error" title="${esc(errors[lang])}">✕</span>` : '<span class="muted">…</span>'
            return `<a href="/${lang}/blog/${esc(post.slug)}" target="_blank">${esc(LANG_NAME[lang] || lang)}</a> ${mark}`
        }).join(' · ')
    }

    // #blog/new and #blog/edit/<id> (the admin bar's New → Blog post and Edit post) open the editor right away
    const blog = async (root, action, id) => {
        if(action == 'new' || (action == 'edit' && id)){
            history.replaceState(null, '', '#blog') // so the same link works again later
            if(action == 'new'){ return blog_editor(root, null) }
            const res = await api(`/api/admin/blog/${encodeURIComponent(id)}`)
            if(res.status == 'ok'){ return blog_editor(root, res.post) }
            toast(res)
        }
        root.innerHTML = `<h2>Blog</h2>
            <button class="primary" id="new-post">+ New post</button>
            <div class="admin-list" id="admin-posts">Loading...</div>`

        root.querySelector('#new-post').addEventListener('click', () => blog_editor(root, null))

        const res = await api('/api/admin/blog')
        const list = root.querySelector('#admin-posts')
        if(res.status != 'ok'){ list.textContent = res.message; return }
        if(!res.translation?.enabled){
            list.insertAdjacentHTML('beforebegin', `<p class="admin-note">AI translation is off. To translate posts into every site language automatically, add <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_AI_TOKEN</code> (free, Cloudflare Workers AI) or <code>ANTHROPIC_API_KEY</code> (Claude) to <code>.env</code> and restart. See <code>src/service/translate.js</code>.</p>`)
        } else {
            list.insertAdjacentHTML('beforebegin', `<p class="admin-note muted">AI translation: ${esc(res.translation.service)}</p>`)
        }
        if(res.posts.length == 0){ list.innerHTML = '<p class="admin-empty">No posts yet.</p>'; return }

        list.innerHTML = `<table>
            <tr><th>Title</th><th>Url</th><th>Status</th><th>Translations</th><th>Created</th><th></th></tr>
            ${res.posts.map((p) => `<tr data-id="${esc(p._id)}">
                <td>${esc(p.title)}</td>
                <td><a href="/blog/${esc(p.slug)}" target="_blank">/blog/${esc(p.slug)}</a></td>
                <td>${p.published ? 'Published' : 'Draft'}</td>
                <td>${translation_summary(p, res.translation)}</td>
                <td>${when(p.created)}</td>
                <td><button class="edit-post">Edit</button> ${(p.published && res.translation?.enabled) ? '<button class="translate-post">Translate again</button> ' : ''}<button class="delete-post">Delete</button></td>
            </tr>`).join('')}
        </table>`

        list.addEventListener('click', async (e) => {
            const id = e.target.closest('tr')?.dataset.id
            if(!id){ return }
            if(e.target.classList.contains('edit-post')){
                const res = await api(`/api/admin/blog/${id}`)
                if(res.status == 'ok'){ blog_editor(root, res.post) } else { toast(res) }
            }
            if(e.target.classList.contains('translate-post')){
                const res = await api(`/api/admin/blog/${id}/translate`, {})
                if(toast(res, 'Translating in the background. It takes about a minute per language.')){ blog(root) }
            }
            if(e.target.classList.contains('delete-post') && confirm('Delete this post? This cannot be undone.')){
                const res = await api(`/api/admin/blog/${id}/delete`, {})
                if(toast(res, 'Post deleted.')){ blog(root) }
            }
        })
    }

    const blog_editor = (root, post) => {
        root.innerHTML = `<h2>${post ? 'Edit post' : 'New post'}</h2>
            <form class="admin-form" id="post-form">
                <label>Title <input name="title" maxlength="150" required value="${esc(post?.title)}"></label>
                <label>Url (/blog/...) <input name="slug" maxlength="100" placeholder="made from the title if empty" value="${esc(post?.slug)}"></label>
                <label>Cover image url <input name="cover" maxlength="500" placeholder="https://..." value="${esc(post?.cover)}"></label>
                <label>Short description (shown in the list) <input name="excerpt" maxlength="300" value="${esc(post?.excerpt)}"></label>
                <label>Written in
                    <select name="lang">${LANG_OPTIONS.map(([code, name]) => `<option value="${code}" ${(post?.lang || 'en') == code ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
                </label>
                <label>Text
                    <textarea name="content" rows="16" required>${esc(post?.content)}</textarea>
                </label>
                <p class="muted">Formatting: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list item</code>, <code>&gt; quote</code>, <code>[link](https://...)</code>, <code>![image](https://...)</code>. Empty line = new paragraph.</p>
                <label class="check"><input type="checkbox" name="published" ${post?.published ? 'checked' : ''}> Published</label>
                <div class="actions">
                    <button type="button" id="cancel-post">Back</button>
                    <button type="button" id="preview-post">Preview</button>
                    <button type="submit" class="primary">Save</button>
                </div>
            </form>
            ${post ? `<div class="admin-translations"><strong>AI translations</strong> ${translation_detail(post)}</div>` : ''}
            <div class="post-content admin-preview" id="post-preview"></div>`

        const form = root.querySelector('#post-form')
        const values = () => ({
            title: form.title.value, slug: form.slug.value, cover: form.cover.value,
            excerpt: form.excerpt.value, content: form.content.value, published: form.published.checked, lang: form.lang.value
        })

        root.querySelector('#cancel-post').addEventListener('click', () => blog(root))
        root.querySelector('#preview-post').addEventListener('click', async () => {
            const res = await api('/api/admin/blog/preview', { content: form.content.value })
            root.querySelector('#post-preview').innerHTML = res.html || ''
        })
        form.addEventListener('submit', async (e) => {
            e.preventDefault()
            const res = await api(post ? `/api/admin/blog/${post._id}` : '/api/admin/blog', values())
            if(toast(res, 'Post saved.')){ blog_editor(root, res.post) }
        })
    }

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

    const giveaways = async (root) => {
        root.innerHTML = `<h2>Giveaways</h2><div id="admin-giveaways">Loading...</div>`
        const box = root.querySelector('#admin-giveaways')

        const res = await api('/api/admin/giveaways')
        if(res.status != 'ok'){ box.textContent = res.message; return }

        const active = res.giveaways.find((g) => g.status == 'active')
        const past = res.giveaways.filter((g) => g.status != 'active')

        const default_end = new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        const posts_off = Object.keys(POST_SERVICES).filter((key) => !res.posts?.[key]).map((key) => POST_SERVICES[key])
        const posts_note = posts_off.length == 0 ? '<p class="admin-note muted">New giveaways are announced on the Steam group and the Facebook Page. The posts are removed when the giveaway ends or is cancelled.</p>'
            : `<p class="admin-note">${posts_off.join(' and ')} announcement${posts_off.length > 1 ? 's are' : ' is'} off. To announce new giveaways there, add the settings to <code>.env</code> and restart (see <code>docs/SETUP.md</code>).</p>`

        box.innerHTML = posts_note + (active ? `<div class="admin-giveaway active" data-id="${esc(active._id)}">
                <img src="${esc(active.item.image)}" alt="">
                <div>
                    <strong>${esc(active.item.bp_sku)}</strong>
                    <div>Ends ${when(active.end)} &middot; ${active.entry_count} entries</div>
                    <div class="muted">Requirements: ${[active.requirements?.steam_group && 'Steam group', active.requirements?.trade && '1 trade'].filter(Boolean).join(', ') || 'none'}</div>
                    <div class="muted" data-posts="${esc(active._id)}">${post_states(active, res.posts)}</div>
                    <div class="actions"><button class="end-giveaway primary">End now &amp; draw winner</button> <button class="cancel-giveaway">Cancel giveaway</button></div>
                </div>
            </div>` : `<form class="admin-form" id="giveaway-form">
                <h3>Start a giveaway</h3>
                <label>Item (exact name from the item database)
                    <input name="bp_sku" list="giveaway-items" autocomplete="off" required placeholder="e.g. Team Captain">
                    <datalist id="giveaway-items"></datalist>
                </label>
                <label>Ends <input type="datetime-local" name="end" required value="${default_end}"></label>
                <label>Description (optional) <input name="description" maxlength="500"></label>
                <label>Description written in
                    <select name="lang">${LANG_OPTIONS.map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join('')}</select>
                </label>
                <label class="check"><input type="checkbox" name="steam_group" checked> Must be in our Steam group</label>
                <label class="check"><input type="checkbox" name="trade" checked> Must make 1 trade during the giveaway</label>
                <div class="actions"><button type="submit" class="primary">Start giveaway</button></div>
                <p class="muted">The winner is drawn automatically when it ends. You send the prize yourself, then tick "Prize sent" below.</p>
            </form>`) + `
            <h3>Previous giveaways</h3>
            ${past.length == 0 ? '<p class="admin-empty">None yet.</p>' : `<table>
                <tr><th>Item</th><th>Ended</th><th>Entries</th><th>Winner</th><th>Prize sent</th><th>Announcements</th></tr>
                ${past.map((g) => `<tr data-id="${esc(g._id)}">
                    <td>${esc(g.item.bp_sku)}</td>
                    <td>${g.status == 'cancelled' ? 'Cancelled' : when(g.end)}</td>
                    <td>${g.entry_count}</td>
                    <td>${g.winner?.steamid ? `<a href="https://steamcommunity.com/profiles/${esc(g.winner.steamid)}" target="_blank" rel="nofollow">${esc(g.winner.name || g.winner.steamid)}</a>
                        ${g.winner_tradelink ? `<br><a href="${esc(g.winner_tradelink)}" target="_blank" rel="nofollow">Send trade offer</a>` : '<br><span class="muted">no trade link</span>'}` : '-'}</td>
                    <td>${g.winner?.steamid ? `<input type="checkbox" class="prize-sent" ${g.prize_sent ? 'checked' : ''}>` : ''}</td>
                    <td data-posts="${esc(g._id)}">${post_states(g, res.posts) || '-'}</td>
                </tr>`).join('')}
            </table>`}`

        // posting and removing run in the background: keep those lines up to date until they're done
        const watch_posts = async (list, round = 0) => {
            if(!posts_busy(list) || round >= 40){ return }
            await new Promise((resolve) => setTimeout(resolve, 3000))
            if(!box.isConnected){ return }
            const r = await api('/api/admin/giveaways')
            if(r.status != 'ok'){ return }
            for (const g of r.giveaways) {
                const el = box.querySelector(`[data-posts="${g._id}"]`)
                if(el){ el.innerHTML = post_states(g, r.posts) || (el.tagName == 'TD' ? '-' : '') }
            }
            watch_posts(r.giveaways, round + 1)
        }
        watch_posts(res.giveaways)

        const form = box.querySelector('#giveaway-form')
        if(form){
            let search_timer
            form.bp_sku.addEventListener('input', () => {
                clearTimeout(search_timer)
                search_timer = setTimeout(async () => {
                    const r = await api(`/api/admin/items/search?q=${encodeURIComponent(form.bp_sku.value)}`)
                    box.querySelector('#giveaway-items').innerHTML = (r.items || []).map((i) => `<option value="${esc(i.bp_sku)}">`).join('')
                }, 250)
            })
            form.addEventListener('submit', async (e) => {
                e.preventDefault()
                const r = await api('/api/admin/giveaways', {
                    bp_sku: form.bp_sku.value,
                    end: new Date(form.end.value).getTime(),
                    description: form.description.value,
                    lang: form.lang.value,
                    steam_group: form.steam_group.checked,
                    trade: form.trade.checked
                })
                if(toast(r, 'Giveaway started.')){ giveaways(root) }
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
            if(e.target.classList.contains('cancel-giveaway') && confirm('Cancel the giveaway without a winner?')){
                const r = await api(`/api/admin/giveaways/${id}/cancel`, {})
                if(toast(r, 'Giveaway cancelled.')){ giveaways(root) }
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
        root.innerHTML = head('Overview', 'What is happening on the site right now. Refreshes every 15 seconds.', '<button id="ov-refresh">Refresh</button>') + '<div id="ov-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>'

        const draw = async () => {
            const res = await api('/api/admin/overview')
            const box = root.querySelector('#ov-body')
            if(!box){ return }
            if(res.status != 'ok'){ box.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            const o = res.overview
            const trading = live.settings ? live.settings.trading_state === 1 : o.trading

            box.innerHTML = `<div class="admin-stats">
                    ${stat('Users online', num(o.users_online), `${num(o.users_trading)} trading now`)}
                    ${stat('Trades, last 24 h', num(o.trades_day), o.trades_reported ? `${num(o.trades_reported)} reported by bots` : '')}
                    ${stat('Items in stock', num(o.items), `${num(o.bots)} bot${o.bots == 1 ? '' : 's'}`)}
                    ${stat('Registered users', num(o.users_total), o.users_new != null ? `+${num(o.users_new)} in 24 h` : '', '#users')}
                    ${stat('Open tickets', num(o.tickets_open), o.tickets_open ? 'waiting for a reply' : 'all answered', '#tickets')}
                    ${stat('Key price', o.key_price ? `${num(o.key_price)}<small> ref</small>` : '–', 'Mann Co. key')}
                    ${stat('Trade rating', o.rating?.avg != null ? `${o.rating.avg.toFixed(1)} ★` : '–', o.rating?.count ? `${num(o.rating.count)} rating${o.rating.count == 1 ? '' : 's'}` : 'no ratings yet', '#ratings')}
                </div>
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>Services</h3>
                        <ul class="admin-rows">
                            <li><span>Trading</span>
                                <span class="row-end">${pill(trading, 'On', 'Paused')}
                                <label class="admin-switch" title="${trading ? 'Pause trading' : 'Turn trading on'}"><input type="checkbox" id="ov-trading" ${trading ? 'checked' : ''}><span></span></label></span></li>
                            <li><span>Database</span>${pill(o.db, 'Connected', 'Disconnected')}</li>
                            <li><span>Bot server</span>${pill(o.bot_server == 'online')}</li>
                            <li><span>Item server</span>${pill(o.item_server == 'online')}</li>
                            <li><span>Apps on the settings socket</span><strong>${num(live.clients.length || o.settings_clients)}</strong></li>
                            <li><span>Website uptime</span><strong>${uptime(o.uptime)}</strong></li>
                        </ul>
                    </div>
                    <div class="admin-card">
                        <h3>Giveaway</h3>
                        ${o.giveaway ? `<div class="admin-giveaway-mini">
                                <img src="${esc(o.giveaway.image)}" alt="">
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

        root.querySelector('#ov-refresh').addEventListener('click', draw)
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
            <div class="admin-settings">
                <div class="admin-card" data-card="trading">
                    <div class="admin-card-head">
                        <div><h3>Trading</h3><p class="muted">Pause to stop new trade offers. Visitors see a notice; offers already sent are not touched.</p></div>
                        <label class="admin-switch big"><input type="checkbox" id="set-trading"><span></span></label>
                    </div>
                    <div class="admin-state" id="set-trading-state"></div>
                </div>

                <div class="admin-card" data-card="announcement">
                    <div class="admin-card-head">
                        <div><h3>Announcement banner</h3><p class="muted">A short line under the menu on every page.</p></div>
                        <label class="admin-switch"><input type="checkbox" id="set-ann-enabled"><span></span></label>
                    </div>
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

                <div class="admin-card" data-card="limits">
                    <h3>Item price limits</h3>
                    <p class="muted">In keys. Sent to the bot and item servers as <code>min_item_key</code> and <code>max_item_key</code>.</p>
                    <div class="admin-row-fields">
                        <label class="admin-field">Minimum <span class="admin-input-unit"><input type="number" id="set-min" min="0" step="0.01"><em>keys</em></span></label>
                        <label class="admin-field">Maximum <span class="admin-input-unit"><input type="number" id="set-max" min="0" step="0.01"><em>keys</em></span></label>
                    </div>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save limits</button></div>
                </div>

                <div class="admin-card" data-card="reviews">
                    <div class="admin-card-head">
                        <div><h3>Ratings after trades</h3><p class="muted">After an accepted trade, users can rate the site with 1 to 5 stars. 4 or 5 stars also get a button to your Trustpilot page. See them under <a href="#ratings">Ratings</a>.</p></div>
                        <label class="admin-switch"><input type="checkbox" id="set-rev-enabled"><span></span></label>
                    </div>
                    <label class="admin-field">Trustpilot review link
                        <input type="url" id="set-rev-url" placeholder="https://www.trustpilot.com/review/tf2deal.com">
                    </label>
                    <p class="muted small">Leave it empty to only collect ratings on the site.</p>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save link</button></div>
                </div>

                <div class="admin-card" data-card="season">
                    <h3>Seasonal theme</h3>
                    <p class="muted">During TF2 events the site changes its home picture, background, colours and the falling particles. On Auto the dates come from the TF2 update notes on teamfortress.com, with the usual dates as a fallback. This is what visitors see on Automatic; anyone can pick another theme for themselves in the menu.</p>
                    <div class="admin-segment wrap" id="set-season" role="radiogroup" aria-label="Seasonal theme">
                        ${SEASON_CHOICES.map(([v, t]) => `<button type="button" role="radio" data-season="${v}">${t}</button>`).join('')}
                    </div>
                    <p class="muted small" id="set-season-state"></p>
                </div>

                <div class="admin-card" data-card="clients">
                    <h3>Connected apps</h3>
                    <ul class="admin-clients" id="set-clients"></ul>
                </div>

                <div class="admin-card wide" data-card="blacklist">
                    <div class="admin-card-head">
                        <div><h3>Item blacklist <span class="admin-count" id="set-bl-count"></span></h3>
                        <p class="muted">Trades with these items are refused by the website. The list is also sent to the bot server.</p></div>
                    </div>
                    <form class="admin-inline-form" id="set-bl-form">
                        <input id="set-bl-input" list="set-bl-items" autocomplete="off" placeholder="Item name, e.g. Team Captain (paste several, one per line)">
                        <datalist id="set-bl-items"></datalist>
                        <button type="submit" class="primary">Add</button>
                    </form>
                    <input type="search" class="admin-filter" id="set-bl-filter" placeholder="Filter the list…" hidden>
                    <div class="admin-chips" id="set-bl-list"></div>
                </div>

                <div class="admin-card wide" data-card="extra">
                    <h3>App values</h3>
                    <p class="muted">Your own settings for other apps, as a JSON object. Apps read them from <code>settings.extra</code> and can change them too.</p>
                    <textarea id="set-extra" class="admin-code" rows="6" spellcheck="false"></textarea>
                    <p class="admin-error" id="set-extra-error" hidden></p>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save values</button></div>
                </div>

                <div class="admin-card wide" data-card="activity">
                    <h3>Recent changes</h3>
                    <ul class="admin-activity" id="set-activity"></ul>
                </div>

                <details class="admin-card wide admin-howto">
                    <summary>Connect another app to these settings</summary>
                    <p class="muted">Use the same <code>SERVER_TOKEN</code> and <code>SERVER_SECRET</code> as the bot and item servers. Full guide: <code>SETTINGS.md</code> in the project.</p>
<pre class="admin-code"><code>import { io } from "socket.io-client";

const live = io("${esc(location.origin)}/settings", {
  auth: { server_token: process.env.SERVER_TOKEN, server_secret: process.env.SERVER_SECRET, app: "bot server" }
});

live.on("settings:init", ({ settings }) =&gt; apply(settings));
live.on("settings:changed", ({ settings, changed, by }) =&gt; apply(settings));

// change something (only the fields you send are changed)
live.emit("settings:update", { trading_state: 0 }, (res) =&gt; console.log(res.status, res.message));</code></pre>
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
            $('#set-trading-state').innerHTML = on ? `${pill(true, 'Trading is on')}` : `${pill(false, 'On', 'Trading is paused')} <span class="muted">Visitors can't create new trades.</span>`
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
            $('#set-meta').innerHTML = `Version ${num(s.version)} · last change ${ago(s.updated)}${s.updated_by ? ` by ${by_label(parse_by(s.updated_by))}` : ''}`
        }
        const fill_clients = () => {
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

    /* ========================= STOCK LIMITS ========================= */
    // Global limits are the item server's settings (it sets every item's limit when it prices it); limits for single
    // items are written onto the items and kept by the item server. Server side: src/service/stock_limits.js.

    const QUALITY_NAMES = { 0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made', 11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated' }
    const GLOBAL_LIMITS = [
        ['stock_limit_default', 'Most items', 'Every item no rule below covers.'],
        ['stock_limit_unusual', 'Unusuals', 'Unusual cosmetics, taunts and weapons.'],
        ['stock_limit_unusual_min_pure', 'Unusuals only from', 'Pure the bots need first (the value they report). Below it the Unusual limit is 0.', 'pure'],
        ['stock_limit_collectors', "Collector's", "Collector's cosmetics, taunts and weapons."],
        ['stock_limit_collectors_min_pure', "Collector's only from", "Pure the bots need first. Below it the Collector's limit is 0.", 'pure'],
        ['ks_stock_limit', 'Each killstreak tier', 'Per tier of every weapon (Killstreak, Specialized, Professional), skins included.'],
        ['stock_limit_popular', 'Popular items', 'Most of a popular item (steady demand, good margin): weapons, cosmetics, taunts. Only cheap popular crates, tools and action items go higher.'],
        ['stock_over_keys_limit', 'Items over 1 key', 'Most of any item bought for more than 1 key, whatever else applies.'],
        ['stock_limit_ceiling', 'Any item', 'Most of any item, whatever else applies. Limits for single items below can still go higher.']
    ]
    const MAX_LIMIT = 1000

    const stock_section = async (root) => {
        root.innerHTML = head('Stock limits', 'How many of an item the bots hold at most. Users can\'t sell an item to the bots once its stock reaches the limit.') + `
            <div class="admin-settings">
                <div class="admin-card wide" data-card="stock-global">
                    <h3>Global limits</h3>
                    <p class="muted">For every item without a limit of its own. They are settings of the item server, which uses them each time it prices an item. Saving applies them to all items right away.</p>
                    <div id="stk-global"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save disabled>Save and apply</button></div>
                </div>

                <div class="admin-card wide">
                    <h3>Limits for single items</h3>
                    <p class="muted">Find items, then set one limit for all of them or change a single row. A limit set here stays when the item is priced again, until you set it back to automatic.</p>
                    <form class="admin-stock-filters" id="stk-filters">
                        <label class="admin-field">Name contains <input type="search" name="q" maxlength="100" placeholder="e.g. Kit, Team Captain" autocomplete="off"></label>
                        <label class="admin-field">Type <select name="type"><option value="">Any type</option></select></label>
                        <label class="admin-field">Quality <select name="quality"><option value="">Any quality</option></select></label>
                        <label class="admin-field">Craftable <select name="craftable"><option value="">Any</option><option value="yes">Craftable</option><option value="no">Non-Craftable</option></select></label>
                        <label class="admin-field">Limit <select name="manual"><option value="">Any</option><option value="yes">Set by hand</option><option value="no">Automatic</option></select></label>
                        <div class="admin-stock-actions">
                            <div class="admin-stock-checks">
                                <label class="check"><input type="checkbox" name="in_stock"> Only items in stock</label>
                                <label class="check"><input type="checkbox" name="killstreak"> Only weapons with killstreak tiers</label>
                            </div>
                            <button type="submit" class="primary">Find items</button>
                        </div>
                    </form>
                    <div id="stk-results"><p class="admin-empty">Pick filters and press Find items. With no filters you get every item.</p></div>
                </div>
            </div>`

        const $ = (sel) => root.querySelector(sel)
        const global_card = $('[data-card="stock-global"]')
        let global = null // { limits: [{key, value, min, max, desc}], missing }

        /* ---- global limits ---- */
        const draw_global = () => {
            const box = $('#stk-global')
            const save = global_card.querySelector('[data-save]')
            global_card.classList.remove('is-dirty')
            if(global?.status != 'ok'){
                box.innerHTML = `<p class="admin-error">${esc(global?.message || 'Could not load them.')}</p>
                    <p class="muted small">${global?.offline ? 'Global limits live on the item server. Limits for single items below still work.' : ''}</p>`
                save.disabled = true
                return
            }
            const known = Object.fromEntries(global.limits.map((l) => [l.key, l]))
            box.innerHTML = `<div class="admin-stock-global">${GLOBAL_LIMITS.filter(([key]) => known[key]).map(([key, label, help, unit]) => {
                const l = known[key]
                return `<label class="admin-field" title="${esc(l.desc || '')}">${esc(label)}
                    <span class="admin-input-unit"><input type="number" data-key="${key}" value="${esc(l.value)}" min="${esc(l.min ?? 0)}" max="${esc(l.max ?? '')}" step="1" required><em>${unit || 'max'}</em></span>
                    <span class="admin-help">${esc(help)} Default ${esc(l.default)}.</span></label>`
            }).join('')}</div>
            ${global.missing.length ? `<p class="admin-note">This item server doesn't know ${global.limits.length ? 'some of these limits' : 'these limits'} yet. Update item_manager to set ${global.limits.length ? 'the others' : 'them'} here.</p>` : ''}`
            save.disabled = global.limits.length == 0
        }
        const load_global = async () => {
            global = await api('/api/admin/stock/global')
            draw_global()
        }
        global_card.addEventListener('input', () => global_card.classList.add('is-dirty'))
        global_card.querySelector('[data-discard]').addEventListener('click', draw_global)
        global_card.querySelector('[data-save]').addEventListener('click', async (e) => {
            const patch = {}
            for (const input of global_card.querySelectorAll('input[data-key]')) {
                if(!input.reportValidity()){ return }
                patch[input.dataset.key] = Number(input.value)
            }
            const btn = e.currentTarget
            btn.disabled = true
            btn.textContent = 'Applying to every item…'
            const res = await api('/api/admin/stock/global', { patch })
            btn.textContent = 'Save and apply'
            btn.disabled = false
            if(!toast(res, res.applied ? `Saved. ${num(res.applied.changed)} of ${num(res.applied.checked)} items got a new limit.` : 'Saved. Each item gets the new limits the next time it is priced.')){ return }
            await load_global()
        })

        /* ---- items ---- */
        const form = $('#stk-filters')
        const results = $('#stk-results')
        let filters = {}
        let page = 0
        let target = 'item'

        const read_filters = () => ({
            q: form.q.value.trim(), type: form.type.value, quality: form.quality.value, craftable: form.craftable.value,
            manual: form.manual.value, in_stock: form.in_stock.checked, killstreak: form.killstreak.checked
        })
        const filter_words = () => {
            const words = []
            if(filters.q){ words.push(`name has "${filters.q}"`) }
            if(filters.type){ words.push(filters.type.startsWith('group:') ? `every ${filters.type.slice(6)} type` : `type ${filters.type}`) }
            if(filters.quality){ words.push(QUALITY_NAMES[filters.quality] || `quality ${filters.quality}`) }
            if(filters.craftable){ words.push(filters.craftable == 'no' ? 'Non-Craftable' : 'Craftable') }
            if(filters.manual){ words.push(filters.manual == 'yes' ? 'limit set by hand' : 'automatic limit') }
            if(filters.in_stock){ words.push('in stock') }
            if(filters.killstreak){ words.push('with killstreak tiers') }
            return words.length ? words.join(', ') : 'all items' // plain text: esc() it for HTML
        }
        const limit_value = (input) => {
            const n = Number(input.value)
            if(input.value.trim() === '' || !Number.isInteger(n) || n < 0 || n > MAX_LIMIT){
                iziToast.warning({ title: 'Check the limit', message: `A whole number from 0 to ${MAX_LIMIT}.` })
                input.focus()
                return null
            }
            return n
        }
        const tiers_cell = (it) => {
            if(!it.tiers){ return '<span class="muted">–</span>' }
            const current = it.tier_limits.length == 1 ? it.tier_limits[0] : (it.tier_limits.length ? 'mixed' : '–')
            return `<span class="admin-stock-cell"><input type="number" class="stk-row-ks" min="0" max="${MAX_LIMIT}" step="1" value="${it.manual_ks ?? (typeof current == 'number' ? current : '')}" aria-label="Limit per killstreak tier">
                <button type="button" data-row="killstreak">Set</button>${it.manual_ks != null ? '<button type="button" data-row-auto="killstreak" title="Back to the global limit">Auto</button>' : ''}</span>
                <span class="muted small">${it.tiers} tier${it.tiers == 1 ? '' : 's'}${current == 'mixed' ? ', mixed limits' : ''}${it.manual_ks != null ? ' · <span class="admin-tag">by hand</span>' : ''}</span>`
        }

        const draw_items = async () => {
            results.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span> Loading…</div>'
            const res = await api('/api/admin/stock/items', { filters, page })
            if(res.status != 'ok'){ results.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            if(res.total == 0){ results.innerHTML = `<p class="admin-empty">No items match (${esc(filter_words())}).</p>`; return }
            const from = res.page * res.per_page
            const any_ks = res.items.some((it) => it.tiers > 0) || filters.killstreak

            results.innerHTML = `<div class="admin-stock-bulk">
                    <p><strong>${num(res.total)} item${res.total == 1 ? '' : 's'}</strong> <span class="muted">(${esc(filter_words())})</span></p>
                    <div class="admin-stock-bulk-row">
                        <span>Set</span>
                        <div class="admin-segment" role="radiogroup" aria-label="What to set">
                            <button type="button" role="radio" data-target="item">the items</button>
                            <button type="button" role="radio" data-target="killstreak">their killstreak tiers</button>
                        </div>
                        <span>to</span>
                        <span class="admin-input-unit admin-stock-limit"><input type="number" id="stk-bulk-limit" min="0" max="${MAX_LIMIT}" step="1" placeholder="1"><em>max</em></span>
                        <button type="button" class="primary" id="stk-bulk-set">Set for all ${num(res.total)}</button>
                        <button type="button" id="stk-bulk-auto" title="Remove limits set by hand; the global limits apply again">Back to automatic</button>
                    </div>
                    <p class="muted small" id="stk-target-note"></p>
                </div>
                <div class="admin-table-wrap"><table class="admin-table admin-stock-table">
                    <thead><tr><th>Item</th><th>Type</th><th>In stock</th><th>Limit</th>${any_ks ? '<th>Each killstreak tier</th>' : ''}</tr></thead>
                    <tbody>${res.items.map((it) => `<tr data-sku="${esc(it.bp_sku)}">
                        <td><span class="admin-stock-item"><img class="q-${esc(it.qualityID)}" src="${esc(it.image)}" alt="" loading="lazy">
                            <span><a href="/items/${encodeURIComponent(it.bp_sku)}" target="_blank" translate="no">${esc(it.bp_sku)}</a>
                            <span class="muted small">${esc(QUALITY_NAMES[it.qualityID] || '')}</span></span></span></td>
                        <td>${esc(it.type)}</td>
                        <td>${num(it.cur)}</td>
                        <td><span class="admin-stock-cell"><input type="number" class="stk-row-limit" min="0" max="${MAX_LIMIT}" step="1" value="${it.limit ?? ''}" aria-label="Limit">
                            <button type="button" data-row="item">Set</button>${it.manual != null ? '<button type="button" data-row-auto="item" title="Back to the global limit">Auto</button>' : ''}</span>
                            ${it.manual != null ? '<span class="admin-tag">by hand</span>' : ''}</td>
                        ${any_ks ? `<td>${tiers_cell(it)}</td>` : ''}
                    </tr>`).join('')}</tbody>
                </table></div>
                ${res.total > res.per_page ? `<div class="admin-pager">
                    <button type="button" data-page="${res.page - 1}" ${res.page == 0 ? 'disabled' : ''}>Previous</button>
                    <span class="muted">${num(from + 1)}–${num(Math.min(from + res.per_page, res.total))} of ${num(res.total)}</span>
                    <button type="button" data-page="${res.page + 1}" ${from + res.per_page >= res.total ? 'disabled' : ''}>Next</button>
                </div>` : ''}`

            const set_target = (value) => {
                target = value
                results.querySelectorAll('[data-target]').forEach((b) => b.setAttribute('aria-checked', b.dataset.target == target))
                $('#stk-target-note').textContent = target == 'item'
                    ? 'The limit of each item. Killstreak copies of a weapon have their own tier limits.'
                    : 'The limit of each killstreak tier (Killstreak, Specialized, Professional). Only weapons with killstreak tiers change.'
            }
            set_target(target)
            results.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => set_target(b.dataset.target)))

            const what = () => target == 'item' ? 'the limit' : 'the killstreak tier limit'
            $('#stk-bulk-set').addEventListener('click', async () => {
                const limit = limit_value($('#stk-bulk-limit'))
                if(limit === null){ return }
                if(!confirm(`Set ${what()} to ${limit} for ${num(res.total)} item${res.total == 1 ? '' : 's'} (${filter_words()})?`)){ return }
                const r = await api('/api/admin/stock/apply', { filters, target, limit })
                if(toast(r, `${what()[0].toUpperCase()}${what().slice(1)} is now ${limit} for ${num(r.matched)} item${r.matched == 1 ? '' : 's'}.`)){ draw_items() }
            })
            $('#stk-bulk-auto').addEventListener('click', async () => {
                if(!confirm(`Remove ${what()} set by hand from ${num(res.total)} item${res.total == 1 ? '' : 's'}? The global limits apply to them again.`)){ return }
                const r = await api('/api/admin/stock/apply', { filters, target, limit: null })
                if(toast(r, r.applied ? 'Back to automatic. The global limits are applied.' : 'Back to automatic. Each item gets its global limit the next time it is priced.')){ draw_items() }
            })
        }

        results.addEventListener('click', async (e) => {
            const pager = e.target.closest('[data-page]')
            if(pager){ page = Number(pager.dataset.page); draw_items(); return }
            const row = e.target.closest('tr[data-sku]')
            const set = e.target.closest('[data-row]')
            const auto = e.target.closest('[data-row-auto]')
            if(!row || !(set || auto)){ return }
            const row_target = (set || auto).dataset.row || (set || auto).dataset.rowAuto
            const one = { bp_sku: row.dataset.sku }
            let limit = null
            if(set){
                limit = limit_value(row.querySelector(row_target == 'item' ? '.stk-row-limit' : '.stk-row-ks'))
                if(limit === null){ return }
            }
            const r = await api('/api/admin/stock/apply', { filters: one, target: row_target, limit })
            if(toast(r, set ? `${esc(row.dataset.sku)}: ${row_target == 'item' ? 'limit' : 'killstreak tier limit'} ${limit}.` : `${esc(row.dataset.sku)} is back to automatic.`)){ draw_items() }
        })
        form.addEventListener('submit', (e) => { e.preventDefault(); filters = read_filters(); page = 0; draw_items() })

        // filter choices from the items in the database
        api('/api/admin/stock/options').then((res) => {
            if(res.status != 'ok'){ return }
            form.type.insertAdjacentHTML('beforeend', `${res.groups.length ? `<optgroup label="Groups">${res.groups.map((g) => `<option value="group:${esc(g)}">Every ${esc(g)} type</option>`).join('')}</optgroup>` : ''}
                <optgroup label="Types">${res.types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</optgroup>`)
            form.quality.insertAdjacentHTML('beforeend', res.qualities.map((q) => `<option value="${esc(q)}">${esc(QUALITY_NAMES[q] || q)}</option>`).join(''))
        })
        await load_global()
    }

    /* ========================= LISTINGS ========================= */
    // What the bots list on backpack.tf. The rules are the live setting `listings` (the bot server reads it on the
    // /settings socket like every other setting); the list of listings comes from the bot server; listings made by
    // hand are kept by the site and sent to the bot server. Server side: src/service/listings.js, docs/LISTINGS.md.

    const QUALITY_ORDER = ['6', '11', '5', '1', '3', '13', '14', '15', '0', '9', '7', '8']
    const KS_LABELS = ['None', 'Killstreak', 'Specialized', 'Professional']
    const ref_text = (n) => { n = Number(n) || 0; return `${n > 0 && n < 0.11 ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100} ref` } // 0.055 stays 0.055
    const price_text = (p) => {
        const keys = Number(p?.keys) || 0, metal = Number(p?.metal) || 0
        return [keys ? `${num(keys)} key${keys == 1 ? '' : 's'}` : '', (metal || !keys) ? ref_text(metal) : ''].filter(Boolean).join(' ')
    }
    const group_of = (type) => String(type).trim().toLowerCase().split(' ')[0]
    const LS_STATUS = { listed: ['ok', 'Listed'], pending: ['wait', 'Waiting for the bot'], failed: ['bad', 'Failed'] }

    const listings_section = async (root) => {
        if(!live.settings){
            const r = await api('/api/admin/settings')
            if(r.status != 'ok'){ root.innerHTML = head('Listings') + `<p class="admin-error">${esc(r.message)}</p>`; return }
            live.settings = r.settings
        }

        root.innerHTML = head('Listings', 'What the bots list on backpack.tf. Every change goes to the bot server right away.') + `
            <div class="admin-settings">
                <div class="admin-card wide" data-card="listing-rules">
                    <div class="admin-card-head">
                        <div><h3>List only these types and qualities</h3>
                        <p class="muted">Tick the types and qualities the bots may list. Off: they list every item they price. Listings you make by hand below are always listed.</p></div>
                        <label class="admin-switch"><input type="checkbox" id="lr-enabled" aria-label="List only the ticked types and qualities"><span></span></label>
                    </div>
                    <div class="admin-lr-sides" id="lr-sides">
                        <span>The rules limit</span>
                        <label class="check"><input type="checkbox" id="lr-buy"> buy listings</label>
                        <label class="check"><input type="checkbox" id="lr-sell"> sell listings</label>
                    </div>
                    <div id="lr-grid"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>
                    <p class="admin-lr-summary" id="lr-summary"></p>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save>Save rules</button></div>
                </div>

                <div class="admin-card" data-card="listing-new">
                    <h3>New listing</h3>
                    <p class="muted">For one bot, buy or sell. It stays listed until you take it down, whatever the rules say.</p>
                    <form id="ln-form" autocomplete="off">
                        <div class="admin-row-fields">
                            <label class="admin-field">Bot <select name="bot"></select></label>
                            <div class="admin-field">Side
                                <div class="admin-segment" id="ln-intent" role="radiogroup" aria-label="Buy or sell">
                                    <button type="button" role="radio" data-intent="buy">Buy</button>
                                    <button type="button" role="radio" data-intent="sell">Sell</button>
                                </div>
                            </div>
                        </div>
                        <label class="admin-field">Item <input type="search" name="bp_sku" list="ln-items" maxlength="300" placeholder="Type a name, e.g. Team Captain" required></label>
                        <datalist id="ln-items"></datalist>
                        <div class="admin-ln-item" id="ln-item" hidden></div>
                        <label class="admin-field" data-for="buy" hidden>Killstreak <select name="ks"></select></label>
                        <label class="admin-field" data-for="sell" hidden>Copy to sell <select name="assetid"></select></label>
                        <div class="admin-row-fields">
                            <label class="admin-field">Keys <span class="admin-input-unit"><input type="number" name="keys" min="0" max="10000" step="1" value="0"><em>keys</em></span></label>
                            <label class="admin-field">Refined <span class="admin-input-unit"><input type="number" name="metal" min="0" step="0.01" value="0"><em>ref</em></span></label>
                        </div>
                        <label class="admin-field">Listing text <input name="details" maxlength="200" placeholder="Empty: the bot's usual text"></label>
                        <div class="admin-card-foot"><button type="submit" class="primary">Create listing</button></div>
                    </form>
                </div>

                <div class="admin-card" data-card="listing-never">
                    <div class="admin-card-head">
                        <div><h3>Never list <span class="admin-count" id="lx-count"></span></h3>
                        <p class="muted">The bots don't list these items at all, whatever the rules say. They can still be traded on the site. Items worth less than one scrap (like 0.055 ref weapons) are never listed either.</p></div>
                    </div>
                    <form class="admin-inline-form" id="lx-form">
                        <input id="lx-input" list="lx-items" autocomplete="off" placeholder="Item name, e.g. Team Captain">
                        <datalist id="lx-items"></datalist>
                        <button type="submit" class="primary">Add</button>
                    </form>
                    <div class="admin-chips" id="lx-list"></div>
                </div>

                <div class="admin-card wide" data-card="listing-list">
                    <div class="admin-card-head">
                        <div><h3>All listings</h3><p class="muted" id="ll-report"></p></div>
                        <button type="button" id="ll-refresh">Refresh</button>
                    </div>
                    <form class="admin-ll-filters" id="ll-filters">
                        <div class="admin-segment" id="ll-side" role="radiogroup" aria-label="Buy or sell">
                            <button type="button" role="radio" data-side="">All <span></span></button>
                            <button type="button" role="radio" data-side="buy">Buy <span></span></button>
                            <button type="button" role="radio" data-side="sell">Sell <span></span></button>
                        </div>
                        <select name="bot" aria-label="Bot"><option value="">Every bot</option></select>
                        <select name="source" aria-label="Made by"><option value="">Made by the bots or by hand</option><option value="auto">Made by the bots</option><option value="manual">Made by hand</option></select>
                        <input type="search" name="q" maxlength="100" placeholder="Item name" aria-label="Item name">
                    </form>
                    <div id="ll-body"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>
                </div>
            </div>`

        const $ = (sel) => root.querySelector(sel)
        const card = (name) => root.querySelector(`[data-card="${name}"]`)
        const rules_card = card('listing-rules')
        let alive = true

        /* ---- rules grid ---- */
        let cells = null         // [{ type, quality, items }] priced items per type and quality
        let groups = []          // [{ key, types: [type], counts: { quality: items } }]
        let qualities = []
        let picked = new Set()   // "quality|type" of the ticked cells (type is "group:<word>" or an exact type)
        let other_rules = []     // rules the grid can't show (any quality, any type, a type no item has): kept as they are
        const open_groups = new Set()

        const build_grid = () => {
            const by_group = new Map()
            for (const c of cells) {
                const key = group_of(c.type)
                if(!by_group.has(key)){ by_group.set(key, { key, types: new Map(), counts: {} }) }
                const g = by_group.get(key)
                if(!g.types.has(c.type)){ g.types.set(c.type, {}) }
                g.types.get(c.type)[c.quality] = (g.types.get(c.type)[c.quality] || 0) + c.items
                g.counts[c.quality] = (g.counts[c.quality] || 0) + c.items
            }
            groups = [...by_group.values()].map((g) => ({ ...g, types: [...g.types.entries()].sort((a, b) => a[0].localeCompare(b[0])) }))
                .sort((a, b) => a.key.localeCompare(b.key))
            const qs = [...new Set(cells.map((c) => c.quality))]
            qualities = [...QUALITY_ORDER.filter((q) => qs.includes(q)), ...qs.filter((q) => !QUALITY_ORDER.includes(q)).sort((a, b) => a - b)]
        }

        // the saved rules -> ticked cells (+ the rules the grid can't show)
        const read_rules = () => {
            const l = live.settings.listings || { enabled: false, rules: [], buy: true, sell: true, exclude: [] }
            picked = new Set()
            other_rules = []
            for (const r of l.rules) {
                const type = String(r.type || '').toLowerCase()
                const g = type.startsWith('group:') ? groups.find((x) => x.key == type.slice(6)) : groups.find((x) => x.types.some(([t]) => t.toLowerCase() == type))
                if(!r.quality || !type || !g){ other_rules.push(r); continue }
                if(type.startsWith('group:') || (g.types.length == 1 && g.types[0][0].toLowerCase() == type)){ picked.add(`${r.quality}|group:${g.key}`) }
                else { picked.add(`${r.quality}|${g.types.find(([t]) => t.toLowerCase() == type)[0]}`) }
            }
            $('#lr-enabled').checked = l.enabled
            $('#lr-buy').checked = l.buy
            $('#lr-sell').checked = l.sell
        }
        const grid_rules = () => [...picked].map((key) => { const [quality, ...type] = key.split('|'); return { quality, type: type.join('|') } }).concat(other_rules)

        const cell = (q, type, count, inherited) => {
            if(!count){ return '<td class="lr-none" aria-hidden="true">·</td>' }
            const on = inherited || picked.has(`${q}|${type}`)
            return `<td><label class="lr-cell${on ? ' on' : ''}${inherited ? ' inherited' : ''}"><input type="checkbox" data-q="${esc(q)}" data-t="${esc(type)}" ${on ? 'checked' : ''} ${inherited ? 'disabled' : ''}
                aria-label="${esc(QUALITY_NAMES[q] || q)} ${esc(type.replace(/^group:/, ''))}"><span>${num(count)}</span></label></td>`
        }
        const draw_summary = () => {
            const enabled = $('#lr-enabled').checked
            const total = cells.reduce((s, c) => s + c.items, 0)
            const rules = grid_rules()
            const shown = cells.filter((c) => rules.some((r) => (!r.quality || r.quality == c.quality) && type_match(r.type, c.type))).reduce((s, c) => s + c.items, 0)
            const sides = [$('#lr-buy').checked && 'buy', $('#lr-sell').checked && 'sell'].filter(Boolean)
            $('#lr-summary').innerHTML = !enabled
                ? `<strong>Off.</strong> The bots list every item they price (${num(total)} now), except the items under Never list and those worth less than one scrap.`
                : rules.length == 0 ? '<span class="admin-error">Tick at least one cell, or turn the rules off.</span>'
                : `<strong>${num(shown)} of ${num(total)}</strong> priced items may be listed on the ${sides.length == 2 ? 'buy and sell' : sides[0] || '–'} side${sides.length == 1 ? '' : 's'}.${other_rules.length ? ` Plus ${other_rules.length} rule${other_rules.length == 1 ? '' : 's'} set by an app.` : ''}`
            rules_card.classList.toggle('is-off', !enabled)
        }
        const type_match = (rule_type, type) => {
            if(!rule_type){ return true }
            const t = type.toLowerCase(), r = rule_type.toLowerCase()
            return r.startsWith('group:') ? (t == r.slice(6) || t.startsWith(r.slice(6) + ' ')) : t == r
        }
        const draw_grid = () => {
            if(!cells){ return }
            if(cells.length == 0){ $('#lr-grid').innerHTML = '<p class="admin-empty">No priced items yet.</p>'; draw_summary(); return }
            $('#lr-grid').innerHTML = `<div class="admin-table-wrap"><table class="admin-lr-grid">
                <thead><tr><th scope="col">Type</th>${qualities.map((q) => `<th scope="col"><button type="button" data-col="${esc(q)}" title="Tick or clear the whole column">${esc(QUALITY_NAMES[q] || q)}</button></th>`).join('')}</tr></thead>
                <tbody>${groups.map((g) => {
                    const open = open_groups.has(g.key)
                    const many = g.types.length > 1
                    const head_row = `<tr class="lr-group"><th scope="row"><span class="lr-row-head">
                        ${many ? `<button type="button" class="lr-expand" data-expand="${esc(g.key)}" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} the ${g.types.length} types">${open ? '−' : '+'}</button>` : '<span class="lr-expand-pad"></span>'}
                        <button type="button" class="lr-row" data-row="${esc(g.key)}" title="Tick or clear the whole row">${esc(g.key)}</button>${many ? `<span class="muted small">${g.types.length} types</span>` : ''}</span></th>
                        ${qualities.map((q) => cell(q, `group:${g.key}`, g.counts[q] || 0, false)).join('')}</tr>`
                    const type_rows = (many && open) ? g.types.map(([t, counts]) => `<tr class="lr-type"><th scope="row"><span class="lr-row-head">${esc(t)}</span></th>
                        ${qualities.map((q) => cell(q, t, counts[q] || 0, picked.has(`${q}|group:${g.key}`))).join('')}</tr>`).join('') : ''
                    return head_row + type_rows
                }).join('')}</tbody></table></div>`
            draw_summary()
        }
        const set_dirty = (on = true) => { rules_card.classList.toggle('is-dirty', on); rules_card.classList.remove('is-stale') }
        const fill_rules = () => { read_rules(); draw_grid(); set_dirty(false) }

        // ticking a whole group clears its single types for that quality (the group covers them)
        const toggle = (q, type, on) => {
            const key = `${q}|${type}`
            on ? picked.add(key) : picked.delete(key)
            if(type.startsWith('group:') && on){
                for (const [t] of groups.find((g) => `group:${g.key}` == type)?.types || []) { picked.delete(`${q}|${t}`) }
            }
        }
        $('#lr-grid').addEventListener('change', (e) => {
            const box = e.target.closest('input[data-q]')
            if(!box){ return }
            toggle(box.dataset.q, box.dataset.t, box.checked)
            set_dirty(); draw_grid()
        })
        $('#lr-grid').addEventListener('click', (e) => {
            const expand = e.target.closest('[data-expand]')
            if(expand){ const k = expand.dataset.expand; open_groups.has(k) ? open_groups.delete(k) : open_groups.add(k); draw_grid(); return }
            const col = e.target.closest('[data-col]')?.dataset.col
            const row = e.target.closest('[data-row]')?.dataset.row
            if(col === undefined && row === undefined){ return }
            const targets = col !== undefined
                ? groups.filter((g) => g.counts[col]).map((g) => [col, `group:${g.key}`])
                : qualities.filter((q) => groups.find((g) => g.key == row)?.counts[q]).map((q) => [q, `group:${row}`])
            const all_on = targets.every(([q, t]) => picked.has(`${q}|${t}`))
            for (const [q, t] of targets) { toggle(q, t, !all_on) }
            set_dirty(); draw_grid()
        })
        $('#lr-enabled').addEventListener('change', () => { set_dirty(); draw_summary() })
        root.querySelectorAll('#lr-buy, #lr-sell').forEach((el) => el.addEventListener('change', () => { set_dirty(); draw_summary() }))
        rules_card.querySelector('[data-discard]').addEventListener('click', fill_rules)
        rules_card.querySelector('[data-save]').addEventListener('click', async () => {
            const enabled = $('#lr-enabled').checked
            const patch = { listings: { enabled, rules: grid_rules(), buy: $('#lr-buy').checked, sell: $('#lr-sell').checked } }
            if(toast(await save_settings(patch), enabled ? 'Rules saved. The bot server got them.' : 'Saved. The bots list every item again.')){ fill_rules() }
        })

        /* ---- never list ---- */
        const fill_never = () => {
            const list = live.settings.listings?.exclude || []
            $('#lx-count').textContent = list.length
            $('#lx-list').innerHTML = list.length == 0 ? '<p class="admin-empty">Nothing here.</p>'
                : list.map((n) => `<span class="admin-chip">${esc(n)}<button type="button" data-remove="${esc(n)}" aria-label="List ${esc(n)} again">×</button></span>`).join('')
        }
        const item_search = (input, datalist) => {
            let timer
            input.addEventListener('input', () => {
                clearTimeout(timer)
                if(input.value.length < 2){ return }
                timer = setTimeout(async () => {
                    const r = await api(`/api/admin/items/search?q=${encodeURIComponent(input.value)}`)
                    datalist.innerHTML = (r.items || []).map((i) => `<option value="${esc(i.bp_sku)}">`).join('')
                }, 250)
            })
        }
        item_search($('#lx-input'), $('#lx-items'))
        $('#lx-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const name = $('#lx-input').value.trim()
            if(!name){ return }
            if(toast(await save_settings({ listings: { exclude: { add: [name] } } }), `${esc(name)} won't be listed.`)){ $('#lx-input').value = ''; fill_never() }
        })
        $('#lx-list').addEventListener('click', async (e) => {
            const name = e.target.closest('[data-remove]')?.dataset.remove
            if(name && toast(await save_settings({ listings: { exclude: { remove: [name] } } }), `${esc(name)} may be listed again.`)){ fill_never() }
        })

        /* ---- new listing ---- */
        const form = $('#ln-form')
        let intent = 'buy'
        let item = null          // /listings/item answer for the picked item and bot
        let price_touched = false
        let bots = []

        const fill_bots = () => {
            const current = form.bot.value
            form.bot.innerHTML = bots.length == 0 ? '<option value="">No bot is running</option>'
                : bots.map((b) => `<option value="${esc(b.steamid)}">${esc(b.name || b.steamid)}</option>`).join('')
            if(bots.some((b) => b.steamid == current)){ form.bot.value = current }
            const filter = $('#ll-filters').bot
            const shown = filter.value
            filter.innerHTML = '<option value="">Every bot</option>' + bots.map((b) => `<option value="${esc(b.steamid)}">${esc(b.name || b.steamid)}</option>`).join('')
            filter.value = shown
        }
        // our own price: buy (or the killstreak tier's), sell = the higher of the item's and the copy's tier price
        const set_price = () => {
            if(price_touched || !item){ return }
            const ref = (p) => (Number(p?.keys) || 0) * (item.key_price || 0) + (Number(p?.metal) || 0)
            let p = item.buy
            if(intent == 'buy'){ p = item.tiers.find((t) => t.ks == Number(form.ks.value))?.buy || item.buy }
            else {
                const ks = item.copies.find((c) => c.assetid == form.assetid.value)?.ks || 0
                const tier = item.tiers.find((t) => t.ks == ks)?.sell
                p = (tier && ref(tier) > ref(item.sell)) ? tier : item.sell
            }
            form.keys.value = p.keys
            form.metal.value = p.metal
        }
        const draw_item = () => {
            const box = $('#ln-item')
            root.querySelectorAll('#ln-form [data-for]').forEach((el) => { el.hidden = !item || el.dataset.for != intent || (intent == 'buy' && item.tiers.length == 0) })
            root.querySelectorAll('#ln-intent button').forEach((b) => b.setAttribute('aria-checked', b.dataset.intent == intent))
            if(!item){ box.hidden = true; return }
            box.hidden = false
            const p_side = item[intent] || {}
            const under_scrap = !(p_side.keys > 0) && p_side.metal > 0 && p_side.metal < 0.11
            const rule_note = under_scrap ? `<p class="muted small">It's worth less than one scrap, so it is never listed on backpack.tf (0.055 ref items are traded on the site only). A listing needs a price of at least 0.11 ref.</p>`
                : item.may_list[intent] ? '' : `<p class="muted small">The rules don't list this item on the ${intent} side; a listing made here is listed anyway.</p>`
            const no_copy = intent == 'sell' && item.copies.length == 0 ? `<p class="admin-error small">${esc(form.bot.selectedOptions[0]?.textContent || 'This bot')} doesn't hold this item.</p>` : ''
            box.innerHTML = `<span class="admin-stock-item"><img class="q-${esc(item.qualityID)}" src="${esc(item.image)}" alt="" loading="lazy">
                <span><strong translate="no">${esc(item.bp_sku)}</strong><span class="muted small">Our prices: buy ${esc(price_text(item.buy))}, sell ${esc(price_text(item.sell))}${item.priced ? '' : ' (not priced now)'}</span></span></span>${rule_note}${no_copy}`
            form.ks.innerHTML = [0, ...item.tiers.map((t) => t.ks)].map((ks) => `<option value="${ks}">${KS_LABELS[ks]}</option>`).join('')
            form.assetid.innerHTML = item.copies.map((c) => `<option value="${esc(c.assetid)}">${esc(c.name)}${c.details.length ? ` (${esc(c.details.join(', '))})` : ''} · #${esc(c.assetid)}</option>`).join('')
            set_price()
        }
        let item_for = ''        // "bp_sku|bot" the form shows, so leaving the name field doesn't reset the tier and price
        const load_item = async () => {
            const name = form.bp_sku.value.trim()
            const wanted = `${name}|${form.bot.value}`
            if(!name){ item = null; item_for = ''; draw_item(); return }
            if(wanted == item_for){ return }
            item_for = wanted
            const r = await api(`/api/admin/listings/item?bp_sku=${encodeURIComponent(name)}&bot=${encodeURIComponent(form.bot.value)}`)
            if(!alive || item_for != wanted){ return }
            item = r.status == 'ok' ? r.item : null
            if(!item){ item_for = '' }
            price_touched = false
            draw_item()
        }
        item_search(form.bp_sku, $('#ln-items'))
        form.bp_sku.addEventListener('change', load_item)
        form.bot.addEventListener('change', load_item)
        form.ks.addEventListener('change', set_price)
        form.assetid.addEventListener('change', set_price)
        root.querySelectorAll('#ln-form input[name="keys"], #ln-form input[name="metal"]').forEach((el) => el.addEventListener('input', () => { price_touched = true }))
        $('#ln-intent').addEventListener('click', (e) => {
            const value = e.target.closest('[data-intent]')?.dataset.intent
            if(!value || value == intent){ return }
            intent = value
            price_touched = false
            draw_item()
        })
        form.addEventListener('submit', async (e) => {
            e.preventDefault()
            if(!item){ await load_item() }
            if(!item){ iziToast.warning({ title: 'Pick the item from the list', message: '' }); return }
            const button = form.querySelector('button[type="submit"]')
            button.disabled = true
            const r = await api('/api/admin/listings/create', {
                bot: form.bot.value, intent, bp_sku: item.bp_sku, ks: Number(form.ks.value) || 0, assetid: form.assetid.value,
                price: { keys: Number(form.keys.value) || 0, metal: Number(form.metal.value) || 0 }, details: form.details.value
            })
            button.disabled = false
            if(r.status == 'ok'){
                iziToast[r.result == 'listed' ? 'success' : 'info']({ title: r.result == 'listed' ? 'Listed' : 'Saved', message: esc(r.message) })
                form.bp_sku.value = ''; form.details.value = ''; item = null; item_for = ''; draw_item()
                draw_list()
            } else { toast(r) }
        })
        draw_item()

        /* ---- all listings ---- */
        const filters_form = $('#ll-filters')
        const view = { side: '', page: 0 }
        let rows = []
        let list_id = 0

        const report_line = (rep) => {
            const shown = rep.time ? `Showing what it sent ${ago(rep.time)}, and the listings made by hand.` : 'Showing the listings made by hand.'
            if(rep.offline){ return `${pill(false, '', 'Bot server offline')} ${shown}` }
            if(rep.error){ return `${pill(false, '', 'No listings from the bot server')} ${esc(rep.error)}${rep.time ? '' : ' It needs the update in <code>docs/LISTINGS.md</code>.'} ${shown}` }
            return rep.time ? `From the bot server, ${ago(rep.time)}.` : 'Asking the bot server…'
        }
        const status_cell = (r) => {
            if(r.source == 'auto'){ return '<span class="muted nowrap">Bots</span>' }
            const [kind, label] = LS_STATUS[r.status] || LS_STATUS.pending
            return `<span class="muted nowrap">By hand</span><span class="admin-ls-state ${kind}"${r.error ? ` title="${esc(r.error)}"` : ''}>${esc(label)}${r.error ? `: ${esc(r.error)}` : ''}</span>`
        }
        const draw_list = async (force = false) => {
            const id = ++list_id
            const body = $('#ll-body')
            const params = new URLSearchParams({ side: view.side, bot: filters_form.bot.value, source: filters_form.source.value, q: filters_form.q.value.trim(), page: view.page })
            if(force){ params.set('refresh', '1') }
            const res = await api(`/api/admin/listings?${params}`)
            if(!alive || id != list_id){ return }
            if(res.status != 'ok'){ body.innerHTML = `<p class="admin-error">${esc(res.message)}</p>`; return }
            bots = res.bots
            fill_bots()
            $('#ll-report').innerHTML = report_line(res.report)
            root.querySelectorAll('#ll-side button').forEach((b) => {
                b.setAttribute('aria-checked', b.dataset.side == view.side)
                b.querySelector('span').textContent = num(res.counts[b.dataset.side || 'all'])
            })
            rows = res.listings
            if(res.total == 0){ body.innerHTML = '<p class="admin-empty">No listings here.</p>'; return }
            const from = res.page * res.per_page
            body.innerHTML = `<div class="admin-table-wrap"><table class="admin-table admin-ll-table">
                    <thead><tr><th>Item</th><th>Side</th><th>Bot</th><th>Price</th><th class="nowrap">Made by</th><th>Listed</th><th></th></tr></thead>
                    <tbody>${rows.map((r, i) => `<tr data-i="${i}">
                        <td><span class="admin-stock-item"><img class="q-${esc(r.qualityID)}" src="${esc(r.image || '/img/new_user-96.webp')}" alt="" loading="lazy">
                            <span>${r.item ? `<a href="/items/${encodeURIComponent(r.item)}" target="_blank" translate="no">${esc(r.name)}</a>` : `<span translate="no">${esc(r.name)}</span>`}
                            <span class="muted small">${esc(QUALITY_NAMES[r.qualityID] || '')}${r.assetid ? ` · #${esc(r.assetid)}` : ''}${r.details ? ` · <span title="${esc(r.details)}">“${esc(r.details.length > 60 ? r.details.slice(0, 57) + '…' : r.details)}”</span>` : ''}</span></span></span></td>
                        <td><span class="admin-ls-side ${r.intent}">${r.intent == 'buy' ? 'Buy' : 'Sell'}</span></td>
                        <td class="nowrap">${esc(r.bot_name || r.bot)}</td>
                        <td class="nowrap">${esc(price_text(r.price))}</td>
                        <td><span class="admin-ls-source">${status_cell(r)}</span></td>
                        <td class="nowrap">${r.created ? ago(r.created) : '–'}</td>
                        <td><span class="admin-ll-actions"><button type="button" data-remove>Take down</button>${r.source == 'auto' ? '<button type="button" data-never title="Take it down and add the item to Never list">Never list</button>' : ''}</span></td>
                    </tr>`).join('')}</tbody>
                </table></div>
                ${res.total > res.per_page ? `<div class="admin-pager">
                    <button type="button" data-page="${res.page - 1}" ${res.page == 0 ? 'disabled' : ''}>Previous</button>
                    <span class="muted">${num(from + 1)}–${num(Math.min(from + res.per_page, res.total))} of ${num(res.total)}</span>
                    <button type="button" data-page="${res.page + 1}" ${from + res.per_page >= res.total ? 'disabled' : ''}>Next</button>
                </div>` : ''}`
        }

        $('#ll-body').addEventListener('click', async (e) => {
            const pager = e.target.closest('[data-page]')
            if(pager){ view.page = Number(pager.dataset.page); draw_list(); return }
            const r = rows[Number(e.target.closest('tr[data-i]')?.dataset.i)]
            const never = e.target.closest('[data-never]')
            if(!r || !(never || e.target.closest('[data-remove]'))){ return }
            const what = `the ${r.intent} listing for ${r.name}${r.bot_name ? ` on ${r.bot_name}` : ''}`
            if(!confirm(never ? `Take down ${what} and never list ${r.item || r.name} again?` : r.source == 'manual' ? `Take down ${what}? It is deleted.` : `Take down ${what}? The bot lists it again at its next refresh unless the rules or Never list stop it.`)){ return }
            const res = await api('/api/admin/listings/remove', r.source == 'manual' ? { manual_id: r.manual_id } : { id: r.id, bot: r.bot, bp_sku: r.item || r.name, never: !!never })
            if(toast(res, esc(res.message))){ draw_list() }
        })
        $('#ll-side').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-side]')
            if(btn){ view.side = btn.dataset.side; view.page = 0; draw_list() }
        })
        let q_timer
        filters_form.addEventListener('input', (e) => {
            clearTimeout(q_timer)
            q_timer = setTimeout(() => { view.page = 0; draw_list() }, e.target.name == 'q' ? 300 : 0)
        })
        filters_form.addEventListener('submit', (e) => e.preventDefault())
        $('#ll-refresh').addEventListener('click', () => draw_list(true))

        /* ---- start ---- */
        const on_live = (type, event) => {
            if(type != 'changed' && type != 'init'){ return }
            if(type == 'changed' && !event?.changed?.includes('listings')){ return }
            fill_never()
            if(!cells){ return }
            if(rules_card.classList.contains('is-dirty')){ rules_card.classList.add('is-stale'); return } // keep what the admin is ticking
            fill_rules()
        }
        live.listeners.add(on_live)
        fill_never()
        const opts = await api('/api/admin/listings/options')
        if(!alive){ return }
        if(opts.status == 'ok'){ cells = opts.cells; build_grid(); fill_rules() }
        else { $('#lr-grid').innerHTML = `<p class="admin-error">${esc(opts.message)}</p>` }
        draw_list()
        const timer = setInterval(() => { if(!document.hidden){ draw_list() } }, 60000)
        return () => { alive = false; live.listeners.delete(on_live); clearInterval(timer) }
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
        root.innerHTML = head('Trade records', "The newest trades the bots saved, and whether Latest trades on the home page shows each one. If one is skipped and shouldn't be, copy it and send it to us.",
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
                    <p class="muted small">${esc(r.layout)}</p>
                    <details><summary>Record as saved</summary><pre>${esc(r.raw)}</pre><button type="button" data-copy="${i}">Copy record</button></details>
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
        root.innerHTML = head('Notifications', 'Shown under the bell in the menu, for everyone. New giveaways and winners are added automatically; ticket replies and giveaway wins go only to that user.') + `
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

    const sections = { overview, value: inventory_value, settings: settings_section, stock: stock_section, listings: listings_section, users, ratings, trades: trade_records, notifications: notifications_section, tickets: (root) => tickets(root), blog, giveaways }
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
