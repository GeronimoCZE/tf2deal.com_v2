import mongoose from "mongoose";

// What all the bots held at one moment (service/inventory_value.js measures it every 15 minutes): their item copies
// at the prices of that moment, plus their keys and metal. Values in ref. Admin -> Inventory value compares two of them.
const InventoryValue = mongoose.Schema({
    t: { type: Number, required: true },        // when (ms)
    key_price: { type: Number, default: 0 },    // ref per key at that time
    keys: { type: Number, default: 0 },         // keys of all bots
    metal: { type: Number, default: 0 },        // refined + reclaimed + scrap of all bots, in ref
    items: {                                    // item copies of all bots: how many and what they're worth
        type: Object,
        default: { count: 0, sell: 0, buy: 0, unpriced: 0 }
    },
    bots: { type: Object, default: {} }         // { steamid: { count, sell, buy } }: the items per bot
})

InventoryValue.index({ t: 1 });

export const inventory_value_model = mongoose.model('inventory_values', InventoryValue);
