import mongoose from "mongoose";

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
    bptf_data: {
        type: Object,
        default: {
            sellorders: 0,
            buyorders: 0,
            lowest_sell: "0",
            highest_buy: "0",
            quicksell: null,
            listable: false,
            price: "0",
            key_price: "0",
            priced: 0,
            update_key_price: 0,
            quicksell: null
        }
    },
    bptf_listings: {
        type: Object,
        default: {
            active: false,
            sellorders: [],
            buyorders: []
        }
    },
    bp_sku: { type: String },
    steam_sku: { type: String },
    nameid: { type: String, default: 'false' },
    name: { type: String }, // default name (sug name) => use to find similar items
    qualityID: { type: String },
    grade: { type: String, default: 'false'},
    effectID: { type: Number },
    defindex: { type: Array }, // array 
    priceindex: { type: Number, default: 0 },
    craftable: { type: String },
    type: { type: String }, // string
    classes: { type: Array, default: [] }, // string
    buy: {
        type: Number,
        default: 0
    },
    sell: {
        type: Number,
        default: 0
    }, 
    stock: {
        type: Object,
        default: {
            cur: 0,
            limit: 1,
            items: []
        }
    }, /* global for all ks-versions (every ks has it's limitations) */
    killstreak: { // used for weapons in form { ks_tier, buy, sell, stock }
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
    updated: {
        type: Number,
        required: true
    },
    created: {
        type: Number,
        required: true
    }
})

Instance.index({ bp_sku: 1 });

export const item_model = mongoose.model('item_instances', Instance);    