/* Admin → Chat helper (talks to /api/admin/assistant*, service/assistant.js).

   On/off, the Claude API key (write-only: the panel never gets it back, only where it comes from and its last 4
   characters), the model and how long it thinks, the daily answer limit, today's usage with an estimated cost, what the
   firewall stopped, the last 30 days, and a "Try it" box that asks the helper something and shows the tools it used. */
(() => {
    const kit = window.admin_kit
    const sections = window.admin_sections
    if(!kit || !sections){ return }
    const { esc, when, ago, num, toast, head, stat, pill } = kit

    // the usage events (service/assistant.js count): what each means, and whether the firewall stopped something
    const EVENTS = {
        rate_limited: ['Too many messages from one visitor', true],
        cross_site: ['Requests from other sites', true],
        daily_limit: ['Turned away at the daily limit', true],
        busy: ['Second message while answering', true],
        turns: ['Chat full (12 questions)', true],
        too_long: ['Messages over 600 characters', true],
        unknown_tool: ['Tool calls outside the allowed four', true],
        bad_input: ['Tool calls with bad input', true],
        redacted: ['Answers with a secret cut out', true],
        links_removed: ['Answers with a link removed', true],
        suspicious: ['Messages that tried to change its rules (answered within the rules)', false],
        refusal: ['Questions Claude declined', false],
        error: ['Answers that failed', false]
    }
    const LANGS = [['en', 'English'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский'], ['zh', '中文']]
    // why a "Try it" question got no answer (service/assistant.js chat reasons)
    const REASONS = {
        empty: 'Type a question first.', not_text: 'Type a question first.', too_long: 'The question is over 600 characters.',
        daily_limit: 'Today\'s answer limit is reached. Raise the daily limit below to keep testing.',
        busy_api: 'Claude is busy right now (rate limit or overload). Try again in a minute.',
        unavailable: 'Claude didn\'t answer. If this keeps happening, check the API key and the spend limit in the Claude Console.',
        too_long_to_answer: 'The answer took too long. Try a shorter question or the Quick setting.'
    }
    // the answer's **bold** as on the site (links stay plain text here)
    const bold = (text) => esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    const money = (n) => '$' + (Number(n) || 0).toFixed(Number(n) >= 10 ? 2 : 3)

    const key_line = (k) => ({
        panel: `Saved here (ends in <code>${esc(k.hint)}</code>), ${esc(ago(k.saved))}. Kept encrypted with SESSION_SECRET.`,
        env: `From <code>ANTHROPIC_API_KEY</code> in .env (ends in <code>${esc(k.hint)}</code>). A key saved here would be used instead.`,
        unreadable: 'The key saved here can\'t be read any more (SESSION_SECRET changed?). Paste it again.',
        null: 'No key yet. The helper stays off until it has one.'
    })[k.source] || ''

    const assistant_section = async (root) => {
        let view = null
        let timer = null

        const load = async () => {
            const r = await kit.api('/api/admin/assistant')
            if(r.status != 'ok'){ root.innerHTML = head('Chat helper') + `<p class="admin-error">${esc(r.message)}</p>`; return false }
            view = r.assistant
            return true
        }

        const stats = () => {
            const u = view.usage
            return `<div class="admin-stats">
                ${stat('Answers today', `${num(u.answers)} <span class="muted small">/ ${num(view.daily_limit)}</span>`, 'resets at midnight UTC')}
                ${stat('Cost today', money(u.cost), `estimate from ${num(u.calls)} Claude call${u.calls == 1 ? '' : 's'}`)}
                ${stat('Blocked today', num(u.blocked), 'stopped by the firewall')}
                ${stat('Open chats', num(view.chats_open), 'in the last 45 minutes')}
            </div>`
        }

        const draw = () => {
            const k = view.key
            const has_key = Boolean(k.source && k.source != 'unreadable')
            const model = view.models.find((m) => m.id == view.model) || view.models[0]
            // what the firewall stopped, and what is only counted (failed answers, declined questions, rule-change attempts it answered anyway)
            const events = Object.entries(view.usage.events || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
            const stopped = events.filter(([e]) => EVENTS[e]?.[1] !== false)
            const noted = events.filter(([e]) => EVENTS[e]?.[1] === false)
            root.innerHTML = head('Chat helper', 'A chat window on every shop page. It answers questions from the site\'s public information, finds items in the bots\' stock and can put a Request trade card in the chat for signed-in visitors. It runs on the Claude API.',
                `${pill(view.active, 'Live', view.enabled ? 'Needs a key' : 'Off')}<button type="button" data-refresh>Refresh</button>`) + `
                <div id="as-stats">${stats()}</div>
                <div class="admin-setting-list">
                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>Chat helper</h3><p class="muted">The chat button in the bottom right corner of every page, and the news window that announces it. Off: no button, and the chat API answers 404.</p></div>
                        <div class="admin-setting-body">
                            <div class="admin-toggle-row"><label class="admin-switch"><input type="checkbox" id="as-enabled" aria-label="Chat helper" ${view.enabled ? 'checked' : ''} ${has_key || view.enabled ? '' : 'disabled'}><span></span></label>
                                <span class="admin-state">${view.active ? 'On: visitors see the chat button' : view.enabled ? 'On, but there is no working API key' : has_key ? 'Off' : 'Add an API key below first'}</span></div>
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>Claude API key</h3><p class="muted">Make a key in the <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Claude Console</a> and set a monthly spend limit there. The key is checked with Claude before it's saved and is never shown here again.</p></div>
                        <div class="admin-setting-body">
                            <p class="small">${key_line(k)}</p>
                            ${k.can_save ? `<form class="admin-inline-form" id="as-key-form" autocomplete="off">
                                <input type="password" id="as-key" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="Claude API key">
                                <button type="submit" class="primary">${k.panel_saved ? 'Replace key' : 'Save key'}</button>
                            </form>` : '<p class="admin-note">Set SESSION_SECRET (32 characters or more) in .env and restart: a key saved here is encrypted with it. Or put the key in ANTHROPIC_API_KEY in .env.</p>'}
                            ${k.panel_saved ? '<div class="admin-card-foot"><button type="button" data-remove-key>Remove the saved key</button></div>' : ''}
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>Model</h3><p class="muted">Changes apply to new chats. Prices are per million tokens; one answer is usually a few thousand tokens, most of them read from the cache at a tenth of the price or less.</p></div>
                        <div class="admin-setting-body">
                            <div class="admin-segment wrap" id="as-model" role="radiogroup" aria-label="Model">
                                ${view.models.map((m) => `<button type="button" role="radio" data-model="${esc(m.id)}" aria-checked="${m.id == view.model}">${esc(m.label)}</button>`).join('')}
                            </div>
                            <p class="muted small" id="as-model-note">${esc(model.note)}: $${model.price.input} in, $${model.price.output} out.</p>
                            <div class="admin-segment" id="as-effort" role="radiogroup" aria-label="Thinking">
                                ${Object.entries(view.efforts).map(([id, label]) => `<button type="button" role="radio" data-effort="${esc(id)}" aria-checked="${id == view.effort}">${esc(label)}</button>`).join('')}
                            </div>
                            <p class="muted small">How long it thinks before answering. Quick is enough for site questions and item lookups; Thorough is slower and costs more.</p>
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>Daily limit</h3><p class="muted">Answers a day for the whole site. When it's reached, the chat asks visitors to come back tomorrow. Each visitor also gets at most 6 messages a minute and 40 an hour (20 when not signed in).</p></div>
                        <div class="admin-setting-body">
                            <form class="admin-inline-form" id="as-limit-form">
                                <span class="admin-input-unit"><input type="number" id="as-limit" min="1" max="100000" step="1" value="${esc(view.daily_limit)}" aria-label="Answers a day"><em>answers a day</em></span>
                                <button type="submit">Save</button>
                            </form>
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>Try it</h3><p class="muted">Ask as a visitor would, in a new chat each time, and see which tools it used. It counts towards today's answers and cost. A trade card shows here, but its button only works on the site.</p></div>
                        <div class="admin-setting-body">
                            <form id="as-test-form" class="as-test">
                                <label class="admin-field">Question<textarea id="as-test-text" rows="2" maxlength="600" placeholder="e.g. I want to buy a Strange Part: Kills"></textarea></label>
                                <div class="admin-row-fields">
                                    <label class="admin-field">Language<select id="as-test-lang">${LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
                                    <label class="admin-toggle-row"><span class="admin-switch"><input type="checkbox" id="as-test-signed" checked><span></span></span>As a signed-in visitor</label>
                                </div>
                                <div class="admin-card-foot"><button type="submit" class="primary" ${view.active ? '' : 'disabled'}>Ask</button></div>
                            </form>
                            <div id="as-test-out"></div>
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>What the firewall stopped</h3><p class="muted">Today, and each of the last 30 days.</p></div>
                        <div class="admin-setting-body">
                            ${stopped.length ? `<div class="admin-table-wrap"><table class="admin-table">
                                <tr><th>Stopped today</th><th>Times</th></tr>
                                ${stopped.map(([e, n]) => `<tr><td>${esc(EVENTS[e]?.[0] || e)}</td><td>${num(n)}</td></tr>`).join('')}
                            </table></div>` : '<p class="admin-empty">Nothing stopped today.</p>'}
                            ${noted.length ? `<p class="muted small">Also counted today: ${noted.map(([e, n]) => `${esc(EVENTS[e]?.[0] || e)}: ${num(n)}`).join(' · ')}</p>` : ''}
                            ${view.days.length ? `<div class="admin-table-wrap"><table class="admin-table">
                                <tr><th>Day</th><th>Answers</th><th>Cost (estimate)</th><th>Blocked</th></tr>
                                ${[...view.days].reverse().map((d) => `<tr><td>${esc(d.day)}</td><td>${num(d.answers)}</td><td>${money(d.cost)}</td><td>${num(d.blocked)}</td></tr>`).join('')}
                            </table></div>` : '<p class="muted small">Earlier days show up here from tomorrow.</p>'}
                        </div>
                    </div>

                    <div class="admin-card admin-setting">
                        <div class="admin-setting-info"><h3>How it's kept safe</h3><p class="muted">docs/ASSISTANT.md has the details.</p></div>
                        <div class="admin-setting-body">
                            <ul class="as-safe">
                                <li>It only knows the site's public pages (llms.txt, the FAQ, About, the key bank, the giveaway, What's new) and the public item list. No accounts, trades, inventories, trade URLs, admin settings, bot accounts or server keys ever reach it.</li>
                                <li>It can use four tools and nothing else: search items, show item cards, put one trade card in the chat, read whether trading is on. None of them writes anything, and who the visitor is comes from their sign-in, never from the chat.</li>
                                <li>A trade card sends nothing. The visitor presses its button, which goes through the same checks as a direct buy link (signed in, trade URL, trading on, still in stock, blacklist, banned accounts), and then accepts the bot's offer in Steam.</li>
                                <li>Every answer is checked before it's shown: secrets from .env and anything shaped like a key or password are cut out (the chat is then closed), links only go to the site, its Steam group, Discord, Reddit, Trustpilot, backpack.tf and the TF2 Wiki, and the page draws only text, bold and those links.</li>
                                <li>Only the site's own pages can call the chat, with limits per visitor and per day. The chat itself stays on the server, so a page can't make up earlier answers.</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <p class="admin-meta">${view.updated ? `Last changed ${esc(ago(view.updated))} by ${esc(view.updated_by || 'admin')}.` : ''}</p>`
            bind()
        }

        const save = async (patch, message) => {
            const r = await kit.api('/api/admin/assistant', { patch })
            if(toast(r, message)){ view = r.assistant }
            draw()
        }

        const bind = () => {
            root.querySelector('[data-refresh]')?.addEventListener('click', async () => { if(await load()){ draw() } })
            root.querySelector('#as-enabled')?.addEventListener('change', (e) => save({ enabled: e.target.checked }, e.target.checked ? 'The chat button is on every page now.' : 'The chat helper is off.'))
            root.querySelector('#as-model')?.addEventListener('click', (e) => {
                const b = e.target.closest('[data-model]')
                if(b && b.dataset.model != view.model){ save({ model: b.dataset.model }, 'New chats use it.') }
            })
            root.querySelector('#as-effort')?.addEventListener('click', (e) => {
                const b = e.target.closest('[data-effort]')
                if(b && b.dataset.effort != view.effort){ save({ effort: b.dataset.effort }, 'New chats use it.') }
            })
            root.querySelector('#as-limit-form')?.addEventListener('submit', (e) => {
                e.preventDefault()
                save({ daily_limit: Number(root.querySelector('#as-limit').value) }, 'Daily limit saved.')
            })
            root.querySelector('#as-key-form')?.addEventListener('submit', async (e) => {
                e.preventDefault()
                const input = root.querySelector('#as-key')
                const button = e.target.querySelector('button')
                if(!input.value.trim()){ input.focus(); return }
                button.disabled = true
                button.textContent = 'Checking…'
                const r = await kit.api('/api/admin/assistant/key', { key: input.value.trim() })
                input.value = ''
                if(toast(r, 'Key saved. Switch the helper on when you\'re ready.')){ view = r.assistant }
                draw()
            })
            root.querySelector('[data-remove-key]')?.addEventListener('click', async () => {
                if(!confirm(view.key.source == 'panel' && !view.enabled ? 'Remove the saved key?' : 'Remove the saved key? Without another key the chat helper switches off.')){ return }
                const r = await kit.api('/api/admin/assistant/key', { key: '' })
                if(toast(r, 'Key removed.')){ view = r.assistant }
                draw()
            })
            root.querySelector('#as-test-form')?.addEventListener('submit', async (e) => {
                e.preventDefault()
                const out = root.querySelector('#as-test-out')
                const button = e.target.querySelector('button[type="submit"]')
                const message = root.querySelector('#as-test-text').value.trim()
                if(!message){ return }
                button.disabled = true
                out.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span> Asking…</div>'
                const r = await kit.api('/api/admin/assistant/test', { message, lang: root.querySelector('#as-test-lang').value, signed_in: root.querySelector('#as-test-signed').checked })
                button.disabled = false
                if(r.status != 'ok'){ out.innerHTML = `<p class="admin-error">${esc(REASONS[r.reason] || r.message || 'It didn\'t answer.')}</p>`; return }
                const cards = r.reply?.cards || []
                out.innerHTML = `<div class="as-test-answer">
                    <p class="as-test-text">${bold(r.reply?.text || (r.reply?.refused ? '(Claude declined this question.)' : '(no text)'))}</p>
                    ${cards.length ? `<ul class="as-test-cards">${cards.map((c) => `<li><span class="admin-tag">${c.kind == 'trade' ? 'Trade card' : 'Item card'}</span> ${esc(c.name)} · ${esc(c.price || (c.kind == 'item' ? 'not in stock' : ''))}${c.kind == 'trade' && Array.isArray(c.details) && c.details.length ? ` · ${esc(c.details.join(', '))}` : ''}${c.kind == 'trade' && c.sign_in ? ' · asks to sign in' : ''}</li>`).join('')}</ul>` : ''}
                    ${r.trace?.length ? `<details><summary>${r.trace.length} tool call${r.trace.length == 1 ? '' : 's'}</summary><pre class="admin-code">${esc(JSON.stringify(r.trace, null, 2))}</pre></details>` : '<p class="muted small">No tools used.</p>'}
                </div>`
                // the numbers changed
                if(await load()){ root.querySelector('#as-stats').innerHTML = stats() }
            })
        }

        if(!(await load())){ return }
        draw()
        // today's numbers, every 30 seconds while the section is open
        timer = setInterval(async () => {
            if(document.hidden){ return }
            const r = await kit.api('/api/admin/assistant')
            if(r.status == 'ok'){ view = { ...view, usage: r.assistant.usage, chats_open: r.assistant.chats_open, days: r.assistant.days }; const box = root.querySelector('#as-stats'); if(box){ box.innerHTML = stats() } }
        }, 30000)
        return () => clearInterval(timer)
    }

    sections.assistant = assistant_section
})();
