import mongoose from "mongoose";

const Blog = mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    slug: { // url: /blog/<slug>
        type: String,
        required: true,
        unique: true
    },
    cover: { // image url
        type: String,
        default: ''
    },
    excerpt: { // short text for the blog list
        type: String,
        default: ''
    },
    content: { // Markdown with layout blocks (public/js/blog_format.js), rendered by service/blog_render.js
        type: String,
        required: true
    },
    // how the page is laid out: standard (text column), feature (big cover on top, larger title, the excerpt as an
    // intro) or guide (a contents list beside the text, from the headings)
    layout: { type: String, default: 'standard' },
    // search results and shares; empty = made from the title and the excerpt / text (routes/router.js blog_page)
    seo_title: { type: String, default: '' },
    seo_description: { type: String, default: '' },
    published: {
        type: Boolean,
        default: false
    },
    // AI translations (service/translate.js): written in `lang`, translated into the other site languages
    lang: { type: String, default: 'en' },
    source_hash: { type: String, default: '' }, // fingerprint of the current text; translations with another one are outdated
    translations: { type: mongoose.Schema.Types.Mixed, default: {} }, // { de: { <fields>, hash, model, updated }, ... }
    translation_errors: { type: mongoose.Schema.Types.Mixed, default: {} }, // { de: 'error message' }
    updated: {
        type: Number,
        required: true
    },
    created: {
        type: Number,
        required: true
    }
})

export const blog_model = mongoose.model('blogs', Blog);
