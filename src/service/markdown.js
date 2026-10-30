// Pages in Markdown for AI agents ("Markdown for Agents"): a request whose Accept header asks for text/markdown
// (and not HTML first) gets the page's <main> as Markdown instead of the HTML page. Browsers never ask for it.
// Every page also says where the Markdown version, the agent guide (/llms.txt) and the sitemap are, in a Link header.
//
//   middleware        app.use() it before the routes: wraps res.render for Markdown requests, adds the Link header
//   to_markdown(html) the converter (no library: the pages are our own, simple HTML)

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'button', 'select',
  'textarea', 'option', 'form', 'dialog', 'audio', 'video', 'object', 'head'])
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'ul', 'ol', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'blockquote', 'pre', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'hr', 'br'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', times: '×', middot: '·', rarr: '→', larr: '←' }
const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
  }
  return ENTITIES[e.toLowerCase()] ?? m
})

const attrs_of = (source) => {
  const attrs = {}
  for (const m of source.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

// elements nobody sees: hidden ones, modals and tooltips (filled by the page scripts, empty in the HTML)
const hidden = (attrs) => 'hidden' in attrs || attrs['aria-hidden'] === 'true' ||
  /display\s*:\s*none/i.test(attrs.style || '') ||
  /(^|[\s_-])(modal|tooltip)([\s_-]|$)|(^|\s)(filter-bar|filter-dropdown|dropdown|item-loader|end|none)(\s|$)/i.test(attrs.class || '')

const absolute = (href, base) => {
  if (!href || /^(javascript:|data:|#$)/i.test(href)) return ''
  try { return new URL(href, base).href } catch (e) { return '' }
}

const md_escape = (text) => text.replace(/([\\`*_[\]])/g, '\\$1')

export const to_markdown = (html, base = 'https://tf2deal.com/') => {
  // the page's own content: <main> when it has one, else the <body>
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)?.[1] ??
    html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
  const description = decode(html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || '').trim()

  let out = ''
  const stack = []       // open elements: { tag, skip, href, list, index, row, cells }
  let skip = 0           // inside this many skipped elements
  let pre = 0
  const lists = []       // { ordered, index }
  let cell = null        // text of the table cell being read
  let row = null         // cells of the table row being read
  let table_rows = 0
  let tables = 0         // inside this many tables (rows are written whole, at the end of each)
  let links = 0          // inside a link: blocks in it (an item card's name, stock, price) become " · "

  const write = (text) => {
    if (cell !== null) cell += text
    else out += text
  }
  const block = (gap = '\n\n') => {
    if (cell !== null) { cell += ' '; return }
    if (tables) return
    if (links) { if (!/(\[|· )$/.test(out)) out = out.replace(/\s+$/, '') + ' · '; return }
    out = out.replace(/[ \t]+$/, '')
    if (!out.endsWith(gap) && out.length) out += out.endsWith('\n') ? gap.slice(1) : gap
  }

  const tokens = main.replace(/<!--[\s\S]*?-->/g, '').split(/(<\/?[a-zA-Z][^>]*>)/)
  for (const token of tokens) {
    if (!token) continue
    const tag_match = token.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)\/?>$/)
    if (!tag_match) {
      if (skip) continue
      let text = decode(token)
      if (!pre) text = text.replace(/\s+/g, ' ')
      if (!pre && (/(^|\n)$|(^|\n)#+ $|\[$/.test(out)) && cell === null) text = text.replace(/^ +/, '')
      if (text) write(pre ? text : md_escape(text))
      continue
    }
    const closing = tag_match[1] === '/'
    const tag = tag_match[2].toLowerCase()

    if (!closing) {
      const attrs = attrs_of(tag_match[3])
      const skipped = skip > 0 || SKIP.has(tag) || hidden(attrs)
      if (VOID.has(tag)) {
        if (skipped) continue
        if (tag === 'br') write(pre ? '\n' : stack.some((e) => e.heading) ? ' ' : '  \n')
        else if (tag === 'hr') { block(); write('---'); block() }
        // a picture's alt text, unless it sits in a link (an item card already names the item)
        else if (tag === 'img' && attrs.alt && !stack.some((e) => e.tag === 'a')) write(md_escape(attrs.alt))
        continue
      }
      stack.push({ tag, skipped, href: '', start: 0 })
      if (skipped) { skip++; continue }
      const entry = stack[stack.length - 1]
      if (BLOCK.has(tag)) block()
      if (/^h[1-6]$/.test(tag)) { write('#'.repeat(Number(tag[1])) + ' '); entry.heading = true }
      else if (tag === 'ul' || tag === 'ol') lists.push({ ordered: tag === 'ol', index: 0 })
      else if (tag === 'li') {
        const list = lists[lists.length - 1] || { ordered: false, index: 0 }
        list.index++
        if (/(^|\n)[ \t]*(-|\d+\.) [^\n]*\n\n$/.test(out)) out = out.slice(0, -1) // no blank line between list entries
        write('  '.repeat(Math.max(lists.length - 1, 0)) + (list.ordered ? `${list.index}. ` : '- '))
      } else if (tag === 'blockquote') write('> ')
      else if (tag === 'pre') { pre++; write('```\n') }
      else if (tag === 'code' && !pre) write('`')
      else if (tag === 'strong' || tag === 'b') write('**')
      else if (tag === 'em' || tag === 'i') { if (attrs.class) entry.icon = true; else write('_') }
      else if (tag === 'a') {
        entry.href = absolute(attrs.href, base)
        // a card (an item in a list): a list entry of its own
        if (entry.href && /card/.test(attrs.class || '') && cell === null) { block('\n'); write('- ') }
        if (entry.href) { write('['); entry.start = cell !== null ? cell.length : out.length; links++ }
      } else if (tag === 'table') tables++
      else if (tag === 'tr') row = []
      else if (tag === 'td' || tag === 'th') cell = ''
      continue
    }

    // closing tag: close everything up to the matching open element (the pages' HTML isn't always well nested)
    let index = stack.length - 1
    while (index >= 0 && stack[index].tag !== tag) index--
    if (index < 0) continue
    while (stack.length > index) {
      const entry = stack.pop()
      if (entry.skipped) { skip--; continue }
      const t = entry.tag
      if (/^h[1-6]$/.test(t)) block()
      else if (t === 'ul' || t === 'ol') { lists.pop(); block() }
      else if (t === 'li') block('\n')
      else if (t === 'pre') { pre--; write('\n```'); block() }
      else if (t === 'code' && !pre) write('`')
      else if (t === 'strong' || t === 'b') write('**')
      else if ((t === 'em' || t === 'i') && !entry.icon) write('_')
      else if (t === 'a' && entry.href) {
        links--
        const text = (cell !== null ? cell : out).slice(entry.start).replace(/^(\s|· )+|(\s|· )+$/g, '')
        if (!text) { // a link without text (an icon): leave it out
          if (cell !== null) cell = cell.slice(0, entry.start - 1); else out = out.slice(0, entry.start - 1)
        } else {
          // no spaces just inside the brackets: "[ Start Trading ]" -> "[Start Trading]"
          if (cell !== null) cell = cell.slice(0, entry.start) + text; else out = out.slice(0, entry.start) + text
          write(`](${entry.href.replace(/\)/g, '%29').replace(/ /g, '%20')})`)
        }
      } else if ((t === 'td' || t === 'th') && cell !== null) {
        if (row) row.push(cell.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim())
        cell = null
      } else if (t === 'tr' && row) {
        if (row.some(Boolean)) {
          out += '| ' + row.join(' | ') + ' |\n'
          if (++table_rows === 1) out += '|' + row.map(() => ' --- |').join('') + '\n'
        }
        row = null
      } else if (t === 'table') { tables--; table_rows = 0; block() }
      else if (BLOCK.has(t)) block()
    }
  }

  const body = out
    .replace(/\*\*\s*\*\*/g, '').replace(/(^|[^\w\\])_\s*_(?!\w)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|-|\d+\.)[ \t]*$/gm, '')     // headings and list items left empty
    .replace(/[ \t]+\n/g, (m) => m.endsWith('  \n') ? '  \n' : '\n')
    .replace(/^[ \t]+$/gm, '')
    .replace(/(\S) {2,}(?=\S)/g, '$1 ')
    .replace(/^([ \t]*(?:-|\d+\.)) {2,}/gm, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const front = [`---`, `title: ${JSON.stringify(title)}`, description ? `description: ${JSON.stringify(description)}` : null, `url: ${base}`, `---`]
    .filter(Boolean).join('\n')
  return `${front}\n\n${body}\n`
}

// true when the request prefers Markdown to HTML (Accept: text/markdown); browsers ask for HTML first
export const wants_markdown = (req) => /\btext\/markdown\b/i.test(req.get('accept') || '') && req.accepts(['text/html', 'text/markdown']) === 'text/markdown'

const NOT_PAGES = /^\/(api|auth|admin|socket\.io|get_userDB_|logout|login)(\/|$)/
const LINK = '</llms.txt>; rel="describedby"; type="text/plain", </sitemap.xml>; rel="sitemap"; type="application/xml"'

export const middleware = (site_url) => (req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || NOT_PAGES.test(req.path)) return next()
  const own_url = site_url + req.originalUrl
  // the same address answers in Markdown too, so caches keep the two apart
  res.vary('Accept')
  res.append('Link', `${LINK}, <${own_url.replace(/[<>]/g, encodeURIComponent)}>; rel="alternate"; type="text/markdown"`)
  if (!wants_markdown(req)) return next()

  const render = res.render.bind(res)
  res.render = (view, options, callback) => {
    if (typeof options === 'function') { callback = options; options = undefined }
    if (callback) return render(view, options, callback)
    render(view, options, (error, html) => {
      if (error) return next(error)
      res.type('text/markdown; charset=utf-8')
      res.send(to_markdown(html, own_url))
    })
  }
  next()
}
