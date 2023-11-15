const mongoose = require('mongoose');

const Skin = mongoose.Schema({
    name: {
        type: String
    },
    grade: {
        type: String
    }
})

module.exports = mongoose.model('weaponSkins', Skin);