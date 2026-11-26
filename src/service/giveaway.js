import crypto from 'crypto'
import fetch from 'node-fetch'

import * as app from '../app.js'
import User from '../model/User.js'
import { trade_model } from '../model/Trade.js'
import { giveaway_model } from '../model/Giveaway.js'
import { giveaway_archive_model } from '../model/GiveawayArchive.js'
import { notify } from './notifications.js'
import { remove_posts, remove_due } from './giveaway_posts.js'
import * as prize from './giveaway_prize.js'
import * as sitemap from './sitemap.js'
import * as og from './giveaway_og.js'

// avatars of the latest entries on the giveaway page; only these keep a name and an avatar
const RECENT_MAX = 45

// Minimum entries (Nikolas 2026-11-26): the winner is drawn at the end time only when at least this many have entered.
// With fewer, the giveaway keeps running ("waiting") and the winner is drawn as soon as the last entry it needs comes
// in. Set per giveaway in Admin → Giveaways (0 = drawn at the end time whatever happens). Giveaways from before the
// setting count as DEFAULT_MIN_ENTRIES.
const DEFAULT_MIN_ENTRIES = 25
const MAX_MIN_ENTRIES = 100000
const min_entries = (giveaway) => {
    const n = Number(giveaway?.min_entries)
    return Number.isFinite(n) && n >= 0 ? Math.min(MAX_MIN_ENTRIES, Math.floor(n)) : DEFAULT_MIN_ENTRIES
}
// what the admin panel sent, or null when it isn't a number of entries
const parse_min_entries = (value) => {
    if(value === '' || value === null || value === undefined){ return null }
    const n = Number(value)
    return Number.isInteger(n) && n >= 0 && n <= MAX_MIN_ENTRIES ? n : null
}
const entry_count = (giveaway) => Number(giveaway?.entry_count ?? giveaway?.entries?.length) || 0

// where a running giveaway stands: how many it needs, and whether its end time has passed (over) with too few
// entries (waiting) or with enough (due: drawn now)
const progress = (giveaway, now = Date.now()) => {
    const min = min_entries(giveaway)
    const count = entry_count(giveaway)
    const needed = Math.max(0, min - count)
    const over = Number(giveaway?.end) <= now
    return { min, count, needed, over, waiting: over && needed > 0, due: over && needed == 0 }
}

// every giveaway has its own page, /giveaway/<number>: the share link (the picture for it: service/giveaway_og.js)
const share_path = (giveaway) => giveaway?.number ? `/giveaway/${giveaway.number}` : '/giveaway'

// the number for a new giveaway: one more than the highest so far (the unique index catches a clash)
const next_number = async () => {
    const last = await giveaway_model.findOne({ number: { $gt: 0 } }, { number: 1 }).sort({ number: -1 }).lean()
    return (Number(last?.number) || 0) + 1
}

// giveaways from before the numbers get theirs, oldest first
let numbered = false
const number_old = async () => {
    if(numbered){ return }
    numbered = true
    const old = await giveaway_model.find({ number: { $exists: false } }, { _id: 1 }).sort({ created: 1, _id: 1 }).lean()
    if(old.length == 0){ return }
    let number = await next_number()
    for (const g of old) {
        await giveaway_model.updateOne({ _id: g._id, number: { $exists: false } }, { $set: { number: number++ } })
    }
    console.log(`giveaway: ${old.length} older giveaway${old.length == 1 ? '' : 's'} got ${old.length == 1 ? 'its' : 'their'} page number (/giveaway/<number>)`)
}

const STEAM_GROUP_64_BASE = 103582791429521408n
const MEMBERS_CACHE_MS = 2 * 60 * 1000 // the group's member list is read again after this...
const MEMBERS_RECHECK_MS = 10 * 1000   // ... or after this for someone not on it (they may have just joined)
const MEMBER_PAGES = 50                // 1,000 members per page

const community_xml = async (path) => {
    try {
        const res = await fetch('https://steamcommunity.com' + path, { timeout: 8000 })
        return res.ok ? await res.text() : null
    } catch (error) {
        return null
    }
}

