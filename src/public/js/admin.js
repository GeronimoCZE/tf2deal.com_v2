/* Admin panel: Overview, Live settings, Stock limits, Users, Ratings, Notifications, Tickets, Blog, Giveaways (talk to /api/admin/*).
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

    const blog = async (root) => {
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

    const giveaways = async (root) => {
        root.innerHTML = `<h2>Giveaways</h2><div id="admin-giveaways">Loading...</div>`
        const box = root.querySelector('#admin-giveaways')

        const res = await api('/api/admin/giveaways')
        if(res.status != 'ok'){ box.textContent = res.message; return }

        const active = res.giveaways.find((g) => g.status == 'active')
        const past = res.giveaways.filter((g) => g.status != 'active')

        const default_end = new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

        box.innerHTML = (active ? `<div class="admin-giveaway active" data-id="${esc(active._id)}">
                <img src="${esc(active.item.image)}" alt="">
                <div>
                    <strong>${esc(active.item.bp_sku)}</strong>
                    <div>Ends ${when(active.end)} &middot; ${active.entry_count} entries</div>
                    <div class="muted">Requirements: ${[active.requirements?.steam_group && 'Steam group', active.requirements?.trade && '1 trade'].filter(Boolean).join(', ') || 'none'}</div>
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
                <tr><th>Item</th><th>Ended</th><th>Entries</th><th>Winner</th><th>Prize sent</th></tr>
                ${past.map((g) => `<tr data-id="${esc(g._id)}">
                    <td>${esc(g.item.bp_sku)}</td>
                    <td>${g.status == 'cancelled' ? 'Cancelled' : when(g.end)}</td>
                    <td>${g.entry_count}</td>
                    <td>${g.winner?.steamid ? `<a href="https://steamcommunity.com/profiles/${esc(g.winner.steamid)}" target="_blank" rel="nofollow">${esc(g.winner.name || g.winner.steamid)}</a>
                        ${g.winner_tradelink ? `<br><a href="${esc(g.winner_tradelink)}" target="_blank" rel="nofollow">Send trade offer</a>` : '<br><span class="muted">no trade link</span>'}` : '-'}</td>
                    <td>${g.winner?.steamid ? `<input type="checkbox" class="prize-sent" ${g.prize_sent ? 'checked' : ''}>` : ''}</td>
                </tr>`).join('')}
            </table>`}`

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
                if(toast(r, r.winner ? `Winner: ${esc(r.winner.name || r.winner.steamid)}` : 'Ended, there were no entries.')){ giveaways(root) }
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
    const SETTING_NAMES = { trading_state: 'Trading', min_item_key: 'Min. price', max_item_key: 'Max. price', item_blacklist: 'Blacklist', announcement: 'Banner', reviews: 'Ratings', season: 'Season', extra: 'App values' }

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
                    ${stat('Key price', o.key_price ? `${num(o.key_price)} ref` : '–', 'Mann Co. Supply Crate Key')}
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
                    <p class="muted">During TF2 events the site changes its home picture, background, colours and the falling particles. On Auto the dates come from the TF2 update notes on teamfortress.com, with the usual dates as a fallback.</p>
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
        ['ks_stock_limit', 'Each killstreak tier', 'Per tier of a weapon (Killstreak, Specialized, Professional).'],
        ['ks_stock_limit_high_demand', 'Each tier, weapon in demand', 'When the plain weapon has many backpack.tf buy orders.'],
        ['ks_high_demand_buyorders', 'In demand from', 'backpack.tf buy orders for the plain weapon.', 'orders']
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
            ${global.missing.length ? `<p class="admin-note">This item server only knows ${global.limits.length ? 'the killstreak limits' : 'none of these limits'}. Update item_manager to set the others here.</p>` : ''}`
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

    const sections = { overview, settings: settings_section, stock: stock_section, users, ratings, notifications: notifications_section, tickets: (root) => tickets(root), blog, giveaways }
    let route_id = 0
    let cleanup = null

    const route = () => {
        const wanted = location.hash.slice(1)
        const name = sections[wanted] ? wanted : 'overview'
        document.querySelectorAll('.admin-nav a').forEach((a) => a.classList.toggle('active', a.dataset.section == name))
        if(cleanup){ cleanup(); cleanup = null }

        const id = ++route_id
        const root = document.getElementById('admin-content')
        root.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span> Loading…</div>'
        Promise.resolve(sections[name](root)).then((stop) => {
            if(typeof stop != 'function'){ return }
            if(id == route_id){ cleanup = stop } else { stop() }
        })
    }

    window.admin_sections = sections
    window.addEventListener('hashchange', route)
    document.addEventListener('DOMContentLoaded', () => {
        route()
        connect_live()
    })
})();
