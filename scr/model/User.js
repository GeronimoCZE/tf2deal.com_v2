const mongoose = require('mongoose');

const UserScheme = mongoose.Schema({
    steamid: {
        type: String,
        required: true
    },
    tradelink: {
        type: String,
        default: ""
    },
    trades: {
        type: Number,
        required: true,
        default: 0
    },
    giveaways: {
        type: Object,
        required: true,
        default: {entries: 0, won: 0}
    },
    bonus: {
        type: String,
        required: true,
        default: 'null'
    },
    role: {
        type: Number,
        required: true,
        default: 1
    }, // 0=banned, 1=user, 2=premium, 3=admin
    email: {
        type: String,
        default: ""
    },
    firstlogin: {
        type: Number,
        required: true
    } // unix timestamp
})

module.exports = mongoose.model('Users', UserScheme);