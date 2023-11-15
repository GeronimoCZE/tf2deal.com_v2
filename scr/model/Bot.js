const mongoose = require('mongoose');

const BotScheme = mongoose.Schema({
    type: {
        type: String,
        required: true
    }, // = trade / warhouse
    id: {
        type: String,
        required: true
    }, // id = length of bots with this type + 1
    steamid: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    identitySecret: {
        type: String,
        required: true
    },
    sharedSecret: {
        type: String,
        required: true
    },
    created: {
        type: String,
        required: true
    }, // unix timestamp
    inventory_slots: {
        type: String,
        required: true
    }
})

module.exports = mongoose.model('Bots', BotScheme);