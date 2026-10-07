import mongoose from "mongoose";

// create db_index in format: ''
const Inventory = mongoose.Schema({
    steamid: {
        type: String,
        required: true
    },
    updated: {
        type: Number,
        required: true
    },
    inventory: {
        type: Object,
        default: { 
            total: 0,
            slots: 0,
            items: [],
            keys: [],
            ref: [],
            rec: [],
            scrap: [],
            nontradable_items: []
        }
    }
})

export const inventory_model = mongoose.model('inventories', Inventory);    