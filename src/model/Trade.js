import mongoose from 'mongoose';

const Trade = mongoose.Schema({
    id: { type: Number, required: true },
    tradeID: { type: String, required: true },
    partnerSteamID: { type: String, required: true },
    internalTrade: { type: Boolean, default: false },
    itemsToReceive: { type: Array, default: [] },
    itemsToGive: { type: Array, default: [] },
    trade_value: { type: Object, default: { key: 0, metal: 0 }},
    bot: { type: String, required: true },
    timestamp: { type: Number, required: true },
    // a key bank swap (bot_manager bot/keyBank.js: keys for metal with a bank bot, /keys): in the trader's own trade
    // history, never in "Latest trades"
    keyBank: { type: Boolean }
})

Trade.index({ partnerSteamID: 1, timestamp: -1 });
Trade.index({ timestamp: -1 }); // latest trades and the "trades today" count

export const trade_model = mongoose.model('trades', Trade);