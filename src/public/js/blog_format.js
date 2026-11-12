/* The blog post format, shared by the server (service/blog_render.js) and the admin editor (js/admin_blog.js).

   A post is stored as Markdown, so the AI translation (service/translate.js), the excerpts and the Markdown copy of
   each page keep working. Layout blocks are lines that start with ":::"; the editor writes them, nobody has to type
   them. Blocks are separated by an empty line.

     # Heading                              h2 (the post title is the h1)      ## Heading   h3
     Text with **bold**, *italic*, `code`, [a link](/trade) and \* a literal star
     - item / 1. item                       lists
     > quote
     ---                                    divider
     ![alt text](/uploads/blog/x.webp)      a picture, as wide as the text

     ::: figure wide                        a picture with a size (normal, small, wide, full) and a caption
     ![alt text](/uploads/blog/x.webp)
     The caption
     :::

     ::: gallery                            2 to 6 pictures side by side, optional caption
     ![alt](...)
     ![alt](...)
     :::

     ::: split left                         a picture beside text (the picture on the left or right)
     ![alt](...)

     Text, more paragraphs, lists
     :::

     ::: tip | ::: note | ::: warning       a highlighted box (text, lists)
     Text
     :::

     ::: item Strange Team Captain          a TF2 item card with live prices, linking to the item page
     ::: button [Start trading](/trade)     a button
     ::: youtube dQw4w9WgXcQ                a YouTube video (loads only when it's played)

   Containers can't hold other containers. Anything this file doesn't understand stays text, so a post never breaks.
   This file is a plain script that works in the browser (window.BlogFormat) and in Node (globalThis.BlogFormat). */