// "Our Steam group": the one the footer, the giveaway page and the trade window link to. The group check (giveaway
// requirement, "Join our Steam group" after a trade) looks players up in this group. STEAM_GROUP_ID is only where
// giveaway announcements are posted (service/giveaway_posts.js); if it names another group, the log says so.
const GROUP_NAME = 'tradetf2deal'
const GROUP_URL = `https://steamcommunity.com/groups/${GROUP_NAME}`
let group_id = null // its 64-bit id (<groupID64> in its memberslistxml), read once
let group_loading = null
const group_id64 = async () => {
    if(group_id){ return group_id }
    group_loading ||= (async () => {
        const xml = await community_xml(`/groups/${GROUP_NAME}/memberslistxml/?xml=1`)
        const id64 = xml?.match(/<groupID64>(\d+)<\/groupID64>/)?.[1] || null
        if(id64){
            group_id = id64
            const setting = String(process.env.STEAM_GROUP_ID || '').trim()
            const setting64 = /^\d{17,}$/.test(setting) ? setting : /^\d+$/.test(setting) ? (STEAM_GROUP_64_BASE + BigInt(setting)).toString() : null
            if(setting64 && setting64 !== id64){
                console.warn(`Steam group: STEAM_GROUP_ID ${setting} is not ${GROUP_URL} (its id is ${id64}). Giveaway announcements go to STEAM_GROUP_ID; set it to ${id64} to post in ${GROUP_NAME}.`)
            }
        }
        return id64
    })().finally(() => { group_loading = null })
    return group_loading
}

// the group's page on steamcommunity.com, for "Join our Steam group" links
const group_url = () => GROUP_URL

// the player's groups from the Steam Web API: true / false, or null when Steam doesn't tell (private profile, API down)
const listed_in_group = async (steamid, id64) => {
    try {
        const res = await fetch(`https://api.steampowered.com/ISteamUser/GetUserGroupList/v1/?key=${process.env.API_KEY_STEAM}&steamid=${steamid}`, { timeout: 8000 })
        if(!res.ok){ return null }
        const data = await res.json()
        if(!data?.response?.success){ return null }
        // the API gives 32-bit group ids
        return (data.response.groups || []).some(({ gid }) => /^\d+$/.test(String(gid)) && (STEAM_GROUP_64_BASE + BigInt(gid)).toString() == id64)
    } catch (error) {
        return null
    }
}

// the group's own member list (public whatever the members' profile settings), as a Set of steamids, or null
let members = { id64: null, time: 0, set: null, loading: null }
const group_members = async (id64, max_age) => {
    if(members.id64 === id64 && members.set && Date.now() - members.time < max_age){ return members.set }
    if(members.loading?.id64 === id64){ return members.loading.promise }

    const promise = (async () => {
        const set = new Set()
        for(let page = 1, pages = 1; page <= pages && page <= MEMBER_PAGES; page++){
            const xml = await community_xml(`/gid/${id64}/memberslistxml/?xml=1&p=${page}`)
            if(!xml?.includes('<memberList>')){ return null }
            pages = Number(xml.match(/<totalPages>(\d+)<\/totalPages>/)?.[1]) || 1
            for(const match of xml.matchAll(/<steamID64>(\d+)<\/steamID64>/g)){ set.add(match[1]) }
        }
        members = { id64, time: Date.now(), set, loading: null }
        return set
    })().finally(() => { if(members.loading?.promise === promise){ members.loading = null } })
    members.loading = { id64, promise }
    return promise
}

// true / false, or null when Steam doesn't tell us (Steam down). A private profile hides its groups from the
// Web API, so anyone the API doesn't list is looked up in the group's member list.
const in_steam_group = async (steamid) => {
    const id64 = await group_id64()
    if(!id64){ return null }

    const listed = await listed_in_group(steamid, id64)
    if(listed === true){ return true }

    let set = await group_members(id64, MEMBERS_CACHE_MS)
    if(set && !set.has(String(steamid))){ set = await group_members(id64, MEMBERS_RECHECK_MS) }
    if(!set){ return listed }
    return set.has(String(steamid))
}

// { steam_group: true|false|null|undefined, trade: true|false|undefined, ok: boolean }
const check_requirements = async (steamid, giveaway) => {
    const result = { ok: true }

    if(giveaway.requirements?.steam_group){
        result.steam_group = await in_steam_group(steamid)
        if(result.steam_group !== true){ result.ok = false }
        else { User.updateOne({ steamid }, { $set: { group_member: true } }).catch(() => {}) }
    }

    if(giveaway.requirements?.trade){
        // any trade the bots saved, made on the site or not; older records have their timestamp in seconds
        const trades = await trade_model.countDocuments({ partnerSteamID: steamid, $or: [
            { timestamp: { $gte: giveaway.start } },
            { timestamp: { $gte: Math.floor(giveaway.start / 1000), $lt: 1e11 } }
        ] })
        result.trade = trades > 0
        if(!result.trade){ result.ok = false }
    }

    return result
}

