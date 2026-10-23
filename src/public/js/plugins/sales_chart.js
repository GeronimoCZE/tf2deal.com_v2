import { round_ref } from './trade.js'

// Item page "Sales": how many copies the bots sold each day (bars) and the most common price that day (line).
// The data is the item's trade_history (each killstreak tier has its own), one entry per day, written after each UTC
// day: item_manager writes [{ date, volume, sell, key_price }], bot_manager [{ date, volume, sell_mode }] (no key
// price: the item's current one is used). Drawn as plain SVG, sized to the box, and redrawn when the box changes size.

const DAY = 24 * 60 * 60 * 1000
const NS = 'http://www.w3.org/2000/svg'
const reduce_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = (t) => 1 - Math.pow(1 - t, 3)
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const day_of = (ms) => new Date(ms).toISOString().slice(0, 10)

const svg = (name, attrs = {}) => {
    const el = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) { el.setAttribute(k, v) }
    return el
}

// 75.33 ref with a key at 60.11 -> "1 key 15.22 ref"
const price_text = (ref, key) => {
    const keys = (key > 0 && ref >= key) ? Math.floor(ref / key) : 0
    const metal = round_ref(ref - keys * key)
    if (!keys) { return `${metal} ref` }
    return `${keys} ${keys == 1 ? 'key' : 'keys'}${metal > 0 ? ` ${metal} ref` : ''}`
}

// axis labels stay short: keys with one decimal once prices pass a key, otherwise ref like TF2 prices (1.33)
const axis_text = (ref, key, in_keys) => in_keys ? `${(ref / key).toFixed(ref / key >= 10 ? 0 : 1)} keys` : `${round_ref(ref)}`

const histories = (item) => {
    const list = { 0: Array.isArray(item?.trade_history) ? item.trade_history : [] }
    const tiers = Array.isArray(item?.killstreak) ? item.killstreak : (item?.killstreak?.killstreaks || [])
    for (const entry of tiers) {
        const tier = Number(entry?.kt ?? entry?.ks_tier ?? entry?.tier) || 0
        if (tier >= 1 && tier <= 3) { list[tier] = Array.isArray(entry?.trade_history) ? entry.trade_history : [] }
    }
    return list
}

