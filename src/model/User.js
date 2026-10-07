import mongoose from 'mongoose'

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
    group_member: {
        type: Boolean,
        default: false
    },
    wishlist: {
        type: [String],
        validate: {
          validator: function (v) {
            return v.length <= 10; // Limit the array to a maximum of 10 items
          },
        },
        default: []
    },
    notifications_seen: {
        type: Number,
        default: 0
    }, // unix ms: the bell counts notifications newer than this
    loyal_user: {
        type: Boolean,
        default: false
    },
    firstlogin: {
        type: Number,
        required: true
    } // unix timestamp
})

export default mongoose.model('Users', UserScheme);