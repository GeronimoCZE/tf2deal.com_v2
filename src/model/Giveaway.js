import mongoose from "mongoose";

const Entry = mongoose.Schema({
    steamid: { type: String, required: true },
    name: { type: String, default: '' },
    avatar: { type: String, default: '' },
    entered: { type: Number, required: true }
}, { _id: false })

const Giveaway = mongoose.Schema({
    item: { // copied from item_instances when the giveaway is created
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
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    status: { type: String, default: 'active' }, // active | ended | cancelled
    winner: {
        steamid: { type: String, default: null },
        name: { type: String, default: '' },
        avatar: { type: String, default: '' }
    },
    prize_sent: { type: Boolean, default: false }, // you send the prize manually, then tick it in the admin panel
    created: { type: Number, required: true }
})

Giveaway.index({ status: 1, end: 1 });
Giveaway.index({ 'entries.steamid': 1 });

export const giveaway_model = mongoose.model('giveaways', Giveaway);
