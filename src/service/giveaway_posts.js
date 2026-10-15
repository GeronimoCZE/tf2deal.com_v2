// Announces a new giveaway on the Steam group and the Facebook Page, and removes both posts again when the giveaway
// ends or is cancelled. Each one is optional and only switched on when its settings are in src/config/.env:
//
//   Steam group announcement: posted by a Steam account that is an officer of the group (STEAM_GROUP_ID). It signs in
//   on the Steam website only, like a browser, so it never logs the account out of the Steam app or a bot. Still,
//   don't use a trading bot's account.
//     STEAM_GROUP_ACCOUNT=...         the account name you sign in with (not the profile name)
//     STEAM_GROUP_PASSWORD=...
//     STEAM_GROUP_SHARED_SECRET=...   shared_secret of the account's Steam Guard mobile authenticator (for the code)
//
//   Facebook Page post (Graph API):
//     FACEBOOK_PAGE_ID=...
//     FACEBOOK_PAGE_TOKEN=...         a Page access token with pages_manage_posts (docs/SETUP.md says how to get one)
//
// A post that fails never stops the giveaway: the admin panel shows what happened under each giveaway. A removal
// that fails is tried again every 10 minutes for a day (finish_due in service/giveaway.js calls remove_due).
//
// Settings are read when they're used (not when this file loads): app.js loads .env after all imports.

import fetch from 'node-fetch'

import { giveaway_model } from '../model/Giveaway.js'

const GRAPH_API = 'https://graph.facebook.com/v26.0' // Facebook Graph API version used for every call
const STEAM_GROUP_64_BASE = 103582791429521408n
const STEAM_SESSION_HOURS = 12 // signs in again after this (Steam's web sign-in lasts about a day)
const RETRY_EVERY = 10 * 60 * 1000 // a removal that failed is tried again after 10 minutes...
const MAX_TRIES = 6 * 24 // ...for a day, then it's left to you
const STUCK_AFTER = 15 * 60 * 1000 // a post or removal still running after this was cut off (the site restarted)

/* ========================= TEXT ========================= */

const site_link = () => `${String(process.env.SITE_URL || '').replace(/\/+$/, '')}/giveaway`
const end_date = (end) => `${new Date(end).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short' })} UTC`

// headline and paragraphs, in English (the description as you wrote it)
const post_text = (giveaway) => {
    const item = giveaway.item?.bp_sku || ''
    const needs = [giveaway.requirements?.steam_group && 'be in our Steam group', giveaway.requirements?.trade && 'make 1 trade with us during the giveaway'].filter(Boolean)
    return {
        headline: `Giveaway: ${item}`,
        paragraphs: [
            `We're giving away ${item}!`,
            giveaway.description,
            `Ends ${end_date(giveaway.end)}.${needs.length ? ` To enter, ${needs.join(' and ')}.` : ''}`
        ].filter(Boolean)
    }
}

const short = (error) => String(error?.message || error || 'Unknown error').slice(0, 300)

/* ========================= STEAM GROUP ========================= */

// STEAM_GROUP_ID can be the 32-bit or the 64-bit group id (like in service/giveaway.js)
const steam_group64 = () => {
    const id = String(process.env.STEAM_GROUP_ID || '').trim()
    if(!/^\d+$/.test(id)){ throw new Error('STEAM_GROUP_ID has to be the group\'s id number') }
    return String(BigInt(id) < STEAM_GROUP_64_BASE ? STEAM_GROUP_64_BASE + BigInt(id) : BigInt(id))
}

// steamcommunity takes callbacks
const steam_call = (community, method, ...args) => new Promise((resolve, reject) => {
    community[method](...args, (error, result) => error ? reject(error) : resolve(result))
})

// one web session, reused between posts
const steam = { community: null, since: 0, login: null }

const steam_login = async () => {
    // loaded only when it's used: it's a big library
    const [{ default: SteamCommunity }, { default: SteamTotp }] = await Promise.all([import('steamcommunity'), import('steam-totp')])
    const community = new SteamCommunity()
    const secret = process.env.STEAM_GROUP_SHARED_SECRET
    try {
        await steam_call(community, 'login', {
            accountName: process.env.STEAM_GROUP_ACCOUNT,
            password: process.env.STEAM_GROUP_PASSWORD,
            twoFactorCode: secret ? SteamTotp.generateAuthCode(secret) : undefined
        })
    } catch (error) {
        if(error?.message == 'SteamGuardMobile'){ throw new Error('Steam sign-in asks for a Steam Guard code: check STEAM_GROUP_SHARED_SECRET') }
        if(error?.message == 'SteamGuard'){ throw new Error('Steam sign-in asks for an e-mailed code: the account needs the Steam Guard mobile authenticator') }
        throw error
    }
    Object.assign(steam, { community, since: Date.now() })
    return community
}

