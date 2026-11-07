import mongoose from "mongoose";

// Versions of an item with a price of their own. item_manager writes them (utils/variants.js, models/VariantPrice.js):
// a painted cosmetic (kind 'paint'), an item with one spell ('spell') or a festivized weapon ('festivized') with 2+
// backpack.tf buy orders for that version. The site only reads them (service/variants.js). One document per item, kind
// and name; prices in ref at key_price.
const VariantPrice = mongoose.Schema({
    bp_sku: { type: String, required: true },       // the clean item, e.g. "Team Captain"
    kind: { type: String, required: true },         // 'paint' | 'spell' | 'festivized'
    name: { type: String, required: true },         // "Australium Gold", "Exorcism", "Festivized"
    attr_defindex: { type: Number, default: null },
    attr_value: { type: Number, default: null },
    status: { type: Number, default: 1 },           // 1 = priced; -1 = no own price now
    buy: { type: Number, default: null },
    sell: { type: Number, default: null },
    sell_from: { type: String, default: null },     // 'sellers' or 'margin'
    key_price: { type: Number, default: null },
    buyorders: { type: Number, default: 0 },
    total_buyorders: { type: Number, default: 0 },
    sellorders: { type: Number, default: 0 },
    highest_buy: { type: Number, default: 0 },
    lowest_sell: { type: Number, default: 0 },
    listable: { type: Boolean, default: false },
    stock_limit: { type: Number, default: 0 },      // most copies of this version the bots hold (spells: 0)
    updated: { type: Number, default: 0 }
}, { versionKey: false, collection: 'variant_prices' });

export const variant_price_model = mongoose.model('variant_prices', VariantPrice);
