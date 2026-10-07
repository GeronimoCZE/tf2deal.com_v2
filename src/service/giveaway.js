import crypto from 'crypto'
import fetch from 'node-fetch'

import * as app from '../app.js'
import User from '../model/User.js'
import { trade_model } from '../model/Trade.js'
import { giveaway_model } from '../model/Giveaway.js'
import { notify } from './notifications.js'

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

// picks a random winner and closes the giveaway
const draw_winner = async (giveaway) => {
    const entries = giveaway.entries || []
    const winner = entries.length > 0 ? entries[crypto.randomInt(entries.length)] : null

    const result = await giveaway_model.updateOne({ _id: giveaway._id, status: 'active' }, { $set: {
        status: 'ended',
        end: Math.min(giveaway.end, Date.now()),
        winner: winner ? { steamid: winner.steamid, name: winner.name, avatar: winner.avatar } : { steamid: null, name: '', avatar: '' }
    } })

    if(winner){
        await User.updateOne({ steamid: winner.steamid }, { $inc: { 'giveaways.won': 1 } }).catch(() => {})
    }

    // bell: everyone sees who won, the winner gets their own one (only once, if two calls raced)
    if((result?.modifiedCount ?? result?.nModified ?? 1) > 0){
        const item = giveaway.item?.bp_sku || ''
        notify({ type: 'giveaway_ended', vars: { item, winner: winner?.name || '' }, link: '/giveaway' })
        if(winner){ notify({ to: winner.steamid, type: 'giveaway_won', vars: { item }, link: '/profile/giveaways' }) }
    }
    return winner
}

// called every minute from app.js
const finish_due = async () => {
    const due = await giveaway_model.find({ status: 'active', end: { $lte: Date.now() } }).lean()
    for (const giveaway of due) {
        await draw_winner(giveaway)
    }
    if(due.length > 0){ await refresh_state() }
}

export { in_steam_group, check_requirements, refresh_state, draw_winner, finish_due }
