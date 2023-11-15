const mongoose = require('mongoose');

const Pure = mongoose.Schema({
    name: {
        type: String
    },
    metal: {
        type: String
    },
    usd: {
        type: String
    },
    update: {
        type: String
    }
})

module.exports = mongoose.model('pure', Pure);