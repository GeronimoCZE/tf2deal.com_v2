import mongoose from "mongoose";

// Star ratings users give after an accepted trade (the rating box in the trade offer modal).
// One per user and trade offer: rating the same offer again replaces it.
const Rating = mongoose.Schema({
    steamid: { type: String, required: true },
    name: { type: String, default: '' },          // steam name when they rated
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },       // optional, up to 500 characters
    offer_id: { type: String, default: '' },      // steam trade offer id, when the browser knew it
    verified: { type: Boolean, default: false },  // the user has a finished trade in the trades collection
    lang: { type: String, default: 'en' },
    trustpilot: { type: Boolean, default: false },// they clicked through to Trustpilot
    created: { type: Number, required: true },
    updated: { type: Number, required: true }
})

Rating.index({ steamid: 1, offer_id: 1 });
Rating.index({ created: -1 });

export const rating_model = mongoose.model('ratings', Rating);
