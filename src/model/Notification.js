import mongoose from "mongoose";

// The bell in the nav (js/plugins/notifications.js). `to: null` goes to everyone, guests included;
// otherwise only to that steamid. The text is built in the browser from `type` + `vars`, so it shows in
// the visitor's language; only admin announcements carry their own `text`.
const Notification = mongoose.Schema({
    to: { type: String, default: null },          // steamid, or null = everyone
    type: { type: String, required: true },       // announcement | giveaway_new | giveaway_ended | giveaway_won | ticket_reply
    vars: { type: mongoose.Schema.Types.Mixed, default: {} }, // { item, winner, title }
    text: { type: String, default: '' },          // announcements only
    link: { type: String, default: '' },          // site path, e.g. /giveaway
    created: { type: Number, required: true }
})

Notification.index({ to: 1, created: -1 });

export const notification_model = mongoose.model('notifications', Notification);
