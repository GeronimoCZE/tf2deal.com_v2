import crypto from 'crypto'
import fetch from 'node-fetch'

import * as app from '../app.js'
import User from '../model/User.js'
import { trade_model } from '../model/Trade.js'
import { giveaway_model } from '../model/Giveaway.js'
import { notify } from './notifications.js'
import { remove_posts, remove_due } from './giveaway_posts.js'

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

// keeps app.giveaway (nav highlight) in sync with the DB
const refresh_state = async () => {
    const active = await giveaway_model.findOne({ status: 'active' }).lean()
    app.giveaway.active = Boolean(active)
    app.giveaway.item = active?.item
    app.giveaway.end = active?.end
    return active
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

    const result = await giveaway_model.updateOne({ _id: giveaway._id, status: 'active' }, { $set: {
        status: 'ended',
        end: Math.min(giveaway.end, Date.now()),
        winner: winner ? { steamid: winner.steamid, name: winner.name, avatar: winner.avatar } : { steamid: null, name: '', avatar: '' }
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

    // Steam group / Facebook announcements (service/giveaway_posts.js)
    remove_posts(giveaway._id).catch((error) => console.log('giveaway: removing the posts failed', error.message))
    return { winner, skipped }
}

// called every minute from app.js
const finish_due = async () => {
    const due = await giveaway_model.find({ status: 'active', end: { $lte: Date.now() } }).lean()
    for (const giveaway of due) {
        await draw_winner(giveaway)
    }
    if(due.length > 0){ await refresh_state() }

    // announcements still to remove (removing failed earlier, or the site restarted)
    await remove_due().catch((error) => console.log('giveaway: removing the posts failed', error.message))
}

export { in_steam_group, group_url, check_requirements, refresh_state, draw_winner, finish_due }
