const mongoose = require('mongoose');

const Warpaint = mongoose.Schema({
    name: {
        type: String
    },
    grade: {
        type: String
    }
})

module.exports = mongoose.model('weaponWarpaints', Warpaint);