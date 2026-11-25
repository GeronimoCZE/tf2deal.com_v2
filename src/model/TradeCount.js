import mongoose from "mongoose";

// The home page's "total trades" (service/stats.js trades_total). The bot server deletes saved trades after 3 weeks
// (bot_manager TRADE_KEEP_DAYS), so counting the `trades` collection made the total go down every night. Instead the
// trades of every finished day are added here once, while they are still in the collection, and never counted again.
//
// One document, _id 'trades_total':
//   frozen_until  ms, a UTC midnight: every trade before it is in `frozen`
//   frozen        how many trades (not between our own bots) were made before frozen_until
//   seeded_from   how the first number was made (for the logs / anyone looking at the database)
// To add trades the counter can't know about, raise `frozen` in MongoDB:
//   db.trade_counts.updateOne({ _id: 'trades_total' }, { $inc: { frozen: 1234 } })
const TradeCount = mongoose.Schema({
    _id: { type: String },
    frozen_until: { type: Number, default: 0 },
    frozen: { type: Number, default: 0 },
    seeded_from: { type: Object }
}, { versionKey: false })

export const trade_count_model = mongoose.model('trade_counts', TradeCount);