const steam_session = (fresh = false) => {
    if(!fresh && steam.community && Date.now() - steam.since < STEAM_SESSION_HOURS * 3600 * 1000){ return steam.community }
    steam.community = null
    steam.login = steam.login || steam_login().finally(() => { steam.login = null })
    return steam.login
}

// runs `work` with a signed-in session; signs in again once if Steam says the session ran out
const with_steam = async (work) => {
    try {
        return await work(await steam_session())
    } catch (error) {
        if(error?.message != 'Not Logged In'){ throw error }
        return work(await steam_session(true))
    }
}

// Steam doesn't return the announcement's id when posting, so it's read from the group's announcement feed:
// the newest one with this headline posted between `from` and `to`
const steam_find = async (community, headline, from, to) => {
    const plain = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    const list = await steam_call(community, 'getAllGroupAnnouncements', steam_group64(), new Date(from))
    return list.find((a) => plain(a.headline) == plain(headline) && a.date.getTime() <= to)?.aid || ''
}

const steam_post = (giveaway) => with_steam(async (community) => {
    const { headline, paragraphs } = post_text(giveaway)
    const from = Date.now() - 5 * 60 * 1000
    const body = [...paragraphs, `[url=${site_link()}]${site_link()}[/url]`].join('\n\n')
    await steam_call(community, 'postGroupAnnouncement', steam_group64(), headline, body, false)

    // the feed can take a moment to show it
    for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        const id = await steam_find(community, headline, from, Date.now() + 5 * 60 * 1000).catch(() => '')
        if(id){ return { id } }
    }
    return { id: '', error: 'not in the group\'s announcements yet; if it never shows up, check the account is a group officer' }
})

const steam_remove = (giveaway, id) => with_steam(async (community) => {
    // no id: look for it again (posted around the time the giveaway was created)
    id = id || await steam_find(community, post_text(giveaway).headline, giveaway.created - 5 * 60 * 1000, giveaway.created + STUCK_AFTER)
    if(!id){ throw new Error('The announcement isn\'t in the group\'s announcements') }
    await steam_call(community, 'deleteGroupAnnouncement', steam_group64(), id)
})

/* ========================= FACEBOOK ========================= */

const facebook = async (method, path, params) => {
    const res = await fetch(`${GRAPH_API}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${process.env.FACEBOOK_PAGE_TOKEN}` }, // not in the url, so it never ends up in a log
        body: params ? new URLSearchParams(params) : undefined,
        timeout: 15000
    })
    const data = await res.json().catch(() => ({}))
    if(!res.ok || data.error){
        throw Object.assign(new Error(data.error?.message || `Facebook answered ${res.status}`), { code: data.error?.code, subcode: data.error?.error_subcode })
    }
    return data
}

const facebook_post = async (giveaway) => {
    const { headline, paragraphs } = post_text(giveaway)
    const data = await facebook('POST', `${encodeURIComponent(process.env.FACEBOOK_PAGE_ID)}/feed`, {
        message: [headline, ...paragraphs, site_link()].join('\n\n'),
        link: site_link()
    })
    if(!data.id){ throw new Error('Facebook didn\'t return the post id') }
    return { id: data.id }
}

const facebook_remove = async (giveaway, id) => {
    if(!id){ return }
    try {
        await facebook('DELETE', encodeURIComponent(id))
    } catch (error) {
        if(error.code == 100 && error.subcode == 33){ return } // the post doesn't exist any more (deleted on Facebook)
        throw error
    }
}

/* ========================= POSTS ========================= */

const SERVICES = {
    steam: {
        name: 'Steam group',
        configured: () => Boolean(process.env.STEAM_GROUP_ID && process.env.STEAM_GROUP_ACCOUNT && process.env.STEAM_GROUP_PASSWORD),
        post: steam_post,
        remove: steam_remove
    },
    facebook: {
        name: 'Facebook',
        configured: () => Boolean(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_TOKEN),
        post: facebook_post,
        remove: facebook_remove
    }
}

