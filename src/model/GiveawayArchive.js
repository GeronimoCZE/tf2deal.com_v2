import mongoose from "mongoose";

// One record per concluded giveaway (service/giveaway.js conclude()): what was given away, who won, who entered and
// how the prize reached the winner. Written when the winner is drawn (or the giveaway is cancelled) and updated as
// the bank bot's offer goes on. The giveaways collection keeps the giveaway itself for the site's pages.
const GiveawayArchive = mongoose.Schema({
    giveaway: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    status: { type: String, default: 'ended' },  // ended | cancelled
    item: { type: mongoose.Schema.Types.Mixed, default: {} },
    description: { type: String, default: '' },
    requirements: { type: mongoose.Schema.Types.Mixed, default: {} },
    start: { type: Number, default: 0 },
    end: { type: Number, default: 0 },
    entry_count: { type: Number, default: 0 },
    entrants: { type: [String], default: [] }, // every entrant's steamid
    winner: { type: mongoose.Schema.Types.Mixed, default: null }, // { steamid, name, avatar, entered, drawn, tradelink }
    skipped: { type: Number, default: 0 },     // drawn entries that had left the Steam group
    prize: { type: mongoose.Schema.Types.Mixed, default: null },
    prize_sent: { type: Boolean, default: false },
    concluded: { type: Number, required: true },
    updated: { type: Number, default: 0 }
})

GiveawayArchive.index({ concluded: -1 });

export const giveaway_archive_model = mongoose.model('giveaway_archive', GiveawayArchive, 'giveaway_archive');
