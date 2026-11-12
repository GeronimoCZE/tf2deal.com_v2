/* Admin → Blog: the post list and the post editor (talk to /api/admin/blog/*).

   The editor is a block editor: every block (text, heading, picture, gallery, picture beside text, box, TF2 item card,
   button, YouTube video, list, quote, divider) is edited where it sits, looking like the post will. It saves the post
   as Markdown with layout blocks (js/blog_format.js), so translations, excerpts and old posts keep working, and the
   Markdown view edits that text directly.
   Text: select words for bold / italic / code / link (or Ctrl+B, Ctrl+I, Ctrl+K); type "/" in an empty line for the
   block list; "# ", "## ", "- ", "1. ", "> " at the start of a line turn it into a heading, list or quote.
   Alt+↑ / Alt+↓ move the block being edited.
   Pictures: drop or paste them anywhere, or upload / pick from the ones uploaded before. Big pictures are made smaller
   and WebP in the browser before they're uploaded (service/uploads.js stores them).
   The SEO tab shows how the post looks in Google and when shared, and checks what search engines look for; the title,
   description and share picture are made from the post unless you write your own.
   Unsaved changes are kept in this browser, so a closed tab doesn't lose them. Ctrl+S saves. */
(() => {
    const F = window.BlogFormat
    const kit = () => window.admin_kit
    const esc = (text) => F.escape_html(text)

    const LANGS = [['en', 'English'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский'], ['zh', '中文']]
    const LANG_NAME = Object.fromEntries(LANGS)
    const LAYOUTS = [
        ['standard', 'Standard', 'One column of text, cover under the title.', '<rect x="14" y="6" width="36" height="5" rx="1"/><rect x="14" y="14" width="36" height="14" rx="2" opacity=".55"/><rect x="14" y="31" width="36" height="2.5" rx="1" opacity=".4"/><rect x="14" y="36" width="30" height="2.5" rx="1" opacity=".4"/><rect x="14" y="41" width="34" height="2.5" rx="1" opacity=".4"/>'],
        ['feature', 'Feature', 'Big cover on top, larger title and an intro. For news and updates.', '<rect x="4" y="4" width="56" height="18" rx="2" opacity=".55"/><rect x="14" y="26" width="36" height="6" rx="1"/><rect x="14" y="35" width="30" height="2.5" rx="1" opacity=".7"/><rect x="14" y="41" width="34" height="2.5" rx="1" opacity=".4"/>'],
        ['guide', 'Guide', 'A contents list beside the text, made from the headings. For how-tos.', '<rect x="6" y="6" width="44" height="5" rx="1"/><rect x="6" y="15" width="14" height="2.5" rx="1" opacity=".7"/><rect x="6" y="20" width="12" height="2.5" rx="1" opacity=".7"/><rect x="6" y="25" width="14" height="2.5" rx="1" opacity=".7"/><rect x="25" y="15" width="33" height="2.5" rx="1" opacity=".4"/><rect x="25" y="20" width="30" height="2.5" rx="1" opacity=".4"/><rect x="25" y="25" width="33" height="2.5" rx="1" opacity=".4"/><rect x="25" y="30" width="28" height="2.5" rx="1" opacity=".4"/><rect x="25" y="35" width="33" height="2.5" rx="1" opacity=".4"/>']
    ]
    const SITE = 'tf2deal.com'
    const MAX_SIDE = 1800 // pictures wider or taller than this are made smaller before upload

    const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
    const I = {
        text: '<path d="M5 5h14v3h-2V7h-4v10h2v2H9v-2h2V7H7v1H5z"/>',
        heading: '<path d="M5 4h3v7h8V4h3v16h-3v-6H8v6H5z"/>',
        image: '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 11.5 4-4 3 3 2.5-2.5L19 17V7H5zM15.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>',
        gallery: '<path d="M3 4h8v7H3zm10 0h8v7h-8zM3 13h8v7H3zm10 0h8v7h-8z"/>',
        split: '<path d="M3 5h8v14H3zm10 2h8v2h-8zm0 4h8v2h-8zm0 4h6v2h-6z"/>',
        callout: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm7 3v5h2V7zm0 6v2h2v-2z"/>',
        item: '<path d="M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.6 3.3L12 10.8 5.4 7.5zM5 9.1l6 3v7.3l-6-3zm8 10.3v-7.3l6-3v7.3z"/>',
        button: '<path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm3 4v2h10v-2z"/>',
        youtube: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>',
        list: '<path d="M4 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm0 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm0 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 6h13v2H8zm0 5h13v2H8zm0 5h13v2H8z"/>',
        quote: '<path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>',
        divider: '<path d="M3 11h18v2H3z"/>',
        up: '<path d="m12 8-6 6 1.4 1.4 4.6-4.6 4.6 4.6L18 14z"/>',
        down: '<path d="m12 16 6-6-1.4-1.4-4.6 4.6-4.6-4.6L6 10z"/>',
        copy: '<path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h10V9z"/>',
        trash: '<path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z"/>',
        drag: '<path d="M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>',
        plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
        bold: '<path d="M7 4h6a4 4 0 0 1 2.9 6.8A4.5 4.5 0 0 1 14 20H7zm3 3v4h3a2 2 0 0 0 0-4zm0 7v3h4a1.5 1.5 0 0 0 0-3z"/>',
        italic: '<path d="M10 4h8v3h-2.8l-3 10H15v3H7v-3h2.8l3-10H10z"/>',
        code: '<path d="m8.6 16.6-4.6-4.6 4.6-4.6L7.2 6 1.2 12l6 6zm6.8 0 4.6-4.6-4.6-4.6L16.8 6l6 6-6 6z"/>',
        link: '<path d="M10.6 13.4a1 1 0 0 0 1.4 1.4l4.9-4.9a3 3 0 0 0-4.2-4.2l-2 2 1.4 1.4 2-2a1 1 0 0 1 1.4 1.4zm2.8-2.8a1 1 0 0 0-1.4-1.4l-4.9 4.9a3 3 0 0 0 4.2 4.2l2-2-1.4-1.4-2 2a1 1 0 0 1-1.4-1.4z"/>',
        clear: '<path d="M6 5h13v3h-5.2l-1.2 3.4L10.4 9l.3-1H6zm-2.6 1.4L4.8 5l14.8 14.8-1.4 1.4-6-6L11 20H8l1.8-5.2z"/>'
    }

    /* ========================= MARKDOWN <-> EDITABLE HTML ========================= */

    // text the reader types: characters that would start formatting are kept literal (\*)
    const esc_md = (text) => text.replace(/([\\`*[\]])/g, '\\$1')
    // a line that would turn into a heading, list, quote, block or divider stays text
    const esc_line = (line) => line.replace(/^(\s*)(#{1,6}\s|>|[-*+]\s|:::|-{3,}\s*$)/, '$1\\$2').replace(/^(\s*\d{1,3})([.)]\s)/, '$1\\$2')

    const wrap = (mark, text) => {
        const core = text.trim()
        if (!core) return text
        return text.match(/^\s*/)[0] + mark + core + mark + text.match(/\s*$/)[0]
    }
    const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE'])
    const safe_href = (href) => /^(https?:\/\/|\/(?!\/))/i.test(href || '') ? href.replace(/[\s)]/g, encodeURIComponent) : ''

    // the inline part of an editable element -> Markdown ("\n" for line breaks)
    const inline_md = (node) => {
        let out = ''
        node.childNodes.forEach((n) => {
            if (n.nodeType == 3) { out += esc_md(n.nodeValue.replace(/ /g, ' ').replace(/​/g, '')); return }
            if (n.nodeType != 1) return
            const tag = n.tagName
            if (tag == 'BR') out += '\n'
            else if (tag == 'STRONG' || tag == 'B') out += wrap('**', inline_md(n))
            else if (tag == 'EM' || tag == 'I') out += wrap('*', inline_md(n))
            else if (tag == 'CODE') out += n.textContent.replace(/`/g, '') ? '`' + n.textContent.replace(/`/g, '') + '`' : ''
            else if (tag == 'A') {
                const href = safe_href(n.getAttribute('href'))
                const label = inline_md(n).replace(/\n/g, ' ')
                out += href && label.trim() ? `[${label}](${href})` : label
            }
            else if (tag == 'IMG' || tag == 'SCRIPT' || tag == 'STYLE') {}
            else if (BLOCK_TAGS.has(tag)) { if (out && !out.endsWith('\n')) out += '\n'; out += inline_md(n) + '\n' }
            else out += inline_md(n)
        })
        return out
    }
    // one paragraph's Markdown, each line kept from turning into another block
    const para_md = (el) => inline_md(el).replace(/\n+$/, '').split('\n').map((line) => esc_line(line.replace(/\s+$/, ''))).join('\n').trim()

    // paragraphs and lists (boxes, text beside a picture) -> Markdown
    const multi_md = (el) => {
        const parts = []
        let loose = document.createElement('p')
        const flush = () => { const md = para_md(loose); if (md) parts.push(md); loose = document.createElement('p') }
        el.childNodes.forEach((n) => {
            if (n.nodeType == 1 && (n.tagName == 'UL' || n.tagName == 'OL')) {
                flush()
                const items = [...n.querySelectorAll(':scope > li')].map((li) => para_md(li).replace(/\n/g, ' ')).filter(Boolean)
                if (items.length) parts.push(items.map((item, i) => `${n.tagName == 'OL' ? `${i + 1}.` : '-'} ${item}`).join('\n'))
            } else if (n.nodeType == 1 && BLOCK_TAGS.has(n.tagName)) {
                flush()
                const md = para_md(n)
                if (md) parts.push(md)
            } else {
                loose.appendChild(n.cloneNode(true))
            }
        })
        flush()
        return parts.join('\n\n')
    }

    const inline_html = (md) => String(md || '').split('\n').map((line) => F.inline(line)).join('<br>')
    const multi_html = (md) => F.parse(md).map((b) => {
        if (b.type == 'list') return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((item) => `<li>${F.inline(item)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
        if (b.type == 'heading') return `<p><strong>${F.inline(b.text)}</strong></p>`
        if (b.type == 'paragraph' || b.type == 'quote') return `<p>${inline_html(b.text)}</p>`
        return ''
    }).join('') || '<p><br></p>'

    /* ========================= PICTURES ========================= */

    // a picture file -> a smaller WebP when it's big (GIFs as they are, they may move)
    const prepare_image = async (file) => {
        if (file.type == 'image/gif' || !window.createImageBitmap) return file
        try {
            const bitmap = await createImageBitmap(file)
            const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
            if (scale == 1 && file.type == 'image/webp') return file
            const canvas = document.createElement('canvas')
            canvas.width = Math.round(bitmap.width * scale)
            canvas.height = Math.round(bitmap.height * scale)
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
            if (!blob || blob.type != 'image/webp') return file
            return (scale == 1 && blob.size >= file.size) ? file : blob
        } catch (error) {
            return file
        }
    }

    const upload = async (file) => {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { iziToast.error({ title: 'Not a picture', message: 'PNG, JPEG, WebP or GIF only.' }); return null }
        const body = await prepare_image(file)
        try {
            const res = await fetch('/api/admin/blog/upload', { method: 'POST', headers: { 'Content-Type': body.type || file.type }, body })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.status != 'ok') throw new Error(data.message || `Upload failed (${res.status})`)
            return data.url
        } catch (error) {
            iziToast.error({ title: 'Upload failed', message: esc(error.message) })
            return null
        }
    }

    const pick_file = (multiple = false) => new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/webp,image/gif'
        input.multiple = multiple
        input.addEventListener('change', () => resolve([...input.files]))
        input.click()
    })

    // the pictures uploaded before, in a dialog; resolves with a url or null
    const pick_library = () => new Promise(async (resolve) => {
        const dialog = document.createElement('div')
        dialog.className = 'be-dialog'
        dialog.innerHTML = `<div class="be-dialog-card" role="dialog" aria-modal="true" aria-label="Uploaded pictures">
                <div class="be-dialog-head"><strong>Uploaded pictures</strong><button type="button" class="be-x" aria-label="Close">×</button></div>
                <div class="be-library"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>
            </div>`
        document.body.appendChild(dialog)
        const close = (value) => { dialog.remove(); document.removeEventListener('keydown', on_key); resolve(value) }
        const on_key = (e) => { if (e.key == 'Escape') close(null) }
        document.addEventListener('keydown', on_key)
        dialog.addEventListener('click', (e) => {
            if (e.target == dialog || e.target.closest('.be-x')) return close(null)
            const tile = e.target.closest('[data-url]')
            if (tile) close(tile.dataset.url)
        })
        const res = await kit().api('/api/admin/blog/uploads')
        const grid = dialog.querySelector('.be-library')
        if (res.status != 'ok') { grid.textContent = res.message; return }
        grid.innerHTML = res.files.length
            ? res.files.map((f) => `<button type="button" data-url="${esc(f.url)}" title="${Math.round(f.bytes / 1024)} KB"><img src="${esc(f.url)}" alt="" loading="lazy"></button>`).join('')
            : '<p class="admin-empty">Nothing uploaded yet.</p>'
    })

    /* ========================= BLOCK TYPES ========================= */

    const TYPES = {
        paragraph: { label: 'Text', desc: 'A paragraph', icon: I.text, make: () => ({ text: '' }) },
        heading: { label: 'Heading', desc: 'A section title (also the contents list)', icon: I.heading, make: () => ({ level: 2, text: '' }) },
        image: { label: 'Picture', desc: 'Upload, paste or pick, with a caption', icon: I.image, make: () => ({ src: '', alt: '', caption: '', size: 'normal' }) },
        gallery: { label: 'Gallery', desc: '2 to 6 pictures side by side', icon: I.gallery, make: () => ({ images: [], caption: '' }) },
        split: { label: 'Picture + text', desc: 'A picture beside a few paragraphs', icon: I.split, make: () => ({ side: 'left', src: '', alt: '', text: '' }) },
        callout: { label: 'Box', desc: 'A tip, note or warning that stands out', icon: I.callout, make: () => ({ tone: 'tip', text: '' }) },
        item: { label: 'TF2 item', desc: 'Item card with live prices, links to its page', icon: I.item, make: () => ({ sku: '' }) },
        button: { label: 'Button', desc: 'A green button, e.g. "Start trading"', icon: I.button, make: () => ({ label: 'Start trading', url: '/trade' }) },
        youtube: { label: 'YouTube', desc: 'A video that loads when it\'s played', icon: I.youtube, make: () => ({ video: '' }) },
        list: { label: 'List', desc: 'Bullets or numbers', icon: I.list, make: () => ({ ordered: false, items: [''] }) },
        quote: { label: 'Quote', desc: 'Words from someone else', icon: I.quote, make: () => ({ text: '' }) },
        divider: { label: 'Divider', desc: 'A line between parts', icon: I.divider, make: () => ({}) }
    }

    let next_id = 1
    const with_id = (block) => ({ ...block, id: next_id++ })

    /* ========================= LIST ========================= */

    const translation_summary = (post, info) => {
        if (!post.published) return ''
        if (!info?.enabled) return ''
        const states = Object.values(post.translation?.status || {})
        const done = states.filter((s) => s == 'done').length
        const failed = Object.keys(post.translation?.errors || {}).length
        if (failed && !post.translation?.queued) return `<span class="be-tr bad">${done}/${states.length} translated, ${failed} failed</span>`
        if (done == states.length) return `<span class="be-tr ok">${done}/${states.length} translated</span>`
        return `<span class="be-tr">${done}/${states.length} translated…</span>`
    }

    const list = async (root, action, id) => {
        if (action == 'new') return editor(root, null)
        if (action == 'edit' && id) {
            const res = await kit().api(`/api/admin/blog/${encodeURIComponent(id)}`)
            if (res.status == 'ok') return editor(root, res.post, res.translation)
            kit().toast(res)
        }
        root.innerHTML = kit().head('Blog', 'Posts and drafts. Click a post to edit it.', '<button class="primary" id="be-new" type="button">New post</button>') +
            '<div class="be-list" id="be-list"><div class="admin-loading"><span class="admin-spinner"></span> Loading…</div></div>'
        root.querySelector('#be-new').addEventListener('click', () => { location.hash = '#blog/new' })

        const res = await kit().api('/api/admin/blog')
        const box = root.querySelector('#be-list')
        if (res.status != 'ok') { box.textContent = res.message; return }
        const note = !res.translation?.enabled
            ? '<p class="admin-note">AI translation is off. Add <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_AI_TOKEN</code> (free) or <code>ANTHROPIC_API_KEY</code> to <code>.env</code> to translate posts into every site language.</p>'
            : ''
        if (!res.posts.length) {
            box.innerHTML = note + '<div class="be-empty"><strong>No posts yet</strong><span>Guides and news bring people from search engines. Start with something traders ask often.</span><a class="primary" href="#blog/new">Write the first post</a></div>'
            return
        }
        box.innerHTML = note + res.posts.map((p) => `<a class="be-row" href="#blog/edit/${esc(p._id)}">
                <span class="be-thumb">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : icon(I.text)}</span>
                <span class="be-row-main">
                    <strong>${esc(p.title)}</strong>
                    <span class="be-row-meta">/blog/${esc(p.slug)} · ${p.layout && p.layout != 'standard' ? esc(p.layout) + ' · ' : ''}${esc(LANG_NAME[p.lang] || p.lang || 'English')} · edited ${esc(kit().when(p.updated))}</span>
                </span>
                <span class="be-row-side">
                    <span class="be-status ${p.published ? 'live' : 'draft'}">${p.published ? 'Published' : 'Draft'}</span>
                    ${translation_summary(p, res.translation)}
                </span>
            </a>`).join('')
    }

    /* ========================= EDITOR ========================= */

    const editor = (root, post, translation_info) => {
        const key = `td_blog_draft_${post?._id || 'new'}`
        const state = {
            blocks: F.parse(post?.content || '').map(with_id),
            title: post?.title || '',
            excerpt: post?.excerpt || '',
            slug: post?.slug || '',
            slug_touched: Boolean(post?.slug),
            cover: post?.cover || '',
            lang: post?.lang || 'en',
            layout: post?.layout || 'standard',
            seo_title: post?.seo_title || '',
            seo_description: post?.seo_description || '',
            published: Boolean(post?.published),
            mode: 'blocks',
            tab: 'post'
        }
        if (!state.blocks.length) state.blocks.push(with_id({ type: 'paragraph', text: '' }))
        if (post?._id) history.replaceState(null, '', `#blog/edit/${post._id}`)

        const content = () => state.mode == 'markdown' ? root.querySelector('.be-source').value : F.serialize(state.blocks)
        const values = (published = state.published) => ({
            title: state.title.trim(), slug: state.slug, cover: state.cover, excerpt: state.excerpt.trim(), content: content(),
            published, lang: state.lang, layout: state.layout, seo_title: state.seo_title.trim(), seo_description: state.seo_description.trim()
        })
        const snapshot = () => JSON.stringify({ ...values(), published: state.published })
        let saved = post ? JSON.stringify({ title: post.title, slug: post.slug, cover: post.cover || '', excerpt: post.excerpt || '', content: F.serialize(F.parse(post.content || '')), published: Boolean(post.published), lang: post.lang || 'en', layout: post.layout || 'standard', seo_title: post.seo_title || '', seo_description: post.seo_description || '' }) : null
        const dirty = () => saved == null ? Boolean(state.title.trim() || content().trim()) : snapshot() != saved

        root.innerHTML = `<div class="be">
            <div class="be-bar">
                <a class="be-back" href="#blog">&larr; Posts</a>
                <span class="be-state" id="be-state"></span>
                <div class="be-bar-actions">
                    <div class="be-switch" role="group" aria-label="Editor view">
                        <button type="button" data-mode="blocks" class="on">Editor</button><button type="button" data-mode="markdown">Markdown</button>
                    </div>
                    <button type="button" id="be-preview">Preview</button>
                    <button type="button" id="be-draft"></button>
                    <button type="button" id="be-publish" class="be-go"></button>
                </div>
            </div>
            <div class="be-grid">
                <div class="be-canvas post-content" id="be-canvas">
                    <div class="be-cover" id="be-cover"></div>
                    <textarea class="be-title" id="be-title" rows="1" maxlength="150" placeholder="Post title" aria-label="Title">${esc(state.title)}</textarea>
                    <textarea class="be-excerpt" id="be-excerpt" rows="1" maxlength="300" placeholder="Intro: one or two sentences for the blog list and search results" aria-label="Intro">${esc(state.excerpt)}</textarea>
                    <div class="be-blocks" id="be-blocks"></div>
                    <button type="button" class="be-add-end" id="be-add-end">${icon(I.plus)} Add a block <span>or type / in an empty line</span></button>
                    <textarea class="be-source" id="be-source" hidden spellcheck="false" aria-label="Markdown"></textarea>
                </div>
                <aside class="be-side">
                    <div class="be-tabs" role="tablist">
                        <button type="button" role="tab" data-tab="post" class="on">Post</button>
                        <button type="button" role="tab" data-tab="seo">SEO <span class="be-score" id="be-score"></span></button>
                    </div>
                    <div class="be-pane" data-pane="post"></div>
                    <div class="be-pane" data-pane="seo" hidden></div>
                </aside>
            </div>
            <div class="be-palette" id="be-palette" hidden role="listbox" aria-label="Blocks"></div>
            <div class="be-format" id="be-format" hidden role="toolbar" aria-label="Text formatting">
                <button type="button" data-cmd="bold" title="Bold (Ctrl+B)">${icon(I.bold)}</button>
                <button type="button" data-cmd="italic" title="Italic (Ctrl+I)">${icon(I.italic)}</button>
                <button type="button" data-cmd="code" title="Code">${icon(I.code)}</button>
                <button type="button" data-cmd="link" title="Link (Ctrl+K)">${icon(I.link)}</button>
                <button type="button" data-cmd="clear" title="Plain text">${icon(I.clear)}</button>
                <form class="be-link-form" hidden><input type="text" placeholder="/items or https://…" aria-label="Link address"><button type="submit">Add</button></form>
            </div>
        </div>`

        const $ = (sel) => root.querySelector(sel)
        const blocks_box = $('#be-blocks')
        // the floating block list and formatting bar sit on <body>, above everything else on the page
        const palette = document.body.appendChild($('#be-palette'))
        const format_bar = document.body.appendChild($('#be-format'))
        const by_id = (id) => state.blocks.find((b) => b.id == id)
        const index_of = (id) => state.blocks.findIndex((b) => b.id == id)

        /* ---------- block rendering ---------- */

        const seg = (name, value, options) => `<span class="be-seg" data-set="${name}">${options.map(([v, label]) => `<button type="button" data-value="${esc(v)}" class="${String(v) == String(value) ? 'on' : ''}">${label}</button>`).join('')}</span>`
        const picker = (has, what = 'picture') => `<div class="be-drop" data-drop="1">
                ${icon(I.image)}
                <span>Drop a ${what} here or paste it</span>
                <span class="be-drop-actions"><button type="button" data-act="upload">Upload</button><button type="button" data-act="library">Uploaded</button><button type="button" data-act="url">Link</button></span>
            </div>`
        const alt_input = (value, label = 'Alt text: what the picture shows (search engines and screen readers read it)') =>
            `<input class="be-alt ${value ? '' : 'missing'}" data-field="alt" value="${esc(value)}" placeholder="${esc(label)}" maxlength="160">`

        const body_of = (b) => {
            switch (b.type) {
                case 'paragraph': return `<div class="be-rich" contenteditable="true" data-field="text" data-placeholder="Write, or type / for blocks">${inline_html(b.text)}</div>`
                case 'heading': return `<div class="be-rich be-h${b.level}" contenteditable="true" data-field="text" role="heading" aria-level="${b.level}" data-placeholder="Heading">${inline_html(b.text)}</div>`
                case 'quote': return `<blockquote><div class="be-rich" contenteditable="true" data-field="text" data-placeholder="Quote">${inline_html(b.text)}</div></blockquote>`
                case 'list': return `<div class="be-rich be-list-edit" contenteditable="true" data-field="items"><${b.ordered ? 'ol' : 'ul'}>${(b.items.length ? b.items : ['']).map((item) => `<li>${F.inline(item) || '<br>'}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}></div>`
                case 'divider': return '<hr>'
                case 'image': return b.src
                    ? `<figure class="pb-figure size-${esc(b.size)}"><img src="${esc(b.src)}" alt="${esc(b.alt)}"><figcaption><div class="be-rich be-caption" contenteditable="true" data-field="caption" data-placeholder="Caption (optional)">${inline_html(b.caption)}</div></figcaption></figure>${alt_input(b.alt)}`
                    : picker()
                case 'gallery': return `<div class="be-gallery">${b.images.map((image, i) => `<div class="be-gal-item" data-index="${i}"><img src="${esc(image.src)}" alt="${esc(image.alt)}"><input class="be-alt ${image.alt ? '' : 'missing'}" data-gal-alt="${i}" value="${esc(image.alt)}" placeholder="Alt text" maxlength="160"><button type="button" class="be-gal-x" data-act="gal-remove" aria-label="Remove picture">×</button></div>`).join('')}
                        ${b.images.length < 6 ? `<div class="be-drop be-gal-add" data-drop="1">${icon(I.plus)}<span class="be-drop-actions"><button type="button" data-act="upload">Upload</button><button type="button" data-act="library">Uploaded</button></span></div>` : ''}</div>
                    <div class="be-rich be-caption" contenteditable="true" data-field="caption" data-placeholder="Caption (optional)">${inline_html(b.caption)}</div>`
                case 'split': return `<div class="pb-split img-${b.side}">
                        <figure>${b.src ? `<img src="${esc(b.src)}" alt="${esc(b.alt)}">${alt_input(b.alt, 'Alt text')}` : picker()}</figure>
                        <div class="be-rich be-multi pb-split-text" contenteditable="true" data-field="text" data-multi="1" data-placeholder="Text beside the picture">${multi_html(b.text)}</div>
                    </div>`
                case 'callout': return `<aside class="pb-callout tone-${esc(b.tone)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon_for(b.tone)}</svg><div class="be-rich be-multi" contenteditable="true" data-field="text" data-multi="1" data-placeholder="What should readers not miss?">${multi_html(b.text)}</div></aside>`
                case 'item': return `<div class="be-item">
                        <input class="be-item-search" data-field="sku" value="${esc(b.sku)}" placeholder="Search an item, e.g. Team Captain" autocomplete="off" aria-label="Item name">
                        <div class="be-item-results" hidden></div>
                        <div class="be-item-card">${b.sku ? '<span class="muted">Loading the card…</span>' : '<span class="muted">The card shows the item\'s picture and today\'s buy and sell prices, and links to its page.</span>'}</div>
                    </div>`
                case 'button': return `<div class="be-button-edit"><span class="pb-button-row"><span class="pb-button be-button-preview">${esc(b.label || 'Button')}</span></span>
                        <label>Text <input data-field="label" value="${esc(b.label)}" maxlength="60"></label>
                        <label>Goes to <input data-field="url" value="${esc(b.url)}" list="be-pages" placeholder="/trade or https://…"></label>
                        <datalist id="be-pages"><option value="/trade"><option value="/items"><option value="/giveaway"><option value="/blog"><option value="/about"></datalist></div>`
                case 'youtube': return `<div class="be-yt">
                        ${b.video ? `<figure class="pb-video"><a><img src="https://i.ytimg.com/vi/${esc(b.video)}/hqdefault.jpg" alt=""><span class="pb-play"></span></a></figure>` : ''}
                        <input data-field="youtube" value="${b.video ? 'https://youtu.be/' + esc(b.video) : ''}" placeholder="Paste a YouTube link" aria-label="YouTube link">
                    </div>`
                default: return ''
            }
        }
        const ICONS = { tip: '<path d="M9 21h6v-1.5H9zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/>', note: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>', warning: '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>' }
        const icon_for = (tone) => ICONS[tone] || ICONS.note

        // the options in a block's tool row
        const options_of = (b) => {
            switch (b.type) {
                case 'heading': return seg('level', b.level, [[2, 'H2'], [3, 'H3']])
                case 'list': return seg('ordered', b.ordered, [[false, '• List'], [true, '1. List']])
                case 'image': return b.src ? seg('size', b.size, [['small', 'Small'], ['normal', 'Text width'], ['wide', 'Wide'], ['full', 'Full']]) + '<button type="button" data-act="replace">Replace</button>' : ''
                case 'split': return seg('side', b.side, [['left', 'Picture left'], ['right', 'Picture right']]) + (b.src ? '<button type="button" data-act="replace">Replace</button>' : '')
                case 'callout': return seg('tone', b.tone, [['tip', 'Tip'], ['note', 'Note'], ['warning', 'Warning']])
                default: return ''
            }
        }

        const block_html = (b) => `<div class="be-block be-${b.type}" data-id="${b.id}">
                <div class="be-gutter">
                    <button type="button" class="be-insert" data-act="insert" title="Add a block below" aria-label="Add a block below">${icon(I.plus)}</button>
                    <button type="button" class="be-drag" draggable="true" title="Drag to move" aria-label="Move">${icon(I.drag)}</button>
                </div>
                <div class="be-tools">
                    <span class="be-type">${icon(TYPES[b.type].icon)}${TYPES[b.type].label}</span>
                    ${options_of(b)}
                    <span class="be-tools-end">
                        <button type="button" data-act="up" title="Move up" aria-label="Move up">${icon(I.up)}</button>
                        <button type="button" data-act="down" title="Move down" aria-label="Move down">${icon(I.down)}</button>
                        <button type="button" data-act="copy" title="Duplicate" aria-label="Duplicate">${icon(I.copy)}</button>
                        <button type="button" data-act="delete" title="Delete" aria-label="Delete">${icon(I.trash)}</button>
                    </span>
                </div>
                <div class="be-body">${body_of(b)}</div>
            </div>`

        const render_blocks = () => {
            blocks_box.innerHTML = state.blocks.map(block_html).join('')
            blocks_box.querySelectorAll('.be-item').forEach((el) => load_item_card(el.closest('.be-block')))
        }
        const render_block = (b) => {
            const el = blocks_box.querySelector(`.be-block[data-id="${b.id}"]`)
            if (!el) return render_blocks()
            el.outerHTML = block_html(b)
            const fresh = blocks_box.querySelector(`.be-block[data-id="${b.id}"]`)
            if (b.type == 'item') load_item_card(fresh)
            return fresh
        }

        // focus a block's text: at its start or end
        const focus_block = (id, at_end = true) => {
            const rich = blocks_box.querySelector(`.be-block[data-id="${id}"] [contenteditable]`) || blocks_box.querySelector(`.be-block[data-id="${id}"] input`)
            if (!rich) return
            rich.focus()
            if (rich.isContentEditable) {
                const range = document.createRange()
                range.selectNodeContents(rich)
                range.collapse(!at_end)
                const sel = getSelection()
                sel.removeAllRanges()
                sel.addRange(range)
            }
        }

        const insert_at = (type, at, data = {}) => {
            const block = with_id({ type, ...TYPES[type].make(), ...data })
            state.blocks.splice(Math.max(0, Math.min(at, state.blocks.length)), 0, block)
            render_blocks()
            changed()
            return block
        }
        const insert_block = (type, after_id, data = {}) => insert_at(type, after_id == null ? state.blocks.length : index_of(after_id) + 1, data)
        const remove_block = (id) => {
            const at = index_of(id)
            if (at < 0) return
            state.blocks.splice(at, 1)
            if (!state.blocks.length) state.blocks.push(with_id({ type: 'paragraph', text: '' }))
            render_blocks()
            changed()
            const prev = state.blocks[Math.max(0, at - 1)]
            if (prev) focus_block(prev.id, true)
        }
        const move_block = (id, by) => {
            const at = index_of(id)
            const to = at + by
            if (at < 0 || to < 0 || to >= state.blocks.length) return
            const [b] = state.blocks.splice(at, 1)
            state.blocks.splice(to, 0, b)
            render_blocks()
            changed()
            blocks_box.querySelector(`.be-block[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
        }

        // reads an edited field of a block from the page into its data
        const read_field = (el) => {
            const block_el = el.closest('.be-block')
            const b = block_el && by_id(block_el.dataset.id)
            if (!b) return
            const field = el.dataset.field
            if (el.isContentEditable) {
                if (field == 'items') b.items = [...el.querySelectorAll('li')].map((li) => para_md(li).replace(/\n/g, ' '))
                else if (el.dataset.multi) b[field] = multi_md(el)
                else if (field == 'caption') b.caption = para_md(el).replace(/\n/g, ' ')
                else b[field] = para_md(el)
            } else if (el.dataset.galAlt != null) {
                b.images[Number(el.dataset.galAlt)].alt = el.value
                el.classList.toggle('missing', !el.value.trim())
            } else if (field == 'youtube') {
                const id = F.youtube_id(el.value)
                if (id != b.video) {
                    b.video = id
                    if (id) { const input = render_block(b)?.querySelector('[data-field="youtube"]'); input?.focus() }
                }
            } else if (field == 'sku') {
                b.sku = el.value.trim()
            } else if (field) {
                b[field] = el.value
                if (field == 'alt') el.classList.toggle('missing', !el.value.trim())
                if (b.type == 'button') block_el.querySelector('.be-button-preview').textContent = b.label || 'Button'
                if (field == 'alt') block_el.querySelector('figure img, .pb-split img')?.setAttribute('alt', el.value)
            }
        }

        /* ---------- pictures in blocks ---------- */

        const set_image = async (b, files, mode) => {
            if (b.type == 'gallery') {
                for (const file of files.slice(0, 6 - b.images.length)) {
                    const url = await upload(file)
                    if (url) b.images.push({ src: url, alt: '' })
                }
            } else {
                const url = await upload(files[0])
                if (!url) return
                b.src = url
            }
            render_block(b)
            changed()
        }
        const image_action = async (b, act) => {
            if (act == 'upload' || act == 'replace') {
                const files = await pick_file(b.type == 'gallery')
                if (files.length) await set_image(b, files)
            } else if (act == 'library') {
                const url = await pick_library()
                if (!url) return
                if (b.type == 'gallery') b.images.push({ src: url, alt: '' }); else b.src = url
                render_block(b)
                changed()
            } else if (act == 'url') {
                const url = prompt('Picture address (https://… or /uploads/…)')
                if (!url || !/^(https:\/\/|\/(?!\/))\S+$/.test(url.trim())) return
                b.src = url.trim()
                render_block(b)
                changed()
            }
        }

        /* ---------- item cards ---------- */

        const load_item_card = async (block_el) => {
            const b = block_el && by_id(block_el.dataset.id)
            if (!b?.sku) return
            const res = await kit().api('/api/admin/blog/preview', { content: `::: item ${b.sku}`, title: '' })
            const card = block_el.querySelector('.be-item-card')
            if (card && res.status == 'ok') card.innerHTML = res.html.replace(/<a /g, '<a tabindex="-1" onclick="return false" ')
        }
        let item_timer = null
        const search_items = (input) => {
            clearTimeout(item_timer)
            const results = input.parentElement.querySelector('.be-item-results')
            const q = input.value.trim()
            if (q.length < 2) { results.hidden = true; return }
            item_timer = setTimeout(async () => {
                const res = await kit().api('/api/admin/blog/items?q=' + encodeURIComponent(q))
                if (res.status != 'ok' || input.value.trim() != q) return
                results.innerHTML = res.items.length
                    ? res.items.map((item) => `<button type="button" data-sku="${esc(item.bp_sku)}">${item.image ? `<img src="${esc(item.image)}" alt="">` : ''}<span>${esc(item.bp_sku)}</span><small>${item.stock ? `${item.stock} in stock` : ''}</small></button>`).join('')
                    : '<span class="muted">No item with that name.</span>'
                results.hidden = false
            }, 250)
        }

        /* ---------- the block list (palette) ---------- */

        let palette_ctx = null // { after_id, replace_id, query }
        const open_palette = (anchor, ctx) => {
            palette_ctx = ctx
            draw_palette()
            const rect = anchor.getBoundingClientRect()
            palette.hidden = false
            const top = Math.min(rect.bottom + 6, innerHeight - palette.offsetHeight - 12)
            palette.style.top = Math.max(12, top) + 'px'
            palette.style.left = Math.max(12, Math.min(rect.left, innerWidth - palette.offsetWidth - 12)) + 'px'
        }
        const palette_types = () => {
            const q = (palette_ctx?.query || '').toLowerCase()
            return Object.entries(TYPES).filter(([type, t]) => !q || t.label.toLowerCase().includes(q) || type.includes(q) || t.desc.toLowerCase().includes(q))
        }
        const draw_palette = () => {
            const types = palette_types()
            palette.innerHTML = types.length
                ? types.map(([type, t], i) => `<button type="button" role="option" data-type="${type}" class="${i == 0 ? 'on' : ''}">${icon(t.icon)}<span><strong>${t.label}</strong><small>${t.desc}</small></span></button>`).join('')
                : '<span class="muted">No block called that</span>'
        }
        const close_palette = () => { palette.hidden = true; palette_ctx = null }
        const choose_type = (type) => {
            const ctx = palette_ctx
            close_palette()
            if (!ctx) return
            let block
            if (ctx.replace_id != null) {
                const at = index_of(ctx.replace_id)
                block = with_id({ type, ...TYPES[type].make() })
                state.blocks.splice(at, 1, block)
                render_blocks()
                changed()
            } else {
                block = insert_block(type, ctx.after_id)
            }
            if (['image', 'split'].includes(type)) return
            if (type == 'divider') { const p = insert_block('paragraph', block.id); return focus_block(p.id) }
            focus_block(block.id)
        }

        /* ---------- formatting toolbar ---------- */

        let saved_range = null
        const rich_of = (node) => (node?.nodeType == 1 ? node : node?.parentElement)?.closest('.be-canvas [contenteditable="true"]')
        const place_format_bar = () => {
            const sel = getSelection()
            if (!sel.rangeCount || sel.isCollapsed || !rich_of(sel.anchorNode) || format_bar.querySelector('.be-link-form:not([hidden])')) {
                if (!format_bar.matches(':focus-within')) format_bar.hidden = true
                return
            }
            const rect = sel.getRangeAt(0).getBoundingClientRect()
            format_bar.hidden = false
            format_bar.style.top = Math.max(8, rect.top - format_bar.offsetHeight - 8) + 'px'
            format_bar.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - format_bar.offsetWidth / 2, innerWidth - format_bar.offsetWidth - 8)) + 'px'
        }
        const apply_format = (cmd) => {
            const sel = getSelection()
            const rich = rich_of(sel.anchorNode)
            if (!rich) return
            if (cmd == 'bold' || cmd == 'italic') document.execCommand(cmd)
            else if (cmd == 'clear') { document.execCommand('removeFormat'); document.execCommand('unlink') }
            else if (cmd == 'code' && sel.rangeCount && !sel.isCollapsed) {
                const text = sel.toString().replace(/`/g, '')
                document.execCommand('insertHTML', false, `<code>${esc(text)}</code>`)
            } else if (cmd == 'link') {
                saved_range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
                const form = format_bar.querySelector('.be-link-form')
                form.hidden = false
                const existing = (sel.anchorNode?.parentElement?.closest('a'))?.getAttribute('href') || ''
                form.querySelector('input').value = existing
                form.querySelector('input').focus()
                return
            }
            read_field(rich)
            changed()
        }
        format_bar.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault() })
        format_bar.addEventListener('click', (e) => { const btn = e.target.closest('[data-cmd]'); if (btn) apply_format(btn.dataset.cmd) })
        format_bar.querySelector('.be-link-form').addEventListener('submit', (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const url = form.querySelector('input').value.trim()
            form.hidden = true
            if (!saved_range) return
            const sel = getSelection()
            sel.removeAllRanges()
            sel.addRange(saved_range)
            const rich = rich_of(saved_range.startContainer)
            if (!url) document.execCommand('unlink')
            else if (/^(https?:\/\/|\/(?!\/))\S+$/i.test(url)) document.execCommand('createLink', false, url)
            else if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url)) document.execCommand('createLink', false, 'https://' + url)
            else { iziToast.error({ title: 'Link', message: 'Start the address with / (this site) or https://' }) }
            format_bar.hidden = true
            if (rich) { read_field(rich); changed() }
        })

        /* ---------- keyboard in text blocks ---------- */

        // splits a text block at the caret: the text after it moves into a new paragraph below
        const split_at_caret = (rich, b) => {
            const sel = getSelection()
            if (!sel.rangeCount) return
            const range = sel.getRangeAt(0)
            range.deleteContents()
            const tail = document.createRange()
            tail.setStart(range.startContainer, range.startOffset)
            tail.setEnd(rich, rich.childNodes.length)
            const box = document.createElement('div')
            box.appendChild(tail.extractContents())
            read_field(rich)
            const text = para_md(box)
            const block = with_id({ type: 'paragraph', text })
            state.blocks.splice(index_of(b.id) + 1, 0, block)
            render_blocks()
            changed()
            focus_block(block.id, false)
        }

        const shortcut = (rich, b) => {
            if (b.type != 'paragraph') return false
            const text = rich.textContent.replace(/ /g, ' ')
            const rules = [[/^# $/, 'heading', { level: 2 }], [/^## $/, 'heading', { level: 3 }], [/^[-*] $/, 'list', { ordered: false }], [/^1[.)] $/, 'list', { ordered: true }], [/^> $/, 'quote', {}]]
            for (const [re, type, data] of rules) {
                if (re.test(text)) {
                    const block = with_id({ type, ...TYPES[type].make(), ...data })
                    state.blocks.splice(index_of(b.id), 1, block)
                    render_blocks()
                    changed()
                    focus_block(block.id)
                    return true
                }
            }
            return false
        }

        blocks_box.addEventListener('keydown', (e) => {
            const rich = e.target.closest('[contenteditable="true"]')
            if (!rich) return
            const b = by_id(rich.closest('.be-block').dataset.id)
            if (!palette.hidden && palette_ctx?.replace_id == b.id) {
                const buttons = [...palette.querySelectorAll('button')]
                const on = buttons.findIndex((btn) => btn.classList.contains('on'))
                if (e.key == 'ArrowDown' || e.key == 'ArrowUp') {
                    e.preventDefault()
                    buttons[on]?.classList.remove('on')
                    buttons[(on + (e.key == 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.classList.add('on')
                    return
                }
                if (e.key == 'Enter') { e.preventDefault(); const pick = palette.querySelector('button.on'); if (pick) choose_type(pick.dataset.type); return }
                if (e.key == 'Escape') { close_palette(); return }
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 'k') { e.preventDefault(); apply_format('link'); return }
            if (e.altKey && (e.key == 'ArrowUp' || e.key == 'ArrowDown')) { e.preventDefault(); move_block(b.id, e.key == 'ArrowUp' ? -1 : 1); focus_block(b.id); return }
            const single = ['paragraph', 'heading', 'quote'].includes(b.type) && rich.dataset.field == 'text'
            if (e.key == 'Enter' && !e.shiftKey && single) {
                e.preventDefault()
                split_at_caret(rich, b)
                return
            }
            if (e.key == 'Enter' && rich.classList.contains('be-caption')) { e.preventDefault(); return }
            if (e.key == 'Enter' && !e.shiftKey && b.type == 'list') {
                const li = getSelection().anchorNode?.parentElement?.closest('li') || (getSelection().anchorNode?.nodeName == 'LI' ? getSelection().anchorNode : null)
                if (li && !li.textContent.trim() && !li.nextElementSibling) {
                    e.preventDefault()
                    li.remove()
                    read_field(rich)
                    const p = insert_block('paragraph', b.id)
                    focus_block(p.id)
                }
                return
            }
            if (e.key == 'Backspace' && single) {
                const sel = getSelection()
                const at_start = sel.isCollapsed && (() => { const r = document.createRange(); r.selectNodeContents(rich); r.setEnd(sel.anchorNode, sel.anchorOffset); return r.toString() === '' })()
                if (!at_start) return
                const at = index_of(b.id)
                const prev = state.blocks[at - 1]
                if (!rich.textContent.trim()) {
                    e.preventDefault()
                    if (state.blocks.length > 1) remove_block(b.id)
                } else if (prev && ['paragraph', 'heading', 'quote'].includes(prev.type) && b.type == 'paragraph') {
                    e.preventDefault()
                    read_field(rich)
                    prev.text = (prev.text + ' ' + b.text).trim()
                    state.blocks.splice(at, 1)
                    render_blocks()
                    changed()
                    focus_block(prev.id, true)
                } else if (b.type != 'paragraph') {
                    e.preventDefault()
                    read_field(rich)
                    const block = with_id({ type: 'paragraph', text: b.text })
                    state.blocks.splice(at, 1, block)
                    render_blocks()
                    changed()
                    focus_block(block.id, false)
                }
            }
        })

        blocks_box.addEventListener('input', (e) => {
            const el = e.target.closest('[contenteditable="true"], input')
            if (!el) return
            if (el.matches('.be-item-search')) { read_field(el); search_items(el); changed(); return }
            const b = by_id(el.closest('.be-block').dataset.id)
            if (el.isContentEditable && shortcut(el, b)) return
            read_field(el)
            changed()
            // "/" in an empty text block: the block list, filtered by what follows
            if (b.type == 'paragraph' && el.isContentEditable) {
                const m = el.textContent.match(/^\/([a-z +]*)$/i)
                if (m) { open_palette(el, { replace_id: b.id, query: m[1].trim() }); return }
                if (palette_ctx?.replace_id == b.id) close_palette()
            }
        })

        // pasted text arrives plain (no colours or fonts from other sites); text with empty lines becomes blocks, a
        // pasted picture is uploaded into a picture block
        blocks_box.addEventListener('paste', async (e) => {
            const rich = e.target.closest('[contenteditable="true"]')
            if (!rich) return
            const b = by_id(rich.closest('.be-block').dataset.id)
            const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
            if (files.length) {
                e.preventDefault()
                const block = insert_block('image', b.id)
                await set_image(block, files)
                return
            }
            const text = e.clipboardData?.getData('text/plain') || ''
            e.preventDefault()
            if (/\n\s*\n/.test(text) && rich.dataset.field == 'text' && !rich.dataset.multi && b.type == 'paragraph') {
                const pasted = F.parse(text).map(with_id)
                if (!pasted.length) return
                const at = index_of(b.id)
                const empty = !rich.textContent.trim()
                state.blocks.splice(empty ? at : at + 1, empty ? 1 : 0, ...pasted)
                render_blocks()
                changed()
                focus_block(pasted[pasted.length - 1].id)
                return
            }
            document.execCommand('insertText', false, rich.dataset.multi ? text : text.replace(/\n{2,}/g, '\n'))
        })

        blocks_box.addEventListener('focusout', (e) => {
            const input = e.target.closest('.be-item-search')
            if (input) setTimeout(() => { input.parentElement.querySelector('.be-item-results').hidden = true; load_item_card(input.closest('.be-block')) }, 200)
        })

        blocks_box.addEventListener('click', async (e) => {
            const block_el = e.target.closest('.be-block')
            const b = block_el && by_id(block_el.dataset.id)
            if (!b) return
            const sku = e.target.closest('[data-sku]')
            if (sku) {
                b.sku = sku.dataset.sku
                block_el.querySelector('.be-item-search').value = b.sku
                block_el.querySelector('.be-item-results').hidden = true
                load_item_card(block_el)
                changed()
                return
            }
            const set = e.target.closest('[data-set] [data-value]')
            if (set) {
                const name = set.parentElement.dataset.set
                const raw = set.dataset.value
                b[name] = raw == 'true' ? true : raw == 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw
                render_block(b)
                changed()
                return
            }
            const act = e.target.closest('[data-act]')?.dataset.act
            if (!act) return
            if (act == 'insert') return open_palette(e.target.closest('[data-act]'), { after_id: b.id })
            if (act == 'up') return move_block(b.id, -1)
            if (act == 'down') return move_block(b.id, 1)
            if (act == 'delete') return remove_block(b.id)
            if (act == 'copy') {
                const copy = with_id(JSON.parse(JSON.stringify({ ...b, id: undefined })))
                state.blocks.splice(index_of(b.id) + 1, 0, copy)
                render_blocks()
                changed()
                return
            }
            if (act == 'gal-remove') {
                b.images.splice(Number(e.target.closest('[data-index]').dataset.index), 1)
                render_block(b)
                changed()
                return
            }
            if (['upload', 'library', 'url', 'replace'].includes(act)) return image_action(b, act)
        })

        /* ---------- drag to move blocks, drop pictures ---------- */

        let dragging = null
        blocks_box.addEventListener('dragstart', (e) => {
            const handle = e.target.closest('.be-drag')
            if (!handle) return
            dragging = Number(handle.closest('.be-block').dataset.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', 'block')
            handle.closest('.be-block').classList.add('dragging')
        })
        blocks_box.addEventListener('dragend', () => {
            dragging = null
            blocks_box.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'))
        })
        const drop_target = (e) => {
            const block_el = e.target.closest('.be-block')
            if (!block_el) return null
            const rect = block_el.getBoundingClientRect()
            return { block_el, after: e.clientY > rect.top + rect.height / 2 }
        }
        root.querySelector('#be-canvas').addEventListener('dragover', (e) => {
            const files = [...(e.dataTransfer?.items || [])].some((item) => item.kind == 'file')
            if (!dragging && !files) return
            e.preventDefault()
            blocks_box.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
            const t = drop_target(e)
            if (t && !e.target.closest('[data-drop]')) t.block_el.classList.add(t.after ? 'drop-after' : 'drop-before')
        })
        root.querySelector('#be-canvas').addEventListener('drop', async (e) => {
            const t = drop_target(e)
            blocks_box.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
            const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
            if (files.length) {
                e.preventDefault()
                const zone = e.target.closest('[data-drop]')
                const target = zone && by_id(zone.closest('.be-block').dataset.id)
                if (target) return set_image(target, files)
                if (e.target.closest('.be-cover')) return set_cover(files[0])
                const at = t ? index_of(Number(t.block_el.dataset.id)) + (t.after ? 1 : 0) : state.blocks.length
                const block = insert_at(files.length > 1 ? 'gallery' : 'image', at)
                return set_image(block, files)
            }
            if (dragging == null || !t) return
            e.preventDefault()
            const from = index_of(dragging)
            const [moved] = state.blocks.splice(from, 1)
            let to = index_of(Number(t.block_el.dataset.id))
            if (to < 0) to = from
            state.blocks.splice(t.after ? to + 1 : to, 0, moved)
            dragging = null
            render_blocks()
            changed()
        })

        /* ---------- palette and add buttons ---------- */

        palette.addEventListener('mousedown', (e) => e.preventDefault())
        palette.addEventListener('click', (e) => { const btn = e.target.closest('[data-type]'); if (btn) choose_type(btn.dataset.type) })
        $('#be-add-end').addEventListener('click', (e) => open_palette(e.currentTarget, { after_id: state.blocks[state.blocks.length - 1]?.id ?? null }))
        const outside = (e) => {
            if (!palette.hidden && !palette.contains(e.target) && !e.target.closest('[data-act="insert"], #be-add-end')) close_palette()
        }
        document.addEventListener('mousedown', outside)

        /* ---------- cover, title, intro ---------- */

        const draw_cover = () => {
            const box = $('#be-cover')
            box.innerHTML = state.cover
                ? `<img src="${esc(state.cover)}" alt=""><span class="be-cover-actions"><button type="button" data-cover="change">Change cover</button><button type="button" data-cover="remove">Remove</button></span>`
                : `<button type="button" class="be-cover-add" data-cover="change">${icon(I.image)} Add a cover picture <span>shown on top of the post, in the blog list and when the post is shared</span></button>`
            box.classList.toggle('has', Boolean(state.cover))
        }
        const set_cover = async (file) => {
            const url = await upload(file)
            if (url) { state.cover = url; draw_cover(); changed() }
        }
        $('#be-cover').addEventListener('click', async (e) => {
            const act = e.target.closest('[data-cover]')?.dataset.cover
            if (act == 'remove') { state.cover = ''; draw_cover(); changed() }
            if (act == 'change') {
                const files = await pick_file(false)
                if (files.length) set_cover(files[0])
            }
        })
        const autosize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
        const title_el = $('#be-title'), excerpt_el = $('#be-excerpt')
        title_el.addEventListener('input', () => {
            state.title = title_el.value.replace(/\n/g, ' ')
            if (!state.slug_touched) state.slug = slugify(state.title)
            autosize(title_el)
            changed()
            draw_post_pane_slug()
        })
        title_el.addEventListener('keydown', (e) => { if (e.key == 'Enter') { e.preventDefault(); excerpt_el.focus() } })
        excerpt_el.addEventListener('input', () => { state.excerpt = excerpt_el.value.replace(/\n/g, ' '); autosize(excerpt_el); changed() })
        excerpt_el.addEventListener('keydown', (e) => { if (e.key == 'Enter') { e.preventDefault(); focus_block(state.blocks[0].id, false) } })

        const slugify = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)

        /* ---------- side panel: post ---------- */

        const post_pane = root.querySelector('[data-pane="post"]')
        const draw_post_pane = () => {
            const status = post?.translation?.status || {}
            const errors = post?.translation?.errors || {}
            post_pane.innerHTML = `
                <section>
                    <h3>Layout</h3>
                    <div class="be-layouts">${LAYOUTS.map(([value, label, desc, svg]) => `<button type="button" data-layout="${value}" class="${state.layout == value ? 'on' : ''}" title="${esc(desc)}">
                        <svg viewBox="0 0 64 48" aria-hidden="true">${svg}</svg><span>${label}</span></button>`).join('')}</div>
                    <p class="be-hint">${esc(LAYOUTS.find(([v]) => v == state.layout)[2])}</p>
                </section>
                <section>
                    <h3>Address</h3>
                    <label class="be-slug"><span>/blog/</span><input id="be-slug" value="${esc(state.slug)}" maxlength="100" placeholder="made-from-the-title" aria-label="Address"></label>
                    ${post?.published ? '<p class="be-hint">Changing the address of a published post breaks links to it.</p>' : ''}
                </section>
                <section>
                    <h3>Written in</h3>
                    <select id="be-lang" aria-label="Written in">${LANGS.map(([code, name]) => `<option value="${code}" ${state.lang == code ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
                    <p class="be-hint">${translation_info?.enabled ? 'Translated into the other languages after you publish.' : 'AI translation is off (see the Blog page).'}</p>
                    ${post?.published && Object.keys(status).length ? `<div class="be-langs">${Object.entries(status).map(([lang, s]) => `<a href="/${lang}/blog/${esc(post.slug)}" target="_blank" class="${s}" title="${esc(errors[lang] || s)}">${esc(LANG_NAME[lang] || lang)}</a>`).join('')}</div>
                        ${translation_info?.enabled ? '<button type="button" id="be-retranslate" class="be-quiet">Translate again</button>' : ''}` : ''}
                </section>
                ${post ? `<section class="be-danger">
                    ${post.published ? '<button type="button" id="be-unpublish" class="be-quiet">Turn back into a draft</button>' : ''}
                    <a href="/blog/${esc(post.slug)}" target="_blank" class="be-quiet">Open the page</a>
                    <button type="button" id="be-delete" class="be-quiet bad">Delete post</button>
                </section>` : ''}`
        }
        const draw_post_pane_slug = () => { const input = $('#be-slug'); if (input && document.activeElement != input) input.value = state.slug }
        post_pane.addEventListener('click', async (e) => {
            const layout = e.target.closest('[data-layout]')
            if (layout) { state.layout = layout.dataset.layout; draw_post_pane(); changed(); return }
            if (e.target.closest('#be-retranslate')) {
                const res = await kit().api(`/api/admin/blog/${post._id}/translate`, {})
                kit().toast(res, 'Translating in the background, about a minute per language.')
            }
            if (e.target.closest('#be-unpublish')) save(false)
            if (e.target.closest('#be-delete') && confirm('Delete this post? This cannot be undone.')) {
                const res = await kit().api(`/api/admin/blog/${post._id}/delete`, {})
                if (kit().toast(res, 'Post deleted.')) { forget(); saved = snapshot(); location.hash = '#blog' }
            }
        })
        post_pane.addEventListener('input', (e) => {
            if (e.target.id == 'be-slug') { state.slug = slugify(e.target.value.replace(/\s/g, '-')) || ''; state.slug_touched = Boolean(e.target.value.trim()); changed() }
        })
        post_pane.addEventListener('change', (e) => {
            if (e.target.id == 'be-lang') { state.lang = e.target.value; changed() }
            if (e.target.id == 'be-slug') { e.target.value = state.slug }
        })

        /* ---------- side panel: SEO ---------- */

        const seo_pane = root.querySelector('[data-pane="seo"]')
        const auto_title = () => [`${state.title} – TF2Deal.com Blog`, `${state.title} | TF2Deal.com`].find((t) => t.length <= 70) || state.title
        const auto_description = (md) => {
            const text = state.excerpt.trim() || F.plain_text(md).replace(/\s+/g, ' ').trim()
            return text.length > 155 ? text.slice(0, 154).replace(/\s+\S*$/, '') + '…' : text
        }
        const seo_facts = () => {
            const md = content()
            const blocks = F.parse(md)
            const text = F.plain_text(md)
            const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length
            const images = blocks.flatMap((b) => b.type == 'image' || b.type == 'split' ? [b] : b.type == 'gallery' ? b.images : [])
            const headings = blocks.filter((b) => b.type == 'heading')
            const own_links = (md.match(/\]\((\/[^)\s]*|https?:\/\/(www\.)?tf2deal\.com[^)\s]*)\)/g) || []).length + blocks.filter((b) => b.type == 'item' || (b.type == 'button' && F.is_own(b.url))).length
            const title = state.seo_title.trim() || auto_title()
            const description = state.seo_description.trim() || auto_description(md)
            const picture = state.cover || images[0]?.src || ''
            return { md, words, images, headings, own_links, title, description, picture, minutes: Math.max(1, Math.round(words / 220)) }
        }
        const checks_of = (f) => [
            [f.title.length >= 25 && f.title.length <= 70, 'Search title is 25–70 characters', `${f.title.length} now. Google cuts longer titles.`],
            [f.description.length >= 70 && f.description.length <= 160, 'Description is 70–160 characters', `${f.description.length} now. Write an intro, or your own description below.`],
            [Boolean(state.excerpt.trim()), 'The post has an intro', 'Shown in the blog list and used as the description.'],
            [Boolean(f.picture), 'There is a picture for shares', 'Add a cover or a picture in the post.'],
            [f.images.every((image) => (image.alt || '').trim()), 'Every picture has alt text', `${f.images.filter((image) => !(image.alt || '').trim()).length} without.`],
            [f.words >= 300, 'At least 300 words', `${f.words} words now. Short posts rarely rank.`],
            [f.headings.length >= 2 || f.words < 300, 'Sections have headings', 'Headings help readers and give Google jump links.'],
            [f.own_links >= 1, 'Links to other TF2Deal pages', 'Link items, the trade page or other posts (an item card counts).'],
            [Boolean(state.slug) && state.slug.length <= 60, 'Short address', `/blog/${state.slug || '…'}`]
        ]
        const draw_seo_pane = () => {
            const f = seo_facts()
            const checks = checks_of(f)
            const passed = checks.filter(([ok]) => ok).length
            $('#be-score').textContent = `${passed}/${checks.length}`
            $('#be-score').className = 'be-score ' + (passed >= checks.length - 1 ? 'ok' : passed >= checks.length - 3 ? 'mid' : 'low')
            const focus = document.activeElement?.closest?.('[data-pane="seo"]') ? document.activeElement.id : null
            seo_pane.innerHTML = `
                <section>
                    <h3>In Google</h3>
                    <div class="be-serp">
                        <span class="be-serp-site"><img src="/img/logo_icon.png" alt="">${SITE} › blog › ${esc(state.slug || '…')}</span>
                        <span class="be-serp-title">${esc(f.title.length > 62 ? f.title.slice(0, 60) + '…' : f.title || 'Post title')}</span>
                        <span class="be-serp-desc">${esc(f.description || 'The description: your intro, or the start of the text.')}</span>
                    </div>
                </section>
                <section>
                    <h3>When shared</h3>
                    <div class="be-share">
                        ${f.picture ? `<img src="${esc(f.picture)}" alt="">` : '<span class="be-share-none">No picture: add a cover</span>'}
                        <span class="be-share-text"><small>${SITE.toUpperCase()}</small><strong>${esc(f.title || 'Post title')}</strong><span>${esc(f.description)}</span></span>
                    </div>
                </section>
                <section>
                    <h3>Checks <span class="be-count">${passed} of ${checks.length}</span></h3>
                    <ul class="be-checks">${checks.map(([ok, label, hint]) => `<li class="${ok ? 'ok' : 'todo'}"><span class="be-check-mark" aria-hidden="true"></span><span><strong>${esc(label)}</strong>${ok ? '' : `<small>${esc(hint)}</small>`}</span></li>`).join('')}</ul>
                    <p class="be-hint">${f.words} words · ${f.minutes} min read · ${f.headings.length} headings · ${f.images.length} pictures</p>
                </section>
                <section>
                    <h3>Your own search text <span class="be-count">optional</span></h3>
                    <label class="be-field">Search title <span class="be-len ${state.seo_title.length > 70 ? 'over' : ''}">${state.seo_title.length}/70</span>
                        <input id="be-seo-title" value="${esc(state.seo_title)}" maxlength="120" placeholder="${esc(auto_title())}"></label>
                    <label class="be-field">Description <span class="be-len ${state.seo_description.length > 160 ? 'over' : ''}">${state.seo_description.length}/160</span>
                        <textarea id="be-seo-desc" rows="3" maxlength="320" placeholder="${esc(auto_description(f.md))}">${esc(state.seo_description)}</textarea></label>
                    <p class="be-hint">Left empty, they're made from the title and the intro, and translated with the post.</p>
                </section>`
            if (focus) { const el = $('#' + focus); if (el) { el.focus(); const end = el.value.length; el.setSelectionRange?.(end, end) } }
        }
        seo_pane.addEventListener('input', (e) => {
            if (e.target.id == 'be-seo-title') state.seo_title = e.target.value
            if (e.target.id == 'be-seo-desc') state.seo_description = e.target.value
            changed()
        })

        root.querySelector('.be-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('[data-tab]')?.dataset.tab
            if (!tab) return
            state.tab = tab
            root.querySelectorAll('.be-tabs [data-tab]').forEach((btn) => { btn.classList.toggle('on', btn.dataset.tab == tab); btn.setAttribute('aria-selected', btn.dataset.tab == tab) })
            root.querySelectorAll('.be-pane').forEach((pane) => { pane.hidden = pane.dataset.pane != tab })
            if (tab == 'seo') draw_seo_pane()
        })

        /* ---------- Markdown view ---------- */

        const source = $('#be-source')
        root.querySelector('.be-switch').addEventListener('click', (e) => {
            const mode = e.target.closest('[data-mode]')?.dataset.mode
            if (!mode || mode == state.mode) return
            if (mode == 'markdown') {
                source.value = F.serialize(state.blocks)
            } else {
                state.blocks = F.parse(source.value).map(with_id)
                if (!state.blocks.length) state.blocks.push(with_id({ type: 'paragraph', text: '' }))
            }
            state.mode = mode
            root.querySelectorAll('.be-switch button').forEach((btn) => btn.classList.toggle('on', btn.dataset.mode == mode))
            source.hidden = mode != 'markdown'
            blocks_box.hidden = mode == 'markdown'
            $('#be-add-end').hidden = mode == 'markdown'
            if (mode == 'markdown') { autosize(source); source.focus() } else render_blocks()
        })
        source.addEventListener('input', () => { autosize(source); changed() })

        /* ---------- saving ---------- */

        let busy = false
        const draw_bar = () => {
            const is_dirty = dirty()
            const live = state.published
            $('#be-state').innerHTML = `<span class="be-status ${live ? 'live' : 'draft'}">${live ? 'Published' : 'Draft'}</span>${is_dirty ? '<span class="be-unsaved">Unsaved changes</span>' : (post ? '<span class="muted">Saved</span>' : '')}`
            const draft_btn = $('#be-draft'), publish_btn = $('#be-publish')
            if (live) {
                draft_btn.hidden = true
                publish_btn.textContent = 'Update'
                publish_btn.classList.toggle('filled', is_dirty)
                publish_btn.disabled = busy || !is_dirty
            } else {
                draft_btn.hidden = false
                draft_btn.textContent = 'Save draft'
                draft_btn.disabled = busy || !is_dirty
                publish_btn.textContent = 'Publish'
                publish_btn.classList.add('filled')
                publish_btn.disabled = busy
            }
        }

        let backup_timer = null
        const forget = () => { try { localStorage.removeItem(key) } catch (e) {} }
        const backup = () => {
            clearTimeout(backup_timer)
            backup_timer = setTimeout(() => {
                try {
                    if (dirty()) localStorage.setItem(key, JSON.stringify({ time: Date.now(), values: { ...values(), slug_touched: state.slug_touched } }))
                    else localStorage.removeItem(key)
                } catch (e) {}
            }, 800)
        }

        let seo_timer = null
        function changed () {
            draw_bar()
            backup()
            if (state.tab == 'seo') { clearTimeout(seo_timer); seo_timer = setTimeout(draw_seo_pane, 300) }
            else { clearTimeout(seo_timer); seo_timer = setTimeout(() => { const f = seo_facts(); const c = checks_of(f); const n = c.filter(([ok]) => ok).length; $('#be-score').textContent = `${n}/${c.length}`; $('#be-score').className = 'be-score ' + (n >= c.length - 1 ? 'ok' : n >= c.length - 3 ? 'mid' : 'low') }, 400) }
        }

        const save = async (publish) => {
            if (busy) return
            const body = values(publish)
            if (!body.title) { iziToast.error({ title: 'Title missing', message: 'Give the post a title first.' }); title_el.focus(); return }
            if (!body.content.trim()) { iziToast.error({ title: 'Nothing written', message: 'Write the post first.' }); return }
            if (publish && !state.published) {
                const f = seo_facts()
                const missing_alt = f.images.filter((image) => !(image.alt || '').trim()).length
                if (missing_alt && !confirm(`${missing_alt} picture(s) have no alt text. Publish anyway?`)) return
            }
            busy = true
            draw_bar()
            const res = await kit().api(post ? `/api/admin/blog/${post._id}` : '/api/admin/blog', body)
            busy = false
            if (!kit().toast(res, publish ? (state.published ? 'Post updated.' : 'Post published.') : (state.published ? 'Turned back into a draft.' : 'Draft saved.'))) { draw_bar(); return }
            forget()
            const fresh = res.post
            const was_new = !post
            post = fresh
            translation_info = res.translation || translation_info
            state.published = Boolean(fresh.published)
            state.slug = fresh.slug
            state.slug_touched = true
            saved = snapshot()
            if (was_new) history.replaceState(null, '', `#blog/edit/${fresh._id}`)
            draw_post_pane()
            draw_bar()
        }
        $('#be-draft').addEventListener('click', () => save(false))
        $('#be-publish').addEventListener('click', () => save(true))

        /* ---------- preview ---------- */

        $('#be-preview').addEventListener('click', async () => {
            const res = await kit().api('/api/admin/blog/preview', { content: content(), title: state.title })
            if (res.status != 'ok') return kit().toast(res)
            const dialog = document.createElement('div')
            dialog.className = 'be-dialog be-preview-dialog'
            const day = new Date(post?.created || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
            const toc = state.layout == 'guide' && res.toc.length > 1
                ? `<nav class="bp-toc"><details open><summary>Contents</summary><ol>${res.toc.map((h) => `<li class="lv-${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ol></details></nav>` : ''
            dialog.innerHTML = `<div class="be-dialog-card be-preview-card" role="dialog" aria-modal="true" aria-label="Preview">
                    <div class="be-dialog-head"><strong>Preview · ${esc(LAYOUTS.find(([v]) => v == state.layout)[1])} layout</strong><button type="button" class="be-x" aria-label="Close">×</button></div>
                    <div class="blog blog-post layout-${esc(state.layout)} be-preview-page">
                        <article>
                            <header class="bp-head">
                                ${state.cover && state.layout == 'feature' ? `<img class="cover bp-hero" src="${esc(state.cover)}" alt="">` : ''}
                                <h1>${esc(state.title || 'Post title')}</h1>
                                ${state.layout == 'feature' && state.excerpt ? `<p class="bp-dek">${esc(state.excerpt)}</p>` : ''}
                                <div class="date"><span>${esc(day)}</span><span>·</span><span>${res.minutes} min read</span></div>
                                ${state.cover && state.layout != 'feature' ? `<img class="cover" src="${esc(state.cover)}" alt="">` : ''}
                            </header>
                            ${toc ? `<div class="bp-body">${toc}<div class="post-content">${res.html}</div></div>` : `<div class="post-content">${res.html}</div>`}
                        </article>
                    </div>
                </div>`
            document.body.appendChild(dialog)
            const close = () => { dialog.remove(); document.removeEventListener('keydown', on_key) }
            const on_key = (e) => { if (e.key == 'Escape') close() }
            document.addEventListener('keydown', on_key)
            dialog.addEventListener('click', (e) => {
                if (e.target == dialog || e.target.closest('.be-x')) return close()
                const a = e.target.closest('a')
                if (!a) return
                const hash = a.getAttribute('href') || ''
                e.preventDefault()
                if (hash.startsWith('#')) dialog.querySelector(`[id="${CSS.escape(decodeURIComponent(hash.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth' })
                if (a.dataset.youtube) window.open(a.href, '_blank', 'noopener')
            })
        })

        /* ---------- page-wide keys, leaving ---------- */

        const on_key = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 's') { e.preventDefault(); save(state.published) }
        }
        const on_leave = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = '' } }
        document.addEventListener('keydown', on_key)
        document.addEventListener('selectionchange', place_format_bar)
        window.addEventListener('beforeunload', on_leave)
        window.addEventListener('scroll', place_format_bar, { passive: true })

        // first draw
        draw_cover()
        render_blocks()
        draw_post_pane()
        autosize(title_el)
        autosize(excerpt_el)
        changed()
        if (!post) title_el.focus()

        // unsaved changes from an earlier visit (kept in this browser)
        try {
            const kept = JSON.parse(localStorage.getItem(key) || 'null')
            if (kept?.values && kept.values.content != values().content || kept?.values && kept.values.title != state.title) {
                const note = document.createElement('div')
                note.className = 'be-restore'
                note.innerHTML = `<span>You have unsaved changes from ${esc(new Date(kept.time).toLocaleString())}.</span><button type="button" data-restore="yes">Restore them</button><button type="button" data-restore="no" class="be-quiet">Discard</button>`
                root.querySelector('.be-grid').before(note)
                note.addEventListener('click', (e) => {
                    const choice = e.target.closest('[data-restore]')?.dataset.restore
                    if (!choice) return
                    note.remove()
                    if (choice == 'no') return forget()
                    const v = kept.values
                    Object.assign(state, { title: v.title || '', excerpt: v.excerpt || '', slug: v.slug || '', slug_touched: Boolean(v.slug_touched), cover: v.cover || '', lang: v.lang || 'en', layout: v.layout || 'standard', seo_title: v.seo_title || '', seo_description: v.seo_description || '' })
                    state.blocks = F.parse(v.content || '').map(with_id)
                    if (!state.blocks.length) state.blocks.push(with_id({ type: 'paragraph', text: '' }))
                    title_el.value = state.title
                    excerpt_el.value = state.excerpt
                    autosize(title_el)
                    autosize(excerpt_el)
                    draw_cover()
                    render_blocks()
                    draw_post_pane()
                    changed()
                })
            }
        } catch (e) {}

        // the admin router calls this when another section opens
        return () => {
            document.removeEventListener('keydown', on_key)
            document.removeEventListener('selectionchange', place_format_bar)
            document.removeEventListener('mousedown', outside)
            window.removeEventListener('beforeunload', on_leave)
            window.removeEventListener('scroll', place_format_bar)
            palette.remove()
            format_bar.remove()
        }
    }

    // js/admin.js routes #blog, #blog/new and #blog/edit/<id> here
    window.admin_blog = list
})()
