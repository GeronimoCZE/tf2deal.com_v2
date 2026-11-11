import mongoose from "mongoose";

// What one copy the bots held looked like: its paint, spells, strange parts, killstreaker, sheen, custom name and
// Steam picture (service/copy_details.js writes these from the bots' stock). Saved trades only name a copy by its asset
// id, and once the bots trade a copy away it is gone from their stock, so "Latest trades" and Profile -> Trades read the
// details from here. Removed 60 days after they were last seen.
const CopyDetail = mongoose.Schema({
    _id: { type: String },                        // the copy's asset id
    at: { type: Object, default: {} },            // as bot_manager keeps it: killstreaker, sheen, paint, spells, strangeParts, customName, customDesc
    icon_url: { type: String, default: '' },      // Steam's own picture of a painted or festivized copy
    seen: { type: Date, default: Date.now }
}, { versionKey: false })

CopyDetail.index({ seen: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const copy_detail_model = mongoose.model('copy_details', CopyDetail);