(function (root) {
    'use strict'

    const CONTAINERS = ['figure', 'gallery', 'split', 'tip', 'note', 'warning']
    const SINGLE = ['item', 'button', 'youtube']
    const SIZES = ['normal', 'small', 'wide', 'full']
    const TONES = ['tip', 'note', 'warning']

    const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
    const OPEN = /^:::[ \t]*([a-z][a-z0-9-]*)[ \t]*(.*?)[ \t]*$/
    const CLOSE = /^:::[ \t]*$/
    const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

    /* ---------- inline text ---------- */

    const escape_html = (text) => String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

    // a link or picture address: the site's own paths and http(s) only
    const safe_url = (url) => /^(https?:\/\/|\/(?!\/))[^\s"'<>]*$/i.test(String(url || '')) ? String(url) : '#'

    // the site's own pages open in the same tab and pass search engines along; other sites open in a new tab
    const SITE = /^https?:\/\/(www\.)?tf2deal\.com(\/|$)/i
    const is_own = (url) => String(url).startsWith('/') || SITE.test(url)

    // characters a backslash keeps literal: \* stays a star instead of starting italic text
    const ESCAPABLE = /\\([\\`*_[\]()!#>~.:-])/g

    // inline Markdown -> safe HTML: everything is escaped first, so a post can't add HTML of its own
    const inline = (text, fallback_alt) => {
        const kept = []
        let out = String(text == null ? '' : text).replace(ESCAPABLE, (m, c) => `\u0000${kept.push(c) - 1}\u0000`)
        out = escape_html(out)
            .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => `<img src="${safe_url(url)}" alt="${alt.trim() || escape_html(fallback_alt || '')}" loading="lazy">`)
            .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => is_own(url)
                ? `<a href="${safe_url(url)}">${label}</a>`
                : `<a href="${safe_url(url)}" target="_blank" rel="noopener">${label}</a>`)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        return out.replace(/\u0000(\d+)\u0000/g, (m, i) => escape_html(kept[Number(i)]))
    }

    // inline Markdown -> plain text (word counts, descriptions)
    const plain_inline = (text) => String(text == null ? '' : text)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(ESCAPABLE, '$1')
        .replace(/[*`]/g, '')

    // a heading's anchor: letters of any language, digits and dashes ("How to trade?" -> "how-to-trade")
    const anchor = (text) => plain_inline(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'

    /* ---------- blocks ---------- */

    const image_of = (line) => {
        const m = String(line).match(IMAGE_LINE)
        return m ? { src: m[2], alt: m[1].trim() } : null
    }

    // one paragraph-like chunk of lines (no empty lines inside) -> blocks
    const chunk_blocks = (lines) => {
        const blocks = []
        let rest = lines.slice()
        // a heading line starts its own block, the lines after it are a paragraph
        while (rest.length) {
            const heading = rest[0].match(/^(#{1,3})\s+(.*)$/)
            if (heading) {
                blocks.push({ type: 'heading', level: Math.min(3, heading[1].length + 1), text: heading[2].trim() })
                rest = rest.slice(1)
                continue
            }
            break
        }
        if (!rest.length) return blocks
        if (rest.length == 1 && /^(-{3,}|\*{3,})$/.test(rest[0].trim())) {
            blocks.push({ type: 'divider' })
        } else if (rest.length == 1 && image_of(rest[0])) {
            blocks.push({ type: 'image', ...image_of(rest[0]), size: 'normal', caption: '' })
        } else if (rest.every((line) => /^\s*[-*]\s+/.test(line))) {
            blocks.push({ type: 'list', ordered: false, items: rest.map((line) => line.replace(/^\s*[-*]\s+/, '')) })
        } else if (rest.every((line) => /^\s*\d{1,3}[.)]\s+/.test(line))) {
            blocks.push({ type: 'list', ordered: true, items: rest.map((line) => line.replace(/^\s*\d{1,3}[.)]\s+/, '')) })
        } else if (rest.every((line) => /^>\s?/.test(line))) {
            blocks.push({ type: 'quote', text: rest.map((line) => line.replace(/^>\s?/, '')).join('\n') })
        } else {
            blocks.push({ type: 'paragraph', text: rest.join('\n') })
        }
        return blocks
    }

    // plain Markdown (no containers) -> blocks
    const simple_blocks = (lines) => {
        const blocks = []
        let chunk = []
        const flush = () => { if (chunk.length) blocks.push(...chunk_blocks(chunk)); chunk = [] }
        for (const line of lines) {
            if (line.trim() === '') flush()
            else chunk.push(line.replace(/\s+$/, ''))
        }
        flush()
        return blocks
    }

    const container_block = (name, args, inner) => {
        const filled = inner.filter((line) => line.trim() !== '')
        if (name == 'figure') {
            const at = filled.findIndex((line) => image_of(line))
            if (at < 0) return null
            const size = SIZES.includes(args) ? args : 'normal'
            return { type: 'image', ...image_of(filled[at]), size, caption: filled.filter((l, i) => i != at).join(' ').trim() }
        }
        if (name == 'gallery') {
            const images = filled.map(image_of).filter(Boolean)
            if (!images.length) return null
            return { type: 'gallery', images, caption: filled.filter((line) => !image_of(line)).join(' ').trim() }
        }
        if (name == 'split') {
            const at = inner.findIndex((line) => image_of(line))
            if (at < 0) return null
            const text = inner.filter((l, i) => i != at).join('\n').replace(/^\n+|\n+$/g, '')
            return { type: 'split', side: args == 'right' ? 'right' : 'left', ...image_of(inner[at]), text }
        }
        if (TONES.includes(name)) {
            return { type: 'callout', tone: name, text: inner.join('\n').replace(/^\n+|\n+$/g, '') }
        }
        return null
    }

    const single_block = (name, args) => {
        if (name == 'item') return args ? { type: 'item', sku: args } : null
        if (name == 'youtube') return YOUTUBE_ID.test(args) ? { type: 'youtube', video: args } : null
        if (name == 'button') {
            const m = args.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
            return m ? { type: 'button', label: m[1], url: m[2] } : null
        }
        return null
    }

    // the whole post -> [{ type, ... }]
    const parse = (md) => {
        const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n')
        const blocks = []
        let plain = []
        const flush = () => { if (plain.length) blocks.push(...simple_blocks(plain)); plain = [] }
        for (let i = 0; i < lines.length; i++) {
            const open = lines[i].match(OPEN)
            if (open && SINGLE.includes(open[1])) {
                const block = single_block(open[1], open[2])
                if (block) { flush(); blocks.push(block); continue }
            }
            if (open && CONTAINERS.includes(open[1])) {
                const end = lines.findIndex((line, j) => j > i && CLOSE.test(line))
                const block = end > i ? container_block(open[1], open[2], lines.slice(i + 1, end)) : null
                if (block) { flush(); blocks.push(block); i = end; continue }
            }
            plain.push(lines[i])
        }
        flush()
        return blocks
    }

    const one_line = (text) => String(text == null ? '' : text).replace(/\s*\n\s*/g, ' ').trim()
    const image_md = (image) => `![${one_line(image.alt).replace(/[[\]]/g, '')}](${String(image.src || '').replace(/[\s)]/g, encodeURIComponent)})`

    // blocks -> Markdown (what the editor saves)
    const serialize = (blocks) => (blocks || []).map((b) => {
        switch (b.type) {
            case 'heading': return `${'#'.repeat(Math.max(1, (b.level || 2) - 1))} ${one_line(b.text)}`
            case 'list': return (b.items || []).filter((item) => one_line(item)).map((item, i) => `${b.ordered ? `${i + 1}.` : '-'} ${one_line(item)}`).join('\n')
            case 'quote': return String(b.text || '').split('\n').filter((line) => line.trim()).map((line) => `> ${line}`).join('\n')
            case 'divider': return '---'
            case 'image': {
                if (!b.src) return ''
                const size = SIZES.includes(b.size) ? b.size : 'normal'
                if (size == 'normal' && !one_line(b.caption)) return image_md(b)
                return `::: figure ${size}\n${image_md(b)}${one_line(b.caption) ? '\n' + one_line(b.caption) : ''}\n:::`
            }
            case 'gallery': {
                const images = (b.images || []).filter((image) => image.src)
                if (!images.length) return ''
                return `::: gallery\n${images.map(image_md).join('\n')}${one_line(b.caption) ? '\n' + one_line(b.caption) : ''}\n:::`
            }
            case 'split': return b.src ? `::: split ${b.side == 'right' ? 'right' : 'left'}\n${image_md(b)}\n\n${String(b.text || '').trim()}\n:::` : String(b.text || '').trim()
            case 'callout': return String(b.text || '').trim() ? `::: ${TONES.includes(b.tone) ? b.tone : 'note'}\n${String(b.text).trim()}\n:::` : ''
            case 'item': return one_line(b.sku) ? `::: item ${one_line(b.sku)}` : ''
            case 'button': return (one_line(b.label) && b.url) ? `::: button [${one_line(b.label).replace(/[[\]]/g, '')}](${String(b.url).replace(/[\s)]/g, encodeURIComponent)})` : ''
            case 'youtube': return YOUTUBE_ID.test(b.video || '') ? `::: youtube ${b.video}` : ''
            default: return String(b.text || '').trim()
        }
    }).filter((text) => text !== '').join('\n\n')

    // the text a reader reads, without formatting (word count, description)
    const plain_text = (md) => parse(md).map((b) => {
        if (['paragraph', 'heading', 'quote'].includes(b.type)) return plain_inline(b.text)
        if (b.type == 'list') return b.items.map(plain_inline).join(' ')
        if (b.type == 'callout' || b.type == 'split') return plain_text(b.text)
        if (b.type == 'image' || b.type == 'gallery') return plain_inline(b.caption)
        if (b.type == 'button') return plain_inline(b.label)
        return ''
    }).filter(Boolean).join('\n')

    // "https://youtu.be/ID", "https://www.youtube.com/watch?v=ID", ".../shorts/ID" or the id itself -> the id, or ''
    const youtube_id = (text) => {
        const value = String(text || '').trim()
        if (YOUTUBE_ID.test(value)) return value
        const m = value.match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/)
        return m ? m[1] : ''
    }

    // the lines the AI translation must leave alone: the ":::" head of a block (and an item block whole, its name is an
    // item name); the visible text after a button head ("[Start trading](/trade)") is translated like any link
    const fixed_parts = (line) => {
        const m = String(line).match(/^(:::[ \t]*[a-z][a-z0-9-]*)([ \t]*.*)$/)
        if (!m) return CLOSE.test(line) ? [line, ''] : null
        const name = m[1].replace(/^:::[ \t]*/, '')
        if (name == 'button') return [m[1], m[2]]
        return [line, '']
    }

    root.BlogFormat = { parse, serialize, inline, plain_inline, plain_text, anchor, escape_html, safe_url, is_own, youtube_id, fixed_parts, image_of, SIZES, TONES }
})(typeof window !== 'undefined' ? window : globalThis)
