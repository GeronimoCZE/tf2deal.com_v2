// Share pictures for giveaways (Open Graph / Twitter / Discord / Steam chat link previews, 1200 x 630 PNG).
//
// Every giveaway gets its own, made from its prize: the Lamplight brand card (logo, "Free TF2 giveaway", the item's
// name, how to enter, its link) with the item on its quality glow (unusual effect too). When the giveaway ends the
// picture names the winner; a cancelled one says so. Served at /og/giveaway-<number>.png?v=<version> and named in the
// og:image of /giveaway/<number> (and of /giveaway while it runs).
//
// The picture is drawn by a separate, short-lived process (og/giveaway_card.js, with @napi-rs/canvas): the drawing
// library costs about 50 MB of memory, which goes away with that process instead of staying in the site's. One picture
// at a time; each is drawn once and kept on disk:
//   OG_CACHE_DIR=...   the folder (default: <site folder>/cache/og, which .gitignore leaves out)
// The version in the address is a fingerprint of what the picture shows, so a changed picture (the winner was drawn)
// gets a new address and link previews that ask again get the new one. Without @napi-rs/canvas (npm install not run
// after the update) the pages fall back to the prize's own picture.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

import { giveaway_model } from '../model/Giveaway.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITE_ROOT = path.resolve(HERE, '../..')
const RENDERER = path.join(HERE, 'og', 'giveaway_card.js')
const LAYOUT = 1 // change it when the picture's design changes: every giveaway gets a new picture
const RENDER_TIMEOUT = 25 * 1000
const MISSING_RETRY = 10 * 60 * 1000 // the drawing library was missing: asked again after this
export const WIDTH = 1200
export const HEIGHT = 630

export const dir = () => path.resolve(process.env.OG_CACHE_DIR || path.join(SITE_ROOT, 'cache', 'og'))

const site_host = () => {
    try { return new URL(process.env.SITE_URL || 'https://tf2deal.com').host.replace(/^www\./, '') } catch (e) { return 'tf2deal.com' }
}

// a Steam name drawn with the site's fonts (Latin, Cyrillic, common signs); with anything else (Chinese, emoji...) it
// would show as boxes, so the picture leaves the name out
const PRINTABLE = /^[ -~ -ɏͰ-ϿЀ-ԯḀ-ỿ‐-‧‰-⁞₠-₿™]+$/
const printable = (name) => {
    const text = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return text && PRINTABLE.test(text) ? text : ''
}

// what the picture shows (and nothing else: its fingerprint is the version)
export const card = (giveaway) => {
    const state = giveaway.status == 'ended' ? 'ended' : giveaway.status == 'cancelled' ? 'cancelled' : 'active'
    const image = String(giveaway.item?.image || '')
    return {
        layout: LAYOUT,
        state,
        name: String(giveaway.item?.bp_sku || giveaway.prize?.name || '').slice(0, 200),
        image: /^https?:\/\//i.test(image) ? image.replace(/^http:\/\//i, 'https://') : image.startsWith('/') && !image.startsWith('//') ? image : '',
        quality: String(giveaway.item?.qualityID || '6'),
        effect: Number(giveaway.item?.effectID) || 0,
        steam_group: Boolean(giveaway.requirements?.steam_group),
        trade: Boolean(giveaway.requirements?.trade),
        link: `${site_host()}/giveaway/${giveaway.number}`,
        winner: state == 'ended' ? printable(giveaway.winner?.name) : '',
        has_winner: state == 'ended' && Boolean(giveaway.winner?.steamid),
        entries: state == 'active' ? null : Number(giveaway.entry_count ?? giveaway.entries?.length) || 0
    }
}

export const version = (giveaway) => crypto.createHash('sha1').update(JSON.stringify(card(giveaway))).digest('hex').slice(0, 10)

// the picture's address on the site, with its version (null for a giveaway without a number yet)
export const path_of = (giveaway) => giveaway?.number ? `/og/giveaway-${giveaway.number}.png?v=${version(giveaway)}` : null

const file_of = (giveaway, v) => path.join(dir(), `giveaway-${giveaway.number}-${v}.png`)

// is the drawing library there? (false after the renderer said it is missing, until MISSING_RETRY passed)
let missing_at = 0
export const available = () => !missing_at || Date.now() - missing_at > MISSING_RETRY

// the renderer, run once for one picture: JSON in, PNG out
const draw = (data) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RENDERER], { cwd: SITE_ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TD_SITE_ROOT: SITE_ROOT } })
    const out = [], err = []
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the renderer took too long')) }, RENDER_TIMEOUT)
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => { if(err.length < 50){ err.push(chunk) } })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
        clearTimeout(timer)
        const png = Buffer.concat(out)
        if(code === 0 && png.length > 8 && png.readUInt32BE(0) === 0x89504e47){ return resolve(png) }
        const message = Buffer.concat(err).toString().trim().split('\n').pop() || `exit code ${code}`
        reject(Object.assign(new Error(message), { missing: code === 3 }))
    })
    child.stdin.end(JSON.stringify({ ...data, site_root: SITE_ROOT }))
})

const running = new Map() // file -> promise
let queue = Promise.resolve()

// the picture's file on disk, drawn now if needed; null when it can't be drawn (the pages then use the item picture)
export const file = async (giveaway) => {
    if(!giveaway?.number){ return null }
    const v = version(giveaway)
    const target = file_of(giveaway, v)
    if(fs.existsSync(target)){ return target }
    if(!available()){ return null }
    if(running.has(target)){ return running.get(target) }

    const data = card(giveaway)
    const job = queue.then(async () => {
        if(fs.existsSync(target)){ return target }
        try {
            const png = await draw(data)
            await fs.promises.mkdir(dir(), { recursive: true })
            const temp = `${target}.${process.pid}.tmp`
            await fs.promises.writeFile(temp, png)
            await fs.promises.rename(temp, target)
            missing_at = 0
            // the giveaway's older pictures (before the winner was drawn...) are not linked any more
            const prefix = `giveaway-${giveaway.number}-`
            for (const name of await fs.promises.readdir(dir()).catch(() => [])) {
                if(name.startsWith(prefix) && name != path.basename(target)){ fs.promises.unlink(path.join(dir(), name)).catch(() => {}) }
            }
            return target
        } catch (error) {
            if(error.missing){
                if(!missing_at){ console.log('Giveaway pictures: @napi-rs/canvas is not installed (run npm install); link previews use the prize picture until then') }
                missing_at = Date.now()
            } else {
                console.log(`Giveaway pictures: giveaway ${giveaway.number} not drawn: ${error.message}`)
            }
            return null
        }
    }).finally(() => running.delete(target))
    queue = job.catch(() => {})
    running.set(target, job)
    return job
}

// the giveaway with what the picture needs (entry count, no entry list), by number or id
const find = (match) => giveaway_model.aggregate([
    { $match: match },
    { $limit: 1 },
    { $project: { number: 1, item: 1, prize: 1, requirements: 1, status: 1, winner: 1, entry_count: { $size: '$entries' } } }
]).then((list) => list[0] || null)
export const by_number = (number) => find({ number: Number(number) })

// draws a giveaway's picture ahead of time, so the first link preview gets it at once (a new giveaway, a winner)
export const prepare = (giveaway) => file(giveaway).catch(() => null)
export const prepare_id = (id) => {
    if(!mongoose.Types.ObjectId.isValid(String(id))){ return }
    find({ _id: new mongoose.Types.ObjectId(String(id)) }).then((giveaway) => giveaway && file(giveaway)).catch(() => {})
}
