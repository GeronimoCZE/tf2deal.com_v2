import mongoose from "mongoose";

// One item copy the bots sold, and what they paid for it when that is known (service/flips.js writes these,
// Admin -> Flips reads them). Prices as the items were priced: keys + ref, each at its own trade's key price.
const Flip = mongoose.Schema({
    _id: { type: String },                        // the sold copy's asset id: Steam gives a copy a new one in every trade
    bp_sku: { type: String, default: '' },
    ks: { type: Number, default: 0 },             // killstreak tier
    f: { type: Number, default: 0 },              // 1: festivized
    bot: { type: String, default: '' },           // the bot that sold it
    trade: { type: String, default: '' },         // the sale's trade (offer) id
    sold_at: { type: Number, required: true },    // ms
    key: { type: Number, default: 0 },            // ref per key at the sale
    sell_keys: { type: Number, default: 0 },      // what it sold for
    sell_metal: { type: Number, default: 0 },
    cost_keys: { type: Number, default: null },   // what the bots paid (null: not known)
    cost_metal: { type: Number, default: null },
    cost_key: { type: Number, default: 0 },       // ref per key when it was bought
    bought_at: { type: Number, default: 0 },
    // where the bought price comes from: 'paid' (the bot server's record of what it paid for that very copy),
    // 'trade' (the oldest saved purchase of the same item not matched yet: an estimate), '' (not known)
    source: { type: String, default: '' },
    buy_trade: { type: String, default: '' },     // the purchase's trade (offer) id, when known
    buy_a: { type: String, default: '' }          // the copy's asset id in that purchase ('trade' only)
}, { versionKey: false })

Flip.index({ sold_at: -1 });
Flip.index({ buy_trade: 1 });

export const flip_model = mongoose.model('flips', Flip);
