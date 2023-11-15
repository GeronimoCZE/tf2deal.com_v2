const mongoose = require('mongoose');

const UnusualEffect = mongoose.Schema({
    ID: {
        type: String
    },
    name: {
        type: String
    },
    active: {
        type: String,
        default: "true"
    }
})

module.exports = mongoose.model('Unusual_Effects', UnusualEffect);