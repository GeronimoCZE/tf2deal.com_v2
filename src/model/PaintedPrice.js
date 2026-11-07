import mongoose from "mongoose";

// Painted cosmetics with a price of their own. item_manager writes them (utils/painted.js, models/PaintedPrice.js):
// a cosmetic with 2+ backpack.tf buy orders for one paint gets that paint's own buy / sell. The site only reads them
// (service/painted.js). One document per item and paint; prices in ref at key_price.
const PaintedPrice = mongoose.Schema({
    bp_sku: { type: String, required: true },       // the clean item, e.g. "Team Captain"
    paint: { type: String, required: true },        // e.g. "Australium Gold"
    paint_value: { type: Number, default: null },
    status: { type: Number, default: 1 },           // 1 = priced; -1 = no own price now
    buy: { type: Number, default: null },
    sell: { type: Number, default: null },
    sell_from: { type: String, default: null },     // 'sellers' or 'margin'
    key_price: { type: Number, default: null },
    buyorders: { type: Number, default: 0 },
    sellorders: { type: Number, default: 0 },
    highest_buy: { type: Number, default: 0 },
    lowest_sell: { type: Number, default: 0 },
    listable: { type: Boolean, default: false },
    stock_limit: { type: Number, default: 0 },      // most copies with this paint the bots hold
    updated: { type: Number, default: 0 }
}, { versionKey: false, collection: 'painted_prices' });

export const painted_price_model = mongoose.model('painted_prices', PaintedPrice);
