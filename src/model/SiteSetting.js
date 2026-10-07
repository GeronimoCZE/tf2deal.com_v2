import mongoose from "mongoose";

// One document holds the site settings (index = STEAM_GROUP_ID, see service/settings.js).
// Change them in the admin panel (Settings) or live over the /settings socket; never edit the
// document by hand while the site runs: the running copy is kept in memory.
const Setting = mongoose.Schema({
    trading_state: {
        type: Number,
        default: 1
    }, // 0 = trading paused, 1 = trading on
    min_item_key: {
        type: Number,
        default: 0
    },
    max_item_key: {
        type: Number,
        default: 20
    },
    item_blacklist: {
        type: Array,
        default: []
    },
    announcement: {
        type: Object,
        default: { enabled: false, text: '', level: 'info' }
    }, // banner at the top of every page
    reviews: {
        type: Object,
        default: { enabled: true, trustpilot_url: 'https://www.trustpilot.com/review/tf2deal.com' }
    }, // star rating after an accepted trade; 4-5 stars get a link to Trustpilot
    extra: {
        type: Object,
        default: {}
    }, // free key/value settings for other apps (bot server, item server, ...)
    version: {
        type: Number,
        default: 0
    }, // +1 on every change
    updated: {
        type: Number,
        default: 0
    },
    updated_by: {
        type: String,
        default: ''
    },
    index: {
        type: String,
        required: true,
        default: "0"
    }
}, { minimize: false })

export const setting_model = mongoose.model('setting', Setting);