const init_sales_chart = (box, item) => {
    const data = histories(item)
    const item_key = num(item?.bptf_data?.update_key_price)
    const plot = box.querySelector('.sales-plot')
    const total_el = box.querySelector('.sales-total')
    const tip = box.querySelector('.sales-tip')
    const range_btns = [...box.querySelectorAll('[data-range]')]
    const date_fmt = new Intl.DateTimeFormat(window.TD_LANG || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const long_fmt = new Intl.DateTimeFormat(window.TD_LANG || 'en', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

    let tier = 0
    let range = Number(range_btns.find((b) => b.getAttribute('aria-pressed') == 'true')?.dataset.range) || 90
    let shown = null   // { days, volumes } on screen, to animate from
    let seen = false   // drawn only once the box scrolls into view
    let frame = 0
    let hide_tip = () => {}

    // one entry per day of the range, ending yesterday (today is not finished yet)
    const series = () => {
        const by_date = new Map((data[tier] || []).map((e) => [e?.date, e]))
        const today = Date.parse(day_of(Date.now()))
        const days = []
        for (let i = range; i >= 1; i--) {
            const date = day_of(today - i * DAY)
            const e = by_date.get(date)
            // a day whose copies had no recorded price has none (no point on the line), never 0 ref
            const price = num(e?.sell ?? e?.sell_mode ?? e?.price)
            days.push({ date, volume: num(e?.volume), price: price > 0 ? price : null, key: num(e?.key_price ?? e?.key) || item_key })
        }
        return days
    }

    const draw = (animate) => {
        cancelAnimationFrame(frame)
        const days = series()
        const sales = days.filter((d) => d.volume > 0)
        const total = sales.reduce((s, d) => s + d.volume, 0)
        total_el.textContent = total ? __('item.sales_total', { count: total }) : ''

        const width = Math.max(plot.clientWidth, 260)
        const height = width < 520 ? 200 : 240
        const pad = { top: 14, right: 10, bottom: 26, left: 46 }
        const w = width - pad.left - pad.right
        const h = height - pad.top - pad.bottom
        const step = w / days.length
        const x = (i) => pad.left + step * (i + 0.5)

        tip.hidden = true
        if (!sales.length) {
            const empty = document.createElement('p')
            empty.className = 'sales-empty'
            empty.textContent = __('item.sales_none')
            plot.replaceChildren(empty)
            shown = { days, volumes: days.map(() => 0) }
            return
        }
        const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${__('item.sales_title')}: ${__('item.sales_total', { count: total })}` })
        plot.replaceChildren(root)

        // the price line uses the top 64% of the plot, the volume bars the bottom 28%, so they never cross
        const price_h = h * 0.64
        const bars_h = h * 0.28

        // price axis: a little room above and below, three lines
        const prices = sales.map((d) => d.price).filter((p) => p !== null)
        const key = sales[sales.length - 1].key
        let lo = prices.length ? Math.min(...prices) : 0, hi = prices.length ? Math.max(...prices) : 0
        const span = (hi - lo) || Math.max(hi * 0.1, 1)
        lo = Math.max(lo - span * 0.25, 0); hi = hi + span * 0.25
        const y = (p) => pad.top + price_h - ((p - lo) / (hi - lo)) * price_h
        const in_keys = key > 0 && hi >= key
        const grid = svg('g', { class: 'sales-grid' })
        for (let i = 0; i <= 2 && prices.length; i++) {
            const value = lo + (hi - lo) * (i / 2)
            const gy = y(value)
            grid.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy }))
            const label = svg('text', { x: pad.left - 8, y: gy + 4, 'text-anchor': 'end' })
            label.textContent = axis_text(value, key, in_keys)
            grid.append(label)
        }
        // dates: first, middle and last day
        for (const i of [0, Math.floor((days.length - 1) / 2), days.length - 1]) {
            const label = svg('text', { x: Math.min(Math.max(x(i), pad.left + 18), width - pad.right - 18), y: height - 8, 'text-anchor': 'middle' })
            label.textContent = date_fmt.format(new Date(days[i].date))
            grid.append(label)
        }
        root.append(grid)

        const max_volume = Math.max(...days.map((d) => d.volume), 1)
        const bar_w = Math.max(Math.min(step * 0.6, 14), 1.5)
        const bars = svg('g', { class: 'sales-bars' })
        const rects = days.map((d, i) => {
            const rect = svg('rect', { x: x(i) - bar_w / 2, width: bar_w, rx: Math.min(bar_w / 2, 3), y: pad.top + h, height: 0 })
            bars.append(rect)
            return rect
        })
        root.append(bars)
        const set_bars = (volumes) => volumes.forEach((v, i) => {
            const bh = (v / max_volume) * bars_h
            rects[i].setAttribute('y', pad.top + h - bh)
            rects[i].setAttribute('height', bh)
        })

        // price line through the days with sales
        const points = days.map((d, i) => d.volume > 0 && d.price !== null ? [x(i), y(d.price)] : null).filter(Boolean)
        const line = svg('path', { class: 'sales-line', d: points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') })
        root.append(line)
        const dots = svg('g', { class: 'sales-dots' })
        points.forEach((p) => dots.append(svg('circle', { cx: p[0], cy: p[1], r: step < 5 ? 2 : 3 })))
        root.append(dots)

        // hover / tap: the nearest day with sales
        const guide = svg('line', { class: 'sales-guide', y1: pad.top, y2: pad.top + h, x1: 0, x2: 0, visibility: 'hidden' })
        root.append(guide)
        const hit = svg('rect', { x: pad.left, y: 0, width: w, height, fill: 'transparent' })
        root.append(hit)
        const show_tip = (event) => {
            const box_rect = root.getBoundingClientRect()
            const mx = event.clientX - box_rect.left
            let best = null
            days.forEach((d, i) => { if (d.volume > 0 && (best === null || Math.abs(x(i) - mx) < Math.abs(x(best) - mx))) { best = i } })
            if (best === null) { return }
            const d = days[best]
            guide.setAttribute('x1', x(best)); guide.setAttribute('x2', x(best)); guide.setAttribute('visibility', 'visible')
            rects.forEach((rect, i) => rect.classList.toggle('on', i == best))
            tip.innerHTML = ''
            const date = document.createElement('strong'); date.textContent = long_fmt.format(new Date(d.date))
            const sold = document.createElement('span'); sold.textContent = __('item.sales_sold', { count: d.volume })
            tip.append(date, sold)
            if (d.price !== null) {
                const price = document.createElement('span'); price.textContent = `${__('item.sales_price')}: ${price_text(d.price, d.key)}`
                tip.append(price)
            }
            tip.hidden = false
            const left = Math.min(Math.max(x(best) - tip.offsetWidth / 2, 0), width - tip.offsetWidth)
            tip.style.left = `${left}px`
            tip.style.top = `${Math.max((d.price !== null ? y(d.price) : pad.top + price_h) - tip.offsetHeight - 12, 0)}px`
        }
        hide_tip = () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); rects.forEach((rect) => rect.classList.remove('on')) }
        hit.addEventListener('pointermove', show_tip)
        hit.addEventListener('pointerdown', show_tip)
        // a finger leaves right after the tap, so on touch the tip stays until a tap elsewhere
        hit.addEventListener('pointerleave', (event) => { if (event.pointerType == 'mouse') { hide_tip() } })

        // bars grow from what was shown before (same days: the tier changed) or from zero; the line draws itself in
        const from = (shown && shown.days.length == days.length && shown.days[0].date == days[0].date) ? shown.volumes : days.map(() => 0)
        const to = days.map((d) => d.volume)
        shown = { days, volumes: to }
        if (!animate || reduce_motion) { set_bars(to); return }

        const length = line.getTotalLength()
        line.style.strokeDasharray = `${length}`
        line.style.strokeDashoffset = `${length}`
        dots.style.opacity = '0'
        line.getBoundingClientRect() // start the transition from the hidden line
        line.style.transition = 'stroke-dashoffset 900ms cubic-bezier(.3, .7, .2, 1)'
        line.style.strokeDashoffset = '0'
        dots.style.transition = 'opacity 300ms ease 700ms'
        dots.style.opacity = '1'

        const start = performance.now()
        const tick = (now) => {
            const t = ease(Math.min((now - start) / 550, 1))
            set_bars(to.map((v, i) => from[i] + (v - from[i]) * t))
            if (t < 1) { frame = requestAnimationFrame(tick) }
        }
        frame = requestAnimationFrame(tick)
    }

    range_btns.forEach((btn) => btn.addEventListener('click', () => {
        range = Number(btn.dataset.range) || 90
        range_btns.forEach((b) => b.setAttribute('aria-pressed', String(b == btn)))
        if (seen) { draw(true) }
    }))

    document.addEventListener('pointerdown', (event) => { if (!plot.contains(event.target)) { hide_tip() } })

    let width = 0
    new ResizeObserver(() => {
        if (!seen || plot.clientWidth == width) { return }
        width = plot.clientWidth
        draw(false)
    }).observe(plot)

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) { return }
        observer.disconnect()
        seen = true
        width = plot.clientWidth
        draw(true)
    }, { threshold: 0.25 })
    observer.observe(box)

    return {
        // the killstreak tier select on the item page
        show_tier: (next) => {
            next = Number(next) || 0
            if (next == tier) { return }
            tier = next
            if (seen) { draw(true) }
        }
    }
}

export { init_sales_chart }
