const mongoose = require('mongoose');

// create db_index in format: ''
const Instance = mongoose.Schema({
    index: {
        type: Number,
        required: true
    },
    status: { // 1 = active, 0 = inactive 
        type: Number,
        required: true
    },
    bptf_can_list: {
        type: Boolean, 
        default: false
    },
    bp_sku: { type: String },
    steam_sku: { type: String },
    nameid: { type: String, default: 'false' },
    name: { type: String }, // default name (sug name) => use to find similar items
    qualityID: { type: String },
    grade: { type: String, default: 'false'},
    effectID: { type: Number },
    defindex: { type: Array }, // array 
    craftable: { type: String },
    type: { type: String }, // string
    classes: { type: Array, default: [] }, // string 
    buy_orders: { 
        type: Number, default: 0 
    },
    sell_orders: { 
        type: Number, default: 0
    }, 
    bptf_price: { type: Object, default: {key: 0, metal: 0, scrap: 0} },
    key_price: { type: String, required: true },
    buy: {
        type: Object,
        default: {
            key: 0,
            metal: 0,
            scrap: 0
        }
    },
    sell: {
        type: Object,
        default: {
            key: 0,
            metal: 0,
            scrap: 0
        }
    }, 
    stock: {
        type: Object,
        default: {
            cur: 0,
            limit: 1
        }
    }, /* global for all ks-versions (every ks has it's limitations) */
    killstreak: { // used for weapons in form { ks_tier, buy, sell, stock }
        type: Array,
        default: []
    },
    bp_sell_listing: { // if listed => value is bot name
        type: Array,
        default: []
    },
    bp_buy_listing: { // if listed => value is bot name
        type: Array,
        default: []
    },
    price_history: { 
        type: Array,
        default: []
    },
    image: {
        type: String,
        required: true
    },
    image_large:{
        type: String,
        required: true
    },
    image_missing: {
        type: Boolean,
        required: true
    },
    priced: {
        type: Number,
        default: 0
    },
    updated: {
        type: Number,
        required: true
    },
    created: {
        type: Number,
        required: true
    }
})

module.exports = mongoose.model('item_instances', Instance);    