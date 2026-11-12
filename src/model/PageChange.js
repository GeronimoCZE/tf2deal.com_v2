import mongoose from "mongoose";

// When an item page last changed what it shows (service/page_changes.js): the sitemap's <lastmod> for it, and kept
// across restarts so a restart doesn't make every item page look changed.
const PageChange = mongoose.Schema({
    _id: { type: String },                // the page's item name (bp_sku), as in /items/<name>
    sig: { type: String, default: '' },   // what the page shows, in short: buy|sell|stock|status
    changed: { type: Number, default: 0 } // when that last changed (ms); 0 = not seen changing yet
}, { versionKey: false })

export const page_change_model = mongoose.model('page_changes', PageChange);