const save = (giveaway_id, key, fields) => giveaway_model.updateOne({ _id: giveaway_id }, {
    $set: Object.fromEntries(Object.entries({ ...fields, updated: Date.now() }).map(([field, value]) => [`posts.${key}.${field}`, value]))
})

// posts of a giveaway that are waiting to be removed
const removable = (key, now) => [
    { [`posts.${key}.state`]: 'posted' },
    { [`posts.${key}.state`]: 'remove_failed', [`posts.${key}.tries`]: { $lt: MAX_TRIES }, [`posts.${key}.updated`]: { $lte: now - RETRY_EVERY } },
    { [`posts.${key}.state`]: 'removing', [`posts.${key}.updated`]: { $lte: now - STUCK_AFTER } }
]

// removes the posts of a giveaway that isn't active any more, one service after the other. Each post is marked
// "removing" first, so the end button and the minute timer never remove the same post twice.
const remove_posts = async (giveaway_id) => {
    for (const [key, service] of Object.entries(SERVICES)) {
        const now = Date.now()
        const claimed = await giveaway_model.updateOne(
            { _id: giveaway_id, status: { $ne: 'active' }, $or: removable(key, now) },
            { $set: { [`posts.${key}.state`]: 'removing', [`posts.${key}.updated`]: now } }
        )
        if((claimed?.modifiedCount ?? claimed?.nModified ?? 0) == 0){ continue }
        const giveaway = await giveaway_model.findById(giveaway_id).lean()
        const post = giveaway?.posts?.[key]
        if(!post){ continue }

        if(!service.configured()){
            await save(giveaway_id, key, { state: 'remove_failed', error: `${service.name} isn't set up any more`, tries: MAX_TRIES })
            continue
        }
        try {
            await service.remove(giveaway, post.id)
            await save(giveaway_id, key, { state: 'removed', error: '' })
        } catch (error) {
            console.log(`giveaway: removing the ${service.name} post failed`, short(error))
            await save(giveaway_id, key, { state: 'remove_failed', error: short(error), tries: (post.tries || 0) + 1 })
        }
    }
}

// a new giveaway: marks its posts "posting", then posts them one after the other in the background
const announce = async (giveaway) => {
    const services = Object.entries(SERVICES).filter(([, service]) => service.configured())
    if(services.length == 0){ return }
    await giveaway_model.updateOne({ _id: giveaway._id }, {
        $set: Object.fromEntries(services.map(([key]) => [`posts.${key}`, { state: 'posting', id: '', error: '', tries: 0, updated: Date.now() }]))
    })

    const post_all = async () => {
        for (const [key, service] of services) {
            try {
                const { id, error = '' } = await service.post(giveaway)
                await save(giveaway._id, key, { state: 'posted', id, error })
            } catch (error) {
                console.log(`giveaway: the ${service.name} post failed`, short(error))
                await save(giveaway._id, key, { state: 'post_failed', error: short(error) })
            }
        }
        await remove_posts(giveaway._id) // ended or cancelled while it was being posted
    }
    post_all().catch((error) => console.log('giveaway: saving the posts failed', error.message))
}

// every minute (finish_due): removals to try again, and posts left over when the site restarted
const remove_due = async () => {
    const now = Date.now()
    for (const key of Object.keys(SERVICES)) {
        await giveaway_model.updateMany({ [`posts.${key}.state`]: 'posting', [`posts.${key}.updated`]: { $lte: now - STUCK_AFTER } }, { $set: {
            [`posts.${key}.state`]: 'post_failed',
            [`posts.${key}.error`]: 'Cut off: the site restarted while posting. If it was posted, remove it by hand.'
        } })
    }
    const due = await giveaway_model.find({ status: { $ne: 'active' }, $or: Object.keys(SERVICES).flatMap((key) => removable(key, now)) }, { _id: 1 }).lean()
    for (const { _id } of due) {
        await remove_posts(_id)
    }
}

// for the admin panel: which services are on, and what it needs to link to the posts
const info = () => {
    let steam_group = ''
    try { steam_group = steam_group64() } catch (error) {}
    return {
        steam: SERVICES.steam.configured(),
        facebook: SERVICES.facebook.configured(),
        steam_group,
        max_tries: MAX_TRIES
    }
}

export { announce, remove_posts, remove_due, info }
