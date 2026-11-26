// Draws one giveaway share picture (1200 x 630 PNG) and exits: run by service/giveaway_og.js as its own process, so
// the drawing library's memory goes away with it. Reads the card as JSON on stdin (service/giveaway_og.js card()),
// writes the PNG to stdout. Exit code 3: @napi-rs/canvas is not installed.
//
// The design is the Lamplight brand kit's giveaway card (Nikolas chose Lamplight on 2026-11-19): plum night, the
// logotype top left, the amber kicker, the item's name big in Rubik, one line in Inter, a chip with the link, and the
// item on its quality glow in a tile on the right. Fonts are the site's own (public/font).

import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

let canvas
try {
    canvas = await import('@napi-rs/canvas')
} catch (error) {
    process.stderr.write('@napi-rs/canvas is not installed\n')
    process.exit(3)
}
const { createCanvas, loadImage, GlobalFonts } = canvas

const W = 1200, H = 630
const C = { night: '#140e1b', tile: '#211a2b', chip: '#2c2238', cream: '#f6efe6', sub: '#d2c7bd', amber: '#ffb547', muted: '#a99db6' }
const QUALITY = { 0: '#B2B2B2', 1: '#4D7455', 3: '#476291', 5: '#8650AC', 6: '#FFD700', 7: '#70B04A', 8: '#A50F79', 9: '#70B04A', 11: '#CF6A32', 13: '#38F3AB', 14: '#AA0000', 15: '#FAFAFA' }
const GLOW = { 6: 0.3 } // Unique is most of the shop: its glow is the faintest, as on the site

const read_stdin = () => new Promise((resolve) => {
    const parts = []
    process.stdin.on('data', (chunk) => parts.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(parts).toString()))
})

const data = JSON.parse(await read_stdin())
const root = data.site_root || process.env.TD_SITE_ROOT || process.cwd()
const pub = path.join(root, 'src', 'public')

// the site's fonts: every subset under one name, so letters missing from one come from the next
for (const subset of ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']) {
    GlobalFonts.registerFromPath(path.join(pub, 'font', `rubik-800-${subset}.woff2`), 'TD Rubik')
    GlobalFonts.registerFromPath(path.join(pub, 'font', `inter-var-${subset}.woff2`), 'TD Inter')
}
GlobalFonts.registerFromPath(path.join(pub, 'font', 'icomoon.ttf'), 'TD Icons')

// a picture from the web (https) or from the site's own folder (/img/...), or null
const picture = async (src) => {
    try {
        let buf
        if (/^https:\/\//i.test(src)) {
            const res = await fetch(src, { timeout: 8000, size: 5 * 1024 * 1024, headers: { 'User-Agent': 'TF2Deal.com share picture' } })
            if (!res.ok) return null
            buf = await res.buffer()
        } else if (/^\/[\w\-./]+$/.test(src) && !src.includes('..')) {
            buf = await fs.promises.readFile(path.join(pub, src))
        } else {
            return null
        }
        return await loadImage(buf)
    } catch (error) {
        return null
    }
}

const [item, particles, logo] = await Promise.all([
    data.image ? picture(data.image) : null,
    // the unusual effect: backpack.tf's big picture, else its small one (the one the site shows)
    data.effect > 0 ? picture(`https://backpack.tf/images/440/particles/${data.effect}_380x380.png`).then((p) => p || picture(`https://api.backpack.tf/images/440/particles/${data.effect}_94x94.png`)) : null,
    picture('/img/logotype.png')
])

const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.textBaseline = 'alphabetic'

ctx.fillStyle = C.night
ctx.fillRect(0, 0, W, H)

const round_rect = (x, y, w, h, r) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}
const rgba = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// ------------------------------------------------------------------ the item tile (right)

const TILE = { x: 698, y: 100, size: 430 }
round_rect(TILE.x, TILE.y, TILE.size, TILE.size, 28)
ctx.fillStyle = C.tile
ctx.fill()
ctx.save()
round_rect(TILE.x, TILE.y, TILE.size, TILE.size, 28)
ctx.clip()

const cx = TILE.x + TILE.size / 2, cy = TILE.y + TILE.size / 2
const q = QUALITY[data.quality] || QUALITY[6]
const strength = GLOW[data.quality] ?? 0.42
const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200)
glow.addColorStop(0, rgba(q, strength))
glow.addColorStop(0.55, rgba(q, strength * 0.42))
glow.addColorStop(1, rgba(q, 0))
ctx.fillStyle = glow
ctx.fillRect(TILE.x, TILE.y, TILE.size, TILE.size)

ctx.imageSmoothingEnabled = true
ctx.imageSmoothingQuality = 'high'
if (particles) {
    const s = 380
    ctx.drawImage(particles, cx - s / 2, cy - s / 2, s, s)
}
if (item) {
    // contain in 80% of the tile, like the site's item pictures
    const box = TILE.size * 0.8
    const scale = Math.min(box / item.width, box / item.height)
    const w = item.width * scale, h = item.height * scale
    ctx.drawImage(item, cx - w / 2, cy - h / 2, w, h)
} else {
    // no picture (it couldn't be loaded): the gift from the site's icons
    ctx.fillStyle = rgba(C.amber, 0.75)
    ctx.font = '170px "TD Icons"'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String.fromCharCode(0xe99f), cx, cy)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
}
ctx.restore()

