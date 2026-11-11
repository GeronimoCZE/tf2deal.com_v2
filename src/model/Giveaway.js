import mongoose from "mongoose";

// every entry: only who and when. Names and avatars are kept for the latest 45 only (`recent`).
// (giveaways from before that kept name + avatar here; migrate_entries() in service/giveaway.js drops them)
const Entry = mongoose.Schema({
    steamid: { type: String, required: true },
    entered: { type: Number, required: true }
}, { _id: false, strict: false })

// the latest entries shown as small avatars on the giveaway page, newest last ($push with $slice -RECENT_MAX)
const Recent = mongoose.Schema({
    steamid: { type: String, required: true },
    name: { type: String, default: '' },
    avatar: { type: String, default: '' }, // Steam avatar URL (64 px, shown at 28: sharp on phones)
    entered: { type: Number, default: 0 }
}, { _id: false })

// the prize: one item from a bot account, moved to the bank bot and kept there for the winner
// (service/giveaway_prize.js talks to bot_manager, docs/GIVEAWAY_PRIZES.md)
const Prize = mongoose.Schema({
    assetid: { type: String, default: '' },      // its asset id now (it changes when the item moves to the bank bot)
    bot: { type: String, default: '' },          // steamid of the bot holding it now
    from_assetid: { type: String, default: '' }, // where it was picked
    from_bot: { type: String, default: '' },
    bank: { type: String, default: '' },         // steamid of the bank bot
    name: { type: String, default: '' },         // its full name (unpriced items have no bp_sku)
    priced: { type: Boolean, default: true },
    // moving -> held -> sending -> sent -> accepted, or move_failed / send_failed / declined (sent again) / released
    state: { type: String, default: '' },
    offer_id: { type: String, default: '' },
    error: { type: String, default: '' },
    tries: { type: Number, default: 0 },         // automatic sends that failed so far
    next_try: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    updated: { type: Number, default: 0 }
}, { _id: false })

// the giveaway's announcement on one service (service/giveaway_posts.js)
const Post = mongoose.Schema({
    state: { type: String, default: '' }, // posting | posted | post_failed | removing | removed | remove_failed
    id: { type: String, default: '' }, // Steam announcement id / Facebook post id
    error: { type: String, default: '' },
    tries: { type: Number, default: 0 }, // failed removals so far
    updated: { type: Number, default: 0 }
}, { _id: false })

const Giveaway = mongoose.Schema({
    item: { // the prize item as shown on the site: from the bot item picked (unpriced items: bp_sku = its Steam name)
        bp_sku: { type: String, required: true },
        image: { type: String, default: '' },
        qualityID: { type: String, default: '6' },
        effectID: { type: Number, default: 0 }
    },
    description: { type: String, default: '' },
    // AI translations (service/translate.js): written in `lang`, translated into the other site languages
    lang: { type: String, default: 'en' },
    source_hash: { type: String, default: '' }, // fingerprint of the current text; translations with another one are outdated
    translations: { type: mongoose.Schema.Types.Mixed, default: {} }, // { de: { <fields>, hash, model, updated }, ... }
    translation_errors: { type: mongoose.Schema.Types.Mixed, default: {} }, // { de: 'error message' }
    requirements: {
        steam_group: { type: Boolean, default: true }, // member of our Steam group
        trade: { type: Boolean, default: true } // at least 1 trade since the giveaway started
    },
    entries: { type: [Entry], default: [] },
    recent: { type: [Recent], default: [] },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    status: { type: String, default: 'active' }, // active | ended | cancelled
    winner: {
        steamid: { type: String, default: null },
        name: { type: String, default: '' },
        avatar: { type: String, default: '' },
        entered: { type: Number, default: 0 },
        drawn: { type: Number, default: 0 }
    },
    prize: { type: Prize, default: undefined }, // giveaways from before the bank bot have none: the item is only `item`
    prize_sent: { type: Boolean, default: false }, // the prize reached the winner (the bank bot's offer was accepted, or ticked by hand)
    posts: { // announcements on the Steam group and the Facebook Page, removed when the giveaway ends or is cancelled
        steam: Post,
        facebook: Post
    },
    created: { type: Number, required: true }
})

Giveaway.index({ status: 1, end: 1 });
Giveaway.index({ 'entries.steamid': 1 });

export const giveaway_model = mongoose.model('giveaways', Giveaway);
