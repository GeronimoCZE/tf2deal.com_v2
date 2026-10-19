import mongoose from "mongoose";

// Backpack.tf listings made by hand in the admin panel (Listings), for one bot. The bot server lists them and keeps
// them up (it gets the whole list on `listings:manual`, see docs/LISTINGS.md); the listing rules don't apply to them.
// A listing deleted here is taken down by the bot server.
const ManualListing = mongoose.Schema({
    bot: { type: String, required: true },          // the bot's steamid
    intent: { type: String, required: true },       // buy | sell
    bp_sku: { type: String, required: true },       // item_instances.bp_sku
    ks: { type: Number, default: 0 },               // buy listings of weapons: killstreak tier 0-3
    assetid: { type: String, default: '' },         // sell listings: the copy the bot sells
    price: { type: Object, required: true },        // { keys, metal }
    details: { type: String, default: '' },         // listing text on backpack.tf ('' = the bot's usual text)
    status: { type: String, default: 'pending' },   // pending (not confirmed by the bot server yet) | listed | failed
    listing_id: { type: String, default: '' },      // backpack.tf listing id, once listed
    error: { type: String, default: '' },           // why the bot server could not list it
    created: { type: Number, required: true },
    created_by: { type: String, default: '' },
    updated: { type: Number, required: true }
})

ManualListing.index({ bot: 1, intent: 1, bp_sku: 1 });

export const manual_listing_model = mongoose.model('manual_listings', ManualListing);
