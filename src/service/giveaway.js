import crypto from 'crypto'
import fetch from 'node-fetch'

import * as app from '../app.js'
import User from '../model/User.js'
import { trade_model } from '../model/Trade.js'
import { giveaway_model } from '../model/Giveaway.js'
import { notify } from './notifications.js'
import { remove_posts, remove_due } from './giveaway_posts.js'

const STEAM_GROUP_64_BASE = 103582791429521408n

// true / false, or null when Steam doesn't tell us (private profile, API down)
const in_steam_group = async (steamid) => {
    const group_id = String(process.env.STEAM_GROUP_ID || '')
    if(!group_id){ return null }

    try {
        const res = await fetch(`https://api.steampowered.com/ISteamUser/GetUserGroupList/v1/?key=${process.env.API_KEY_STEAM}&steamid=${steamid}`, { timeout: 8000 })
        if(!res.ok){ return null }
        const data = await res.json()
        if(!data?.response?.success){ return null }

        // the API returns 32-bit group ids, STEAM_GROUP_ID may be either format
        return (data.response.groups || []).some(({ gid }) => {
            return String(gid) == group_id || (STEAM_GROUP_64_BASE + BigInt(gid)).toString() == group_id
        })
    } catch (error) {
        return null
    }
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
        const trades = await trade_model.countDocuments({ partnerSteamID: steamid, timestamp: { $gte: giveaway.start } })
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

export { in_steam_group, check_requirements, refresh_state, draw_winner, finish_due }