// ------------------------------------------------------------------ the words (left)

const LEFT = 72, MAX_W = 560, TOP = 64, BOTTOM = 566

if (logo) {
    const w = 300, h = logo.height * (w / logo.width)
    ctx.drawImage(logo, LEFT, TOP, w, h)
}

// { lines, cut }: `text` in lines no wider than `max` in the current font, at most `max_lines`; when it doesn't fit,
// the last line ends in "…" (cut)
const wrap = (text, max, max_lines) => {
    const width = (t) => ctx.measureText(t).width
    const lines = []
    let line = ''
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (!line || width(next) <= max) line = next
        else { lines.push(line); line = word }
    }
    if (line) lines.push(line)
    if (lines.length <= max_lines && lines.every((l) => width(l) <= max)) return { lines, cut: false }
    const kept = lines.slice(0, max_lines)
    let last = lines.slice(max_lines - 1).join(' ')
    while (last.length > 1 && width(last + '…') > max) last = last.slice(0, -1).trimEnd()
    kept[kept.length - 1] = last + '…'
    return { lines: kept, cut: true }
}

// the item's name: as big as fits
// (three lines while it's big, four once it's small; "…" only past that)
let title_size = 70, title_lines
for (const size of [70, 62, 56, 50, 44]) {
    title_size = size
    ctx.font = `800 ${size}px "TD Rubik"`
    const fit = wrap(data.name || 'TF2 item', MAX_W, size > 50 ? 3 : 4)
    title_lines = fit.lines
    if (!fit.cut) break
}
const title_lh = Math.round(title_size * 1.04)

const req = data.steam_group && data.trade ? 'Join our Steam group, make one trade on the site, and you\'re in.'
    : data.steam_group ? 'Join our Steam group and you\'re in.'
    : data.trade ? 'Make one trade on the site and you\'re in.'
    : 'Sign in with Steam and you\'re in.'
const count = (n) => `${n} ${n == 1 ? 'person' : 'people'} entered.`
const texts = {
    active: { kicker: 'Free TF2 giveaway', color: C.amber, sub: req, chip: ['Enter at ', data.link] },
    ended: {
        kicker: 'Giveaway ended', color: C.muted,
        sub: data.has_winner ? `${data.winner ? `Won by ${data.winner}.` : 'The winner has been drawn.'} ${count(data.entries)}` : 'It ended without a winner.',
        chip: ['More giveaways at ', data.link.replace(/\/\d+$/, '')]
    },
    cancelled: { kicker: 'Giveaway cancelled', color: C.muted, sub: 'This giveaway was cancelled.', chip: ['More giveaways at ', data.link.replace(/\/\d+$/, '')] }
}[data.state] || {}

ctx.font = '500 24px "TD Inter"'
const sub_lines = wrap(texts.sub, MAX_W, 2).lines
const SUB_LH = 34

// laid out from the bottom up, like the brand card (its text block sits at the bottom of the left column)
const CHIP_H = 48
const block = 18 + 16 + title_lines.length * title_lh + 18 + sub_lines.length * SUB_LH + 26 + CHIP_H
let y = BOTTOM - block

// kicker: small capitals with wide spacing
ctx.font = '700 18px "TD Inter"'
ctx.fillStyle = texts.color
ctx.letterSpacing = '2.5px'
ctx.fillText(String(texts.kicker).toUpperCase(), LEFT, y + 16)
ctx.letterSpacing = '0px'
y += 18 + 16

ctx.font = `800 ${title_size}px "TD Rubik"`
ctx.fillStyle = C.cream
ctx.letterSpacing = `${(-0.012 * title_size).toFixed(2)}px`
for (const line of title_lines) {
    y += title_lh
    ctx.fillText(line, LEFT, y - Math.round(title_lh * 0.2))
}
ctx.letterSpacing = '0px'
y += 18

ctx.font = '500 24px "TD Inter"'
ctx.fillStyle = C.sub
for (const line of sub_lines) {
    y += SUB_LH
    ctx.fillText(line, LEFT, y - 9)
}
y += 26

// the chip: "Enter at tf2deal.com/giveaway/12", the link in amber
const [plain, strong] = texts.chip
ctx.font = '600 22px "TD Inter"'
const plain_w = ctx.measureText(plain).width
ctx.font = '700 22px "TD Inter"'
const strong_w = ctx.measureText(strong).width
const chip_w = Math.min(MAX_W + 40, 18 + plain_w + strong_w + 18)
round_rect(LEFT, y, chip_w, CHIP_H, 14)
ctx.fillStyle = C.chip
ctx.fill()
ctx.font = '600 22px "TD Inter"'
ctx.fillStyle = C.cream
ctx.fillText(plain, LEFT + 18, y + 31)
ctx.font = '700 22px "TD Inter"'
ctx.fillStyle = C.amber
ctx.fillText(strong, LEFT + 18 + plain_w, y + 31)

process.stdout.write(await cv.encode('png'))
