// Blog posts as HTML: the post format is public/js/blog_format.js (shared with the admin editor); this file turns its
// blocks into the page's HTML and collects what the page's SEO needs (headings for the contents, pictures, words).
//
//   const post = await render(markdown, { title, __, lurl })
//   post.html      the post body (every text escaped; a post can't add HTML of its own)
//   post.toc       [{ id, text, level }] the h2 / h3 headings, with their anchors
//   post.images    picture addresses in the order they appear (the share picture when there's no cover)
//   post.words     words a reader reads; post.minutes = reading time (220 words a minute, at least 1)
//   post.text      the plain text (meta description when there's no excerpt)
//
// Item cards (::: item <name>) show the item's live prices from the database and link to its page; an item that isn't
// found becomes a search link, so a post never shows a broken card.

import '../public/js/blog_format.js'
import { item_model } from '../model/Item.js'
import * as fn from '../fn.js'

const F = globalThis.BlogFormat
const esc = F.escape_html
const WORDS_PER_MINUTE = 220

// Steam pictures: the share/structured-data copy needs https (fn.https_url)
const src_of = (url) => esc(fn.https_url(F.safe_url(url)))

const QUALITY_VAR = { 1: 'genuine', 3: 'vintage', 5: 'unusual', 6: 'unique', 11: 'strange', 13: 'haunted', 14: 'collectors', 15: 'decorated', 9: 'self-made', 7: 'community' }

const ICONS = {
  tip: '<path d="M9 21h6v-1.5H9zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/>',
  note: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>',
  warning: '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>'
}

// the items named in ::: item blocks, read in one query
const item_data = async (skus) => {
  const map = new Map()
  if (!skus.length || process.db_status?.connected !== true) return map
  try {
    const docs = await item_model.find({ bp_sku: { $in: skus } },
      { bp_sku: 1, name: 1, image: 1, qualityID: 1, effectID: 1, buy: 1, sell: 1, status: 1, 'bptf_data.update_key_price': 1, 'stock.cur': 1 })
      .maxTimeMS(3000).lean()
    for (const doc of docs) map.set(doc.bp_sku, doc)
  } catch (error) {
    console.log('Blog: item cards not read:', error?.message || error)
  }
  return map
}

const figure_img = (image, title, extra = '') => `<img src="${src_of(image.src)}" alt="${esc(image.alt || title || '')}" loading="lazy" decoding="async"${extra}>`

const item_card = (sku, doc, __, lurl) => {
  const href = esc(lurl('/items/' + encodeURIComponent(sku)))
  if (!doc) return `<p><a class="pb-item pb-item-missing" href="${esc(lurl('/items?name=' + encodeURIComponent(sku)))}">${esc(sku)}</a></p>`
  const key = Number(doc.bptf_data?.update_key_price) || 0
  const buy = doc.sell > 0 ? fn.price_text(doc.sell, key) : ''  // the reader buys at our sell price
  const sell = doc.buy > 0 && doc.status == 1 ? fn.price_text(doc.buy, key) : ''
  const quality = QUALITY_VAR[Number(doc.qualityID)] || 'unique'
  const effect = Number(doc.effectID) > 0 ? ` style="background-image: url(https://api.backpack.tf/images/440/particles/${Number(doc.effectID)}_94x94.png)"` : ''
  return `<a class="pb-item" href="${href}" style="--pb-q: var(--q-${quality})">` +
    `<span class="pb-item-pic"${effect}>${doc.image ? `<img src="${src_of(doc.image)}" alt="${esc(doc.bp_sku)}" loading="lazy" decoding="async">` : ''}</span>` +
    `<span class="pb-item-body"><strong translate="no">${esc(doc.bp_sku)}</strong>` +
    `<span class="pb-item-prices">${[buy && `<span>${esc(__('blog.item_buy', { price: buy }))}</span>`, sell && `<span>${esc(__('blog.item_sell', { price: sell }))}</span>`].filter(Boolean).join('')}</span></span>` +
    `<span class="pb-item-go">${esc(__('blog.item_view'))} &rarr;</span></a>`
}

export const render = async (md, { title = '', __ = (key) => key, lurl = (p) => p } = {}) => {
  const blocks = F.parse(md)
  const items = await item_data([...new Set(blocks.filter((b) => b.type == 'item').map((b) => b.sku))])
  const toc = []
  const images = []
  const used = new Set()
  const heading_id = (text) => {
    const base = F.anchor(text)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
  const inline = (text) => F.inline(text, title)
  // text inside a box or beside a picture: paragraphs, lists and headings
  const inner = (md) => F.parse(md).map((b) => one(b, true)).join('')

  const one = (b, nested = false) => {
    switch (b.type) {
      case 'heading': {
        if (nested) return `<p><strong>${inline(b.text)}</strong></p>`
        const id = heading_id(b.text)
        toc.push({ id, text: F.plain_inline(b.text), level: b.level })
        return `<h${b.level} id="${esc(id)}">${inline(b.text)}</h${b.level}>`
      }
      case 'paragraph': return `<p>${b.text.split('\n').map(inline).join('<br>')}</p>`
      case 'list': return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
      case 'quote': return `<blockquote>${b.text.split('\n').map(inline).join('<br>')}</blockquote>`
      case 'divider': return '<hr>'
      case 'image':
        images.push(b.src)
        return `<figure class="pb-figure size-${esc(b.size)}">${figure_img(b, title)}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`
      case 'gallery':
        images.push(...b.images.map((image) => image.src))
        return `<figure class="pb-gallery n-${Math.min(b.images.length, 4)}"><div class="pb-gallery-grid">${b.images.map((image) => figure_img(image, title)).join('')}</div>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`
      case 'split':
        images.push(b.src)
        return `<div class="pb-split img-${b.side}"><figure>${figure_img(b, title)}</figure><div class="pb-split-text">${inner(b.text)}</div></div>`
      case 'callout':
        return `<aside class="pb-callout tone-${esc(b.tone)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[b.tone] || ICONS.note}</svg><div>${inner(b.text)}</div></aside>`
      case 'item': return item_card(b.sku, items.get(b.sku), __, lurl)
      case 'button': {
        const own = F.is_own(b.url)
        return `<p class="pb-button-row"><a class="pb-button" href="${esc(F.safe_url(b.url))}"${own ? '' : ' target="_blank" rel="noopener"'}>${inline(b.label)}</a></p>`
      }
      case 'youtube':
        // a picture until it's played (js in view/blog_page.ejs swaps in the player): no YouTube code on page load
        return `<figure class="pb-video"><a href="https://www.youtube.com/watch?v=${esc(b.video)}" data-youtube="${esc(b.video)}" target="_blank" rel="noopener" aria-label="${esc(__('blog.video_play'))}">` +
          `<img src="https://i.ytimg.com/vi/${esc(b.video)}/hqdefault.jpg" alt="${esc(__('blog.video_play'))}" loading="lazy" decoding="async"><span class="pb-play" aria-hidden="true"></span></a></figure>`
      default: return ''
    }
  }

  const html = blocks.map((b) => one(b)).join('\n')
  const text = F.plain_text(md)
  const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length
  return { html, toc, images, text, words, minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)) }
}

// the meta description: the excerpt, or the start of the post's text (at most `length` characters, cut at a word)
export const description = (excerpt, md, length = 155) => {
  const text = String(excerpt || '').trim() || F.plain_text(md).replace(/\s+/g, ' ').trim()
  return text.length > length ? text.slice(0, length - 1).replace(/\s+\S*$/, '') + '…' : text
}