// name + small avatar of a Steam profile (the winner may not be among the latest 45), or null
const player_summary = async (steamid) => {
    try {
        const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.API_KEY_STEAM}&steamids=${steamid}`, { timeout: 8000 })
        if(!res.ok){ return null }
        const player = (await res.json())?.response?.players?.[0]
        return player ? { name: String(player.personaname || ''), avatar: String(player.avatarmedium || player.avatar || '') } : null
    } catch (error) {
        return null
    }
}

// a successful entry: every entry keeps only steamid + time, the latest RECENT_MAX also name + avatar.
// Returns false when they were in already (or the giveaway ended meanwhile).
const add_entry = async (giveaway_id, user) => {
    const steamid = String(user.steamid)
    const entered = Date.now()
    const result = await giveaway_model.updateOne(
        { _id: giveaway_id, status: 'active', 'entries.steamid': { $ne: steamid } },
        { $push: {
            entries: { steamid, entered },
            recent: { $each: [{ steamid, name: String(user.personaname || ''), avatar: String(user.avatarmedium || user.avatar || ''), entered }], $slice: -RECENT_MAX }
        } }
    )
    return (result.nModified ?? result.modifiedCount) > 0
}

// the avatar strip: newest first, plus how many entered beyond those
const recent_view = (giveaway) => {
    const recent = [...(giveaway.recent || [])].slice(-RECENT_MAX).reverse()
        .map(({ steamid, name, avatar }) => ({ steamid, name, avatar }))
    const total = Number(giveaway.entry_count ?? giveaway.entries?.length) || 0
    return { recent, more: Math.max(0, total - recent.length), total }
}

// giveaways from before `recent` kept every entrant's name and avatar: keep the latest RECENT_MAX, drop the rest
let migrated = false
const migrate_entries = async () => {
    if(migrated){ return }
    migrated = true
    const old = await giveaway_model.find({ 'entries.avatar': { $exists: true } }, { entries: 1, recent: 1 }).lean()
    for (const g of old) {
        const recent = g.recent?.length ? g.recent : (g.entries || []).slice(-RECENT_MAX)
            .map(({ steamid, name, avatar, entered }) => ({ steamid, name: name || '', avatar: avatar || '', entered: entered || 0 }))
        await giveaway_model.updateOne({ _id: g._id }, {
            $set: { recent, entries: (g.entries || []).map(({ steamid, entered }) => ({ steamid, entered })) }
        })
    }
    if(old.length > 0){ console.log(`giveaway: kept avatars of the latest ${RECENT_MAX} entries only (${old.length} giveaway${old.length == 1 ? '' : 's'})`) }
}

// the archive record of a concluded giveaway (model/GiveawayArchive.js)
const archive = async (giveaway_id, extra = {}) => {
    const g = await giveaway_model.findById(giveaway_id).lean()
    if(!g){ return }
    let winner = null
    if(g.winner?.steamid){
        const user = await User.findOne({ steamid: g.winner.steamid }, { tradelink: 1 }).lean().catch(() => null)
        winner = { ...g.winner, tradelink: user?.tradelink || '' }
    }
    await giveaway_archive_model.updateOne({ giveaway: g._id }, { $set: {
        number: g.number,
        status: g.status,
        item: g.item,
        description: g.description || '',
        requirements: g.requirements || {},
        start: g.start,
        end: g.end,
        entry_count: g.entries?.length || 0,
        min_entries: min_entries(g),
        waiting_since: g.waiting_since || 0,
        entrants: (g.entries || []).map((e) => e.steamid),
        winner,
        prize: g.prize || null,
        prize_sent: Boolean(g.prize_sent),
        updated: Date.now(),
        ...extra
    }, $setOnInsert: { concluded: Date.now() } }, { upsert: true })
}

// cancelled from the admin panel: no winner, the prize item goes back to normal on the bank bot
const cancel = async (giveaway_id, admin) => {
    const result = await giveaway_model.updateOne({ _id: giveaway_id, status: 'active' }, { $set: { status: 'cancelled', end: Date.now() } })
    if((result?.modifiedCount ?? result?.nModified ?? 0) == 0){ return false }
    await prize.release(giveaway_id, admin).catch(() => {})
    await archive(giveaway_id).catch((error) => console.log('giveaway: archiving failed', error.message))
    remove_posts(giveaway_id).catch((error) => console.log('giveaway: removing the posts failed', error.message))
    og.prepare_id(giveaway_id) // its share picture says it was cancelled
    return true
}

// keeps app.giveaway (nav highlight) in sync with the DB
let shown_id // the active giveaway the last refresh_state saw ('' none, undefined before the first)
const refresh_state = async () => {
    await migrate_entries().catch((error) => { migrated = false; console.log('giveaway: entry migration failed', error.message) })
    await number_old().catch((error) => { numbered = false; console.log('giveaway: numbering failed', error.message) })
    const active = await giveaway_model.findOne({ status: 'active' }, { entries: 0 }).lean()
    // a giveaway started, ended or was cancelled: the giveaway page's lastmod in the sitemap, sent to IndexNow
    const id = active ? String(active._id) : ''
    if(shown_id !== undefined && shown_id !== id){ sitemap.refresh() }
    shown_id = id
    app.giveaway.active = Boolean(active)
    app.giveaway.item = active?.item
    app.giveaway.end = active?.end
    app.giveaway.waiting = Boolean(active?.waiting_since) // its end time passed, it waits for entries
    app.giveaway.number = active?.number
    return active
}

// steamids of the admins: role 3 accounts and ADMIN_STEAMID (for their bell)
const admin_ids = async () => {
    const admins = new Set((await User.find({ role: 3 }, { steamid: 1 }).lean().catch(() => [])).map((u) => String(u.steamid)))
    if(/^\d{17}$/.test(String(process.env.ADMIN_STEAMID || ''))){ admins.add(String(process.env.ADMIN_STEAMID)) }
    return admins
}

// picks a random winner and closes the giveaway. With the Steam group requirement the winner is checked again:
// someone who left the group since entering is skipped and another entry drawn (if Steam can't tell, they win).
// Returns { winner, skipped }: skipped = how many left the group.
const draw_winner = async (giveaway) => {
    const entries = [...(giveaway.entries || [])]
    let winner = null, skipped = 0
    while(!winner && entries.length > 0){
        const pick = entries.splice(crypto.randomInt(entries.length), 1)[0]
        if(giveaway.requirements?.steam_group && await in_steam_group(pick.steamid) === false){
            skipped++
            User.updateOne({ steamid: pick.steamid }, { $set: { group_member: false } }).catch(() => {})
            continue
        }
        winner = pick
    }

    // only the latest entries keep a name and avatar: anyone else's come from Steam
    if(winner){
        const known = (giveaway.recent || []).find((r) => r.steamid == winner.steamid) || (winner.avatar ? winner : null)
        const profile = known || await player_summary(winner.steamid) || {}
        winner = { steamid: winner.steamid, name: profile.name || '', avatar: profile.avatar || '', entered: winner.entered || 0, drawn: Date.now() }
    }

    // it ended now: early from the admin panel, or late after waiting for entries; on time it keeps its end time
    const result = await giveaway_model.updateOne({ _id: giveaway._id, status: 'active' }, { $set: {
        status: 'ended',
        end: Number(giveaway.waiting_since) > 0 ? Date.now() : Math.min(giveaway.end, Date.now()),
        winner: winner || { steamid: null, name: '', avatar: '', entered: 0, drawn: Date.now() }
    } })

    // another call (end button and the minute timer at once) ended it first: its winner stands
    if((result?.modifiedCount ?? result?.nModified ?? 1) == 0){
        const ended = await giveaway_model.findById(giveaway._id, { winner: 1 }).lean()
        return { winner: ended?.winner?.steamid ? ended.winner : null, skipped: 0 }
    }
    if(skipped > 0){ console.log(`giveaway: ${skipped} drawn ${skipped == 1 ? 'entry was' : 'entries were'} no longer in the Steam group`) }

    if(winner){
        await User.updateOne({ steamid: winner.steamid }, { $inc: { 'giveaways.won': 1 } }).catch(() => {})
    }

    // bell: everyone sees who won, the winner gets their own one
    const item = giveaway.item?.bp_sku || ''
    notify({ type: 'giveaway_ended', vars: { item, winner: winner?.name || '' }, link: '/giveaway' })
    if(winner){ notify({ to: winner.steamid, type: 'giveaway_won', vars: { item }, link: '/profile/giveaways' }) }

    // the admins get the winner (their bell links to Admin → Giveaways, where the winner's details are)
    for (const admin of await admin_ids()) {
        notify({ to: admin, type: 'giveaway_admin_winner', vars: { item, winner: winner ? (winner.name || winner.steamid) : '' }, link: '/admin#giveaways' })
    }
    if(winner){ console.log(`giveaway: ${winner.name || winner.steamid} (${winner.steamid}) won ${item}`) }

    // the prize: the bank bot sends it to the winner; without a winner the item goes back to normal
    if(giveaway.prize?.state){
        if(winner){ prize.send(giveaway._id).catch((error) => console.log('giveaway: sending the prize failed', error.message)) }
        else { prize.release(giveaway._id, 'giveaways').catch(() => {}) }
    }
    await archive(giveaway._id, { skipped }).catch((error) => console.log('giveaway: archiving failed', error.message))

    // Steam group / Facebook announcements (service/giveaway_posts.js)
    remove_posts(giveaway._id).catch((error) => console.log('giveaway: removing the posts failed', error.message))
    og.prepare_id(giveaway._id) // the share picture names the winner now
    return { winner, skipped }
}

// the end time passed with too few entries: it keeps running and the admins hear about it (once)
const start_waiting = async (giveaway, p) => {
    const result = await giveaway_model.updateOne(
        { _id: giveaway._id, status: 'active', $or: [{ waiting_since: { $exists: false } }, { waiting_since: { $lte: 0 } }] },
        { $set: { waiting_since: Date.now() } }
    )
    if((result?.modifiedCount ?? result?.nModified ?? 0) == 0){ return false }
    const item = giveaway.item?.bp_sku || ''
    console.log(`giveaway: ${item} reached its end time with ${p.count} of ${p.min} entries; it waits for ${p.needed} more`)
    for (const admin of await admin_ids()) {
        notify({ to: admin, type: 'giveaway_admin_waiting', vars: { item, count: p.count, min: p.min, needed: p.needed }, link: '/admin#giveaways' })
    }
    return true
}

// a new entry: a giveaway that waits for entries is drawn as soon as it has enough (in the background: the entrant's
// answer doesn't wait for the Steam group checks). true when the draw started.
const after_entry = async (giveaway_id) => {
    const giveaway = await giveaway_model.findOne({ _id: giveaway_id, status: 'active', end: { $lte: Date.now() } }).lean()
    if(!giveaway || !progress(giveaway).due){ return false }
    draw_winner(giveaway)
        .then(() => refresh_state())
        .catch((error) => console.log('giveaway: drawing the winner failed', error.message))
    return true
}

// Admin → Giveaways changed the minimum of the running giveaway. Past its end time with enough entries now, the winner
// is drawn at once; with too few, it waits. → { status, min, needed, waiting, drawn, winner, skipped }
const set_min_entries = async (giveaway_id, value) => {
    const min = parse_min_entries(value)
    if(min === null){ return { status: 'error', message: `The minimum is a whole number from 0 to ${MAX_MIN_ENTRIES}.` } }
    const result = await giveaway_model.updateOne({ _id: giveaway_id, status: 'active' }, { $set: { min_entries: min } })
    if((result?.n ?? result?.matchedCount ?? 0) == 0){ return { status: 'error', message: 'No running giveaway with this id.' } }

    const giveaway = await giveaway_model.findOne({ _id: giveaway_id, status: 'active' }).lean()
    if(!giveaway){ return { status: 'error', message: 'The giveaway ended meanwhile.' } }
    const p = progress(giveaway)
    if(p.due){
        const { winner, skipped } = await draw_winner(giveaway)
        await refresh_state()
        return { status: 'ok', min, needed: 0, waiting: false, drawn: true, winner, skipped }
    }
    if(p.waiting && !(Number(giveaway.waiting_since) > 0)){
        await giveaway_model.updateOne({ _id: giveaway._id, status: 'active' }, { $set: { waiting_since: Date.now() } })
        await refresh_state()
    }
    return { status: 'ok', min, needed: p.needed, waiting: p.waiting, drawn: false }
}

// called every minute from app.js: a giveaway whose end time has passed is drawn, or waits for entries
const finish_due = async () => {
    const now = Date.now()
    const due = await giveaway_model.find({ status: 'active', end: { $lte: now } }).lean()
    let changed = false
    for (const giveaway of due) {
        const p = progress(giveaway, now)
        if(p.waiting){
            if(await start_waiting(giveaway, p)){ changed = true }
            continue
        }
        await draw_winner(giveaway)
        changed = true
    }
    if(changed){ await refresh_state() }

    // winners still waiting for their prize (no trade link yet, bank bot was offline...)
    await prize.send_due().catch((error) => console.log('giveaway: sending prizes failed', error.message))

    // announcements still to remove (removing failed earlier, or the site restarted)
    await remove_due().catch((error) => console.log('giveaway: removing the posts failed', error.message))
}

export {
    in_steam_group, group_url, check_requirements, refresh_state, draw_winner, finish_due, add_entry, recent_view, cancel, archive, RECENT_MAX,
    DEFAULT_MIN_ENTRIES, MAX_MIN_ENTRIES, min_entries, parse_min_entries, progress, after_entry, set_min_entries, share_path, next_number
}
