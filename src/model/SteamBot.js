import mongoose from "mongoose";

// bot_manager's bot accounts (its src/models/SteamBot.js, same collection and fields). The admin panel reads, adds and
// deletes them here (service/bot_accounts.js). password, sharedSecret, identitySecret, bptf_key and bptf_token are
// encrypted with PASSWORD from .env (service/bot_accounts.js → encrypt), the same way bot_manager does.
const Bot = mongoose.Schema({
    status: { type: String, default: 'pending' }, // pending | active | disabled (not logged in, not started on restart)
    id: { type: Number, required: true },
    accountName: { type: String, required: true },
    password: { type: String, required: true },
    type: { type: String, required: true }, // trade | warehouse
    sharedSecret: { type: String, required: true },
    identitySecret: { type: String, required: true },
    bptf_key: { type: String, default: '' },
    bptf_token: { type: String, default: '' },
    profileName: { type: String, default: '' },
    accountTradeURL: { type: String, default: '' },
    accountSteamid: { type: String, default: '' },
    accountCreated: { type: Number, default: 0 },
    accountLevel: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    disabledAt: { type: Number, default: 0 },
    disabledBy: { type: String, default: '' },
    pausedByDisable: { type: Boolean, default: false }
}, { collection: 'steam_bots' })

export const bot_account_model = mongoose.model('Steam_bots', Bot);
