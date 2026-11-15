import mongoose from "mongoose";

// When a feature of the site's news list (service/news.js) went live: the first time the site ran with its entry out
// (service/news_times.js). The updates page (/news) shows it; it never changes once written.
const NewsTime = mongoose.Schema({
    _id: { type: String },                 // the entry's key
    live_at: { type: Number, default: 0 }  // ms
}, { versionKey: false })

export const news_time_model = mongoose.model('news_times', NewsTime);
