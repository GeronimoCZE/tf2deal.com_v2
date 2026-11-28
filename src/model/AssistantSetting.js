import mongoose from "mongoose";

// The chat helper's settings and today's usage (service/assistant.js), one document (_id 'assistant'). Kept apart from
// the live site settings (model/SiteSetting.js) on purpose: those go out to every app on the /settings socket, and
// this one holds the API key. Change it in the admin panel (Chat helper), never by hand while the site runs.
const AssistantSetting = mongoose.Schema({
    _id: { type: String },
    enabled: { type: Boolean, default: false },      // the chat button on every page
    model: { type: String, default: '' },            // a Claude model id from service/assistant.js MODELS
    effort: { type: String, default: '' },           // low | medium | high: how long the model thinks per answer
    daily_limit: { type: Number, default: 0 },       // answers a day for the whole site; 0 = the default
    key_enc: { type: String, default: '' },          // the Claude API key from the admin panel, encrypted with SESSION_SECRET
    key_hint: { type: String, default: '' },         // its last 4 characters, to tell keys apart
    key_set: { type: Number, default: 0 },           // when it was saved (ms)
    usage: { type: mongoose.Schema.Types.Mixed, default: {} },  // today's numbers: { day, answers, calls, tokens, cost, events }
    days: { type: Array, default: [] },              // the last 30 days: [{ day, answers, cost, blocked }]
    updated: { type: Number, default: 0 },
    updated_by: { type: String, default: '' }
}, { versionKey: false, minimize: false })

export const assistant_setting_model = mongoose.model('assistant_settings', AssistantSetting);
