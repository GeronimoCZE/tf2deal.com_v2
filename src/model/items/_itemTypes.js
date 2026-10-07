const mongoose = require('mongoose');

const TypeLimit = mongoose.Schema({
    qualityID: {
        type: String, required: true
    },
    elevated_qualityID: {
        type: Boolean, required: true
    },
    type: {
        type: String, required: true
    },
    priceClass: {
        type: String, required: true
    },
    count: {
        type: Number, default: 0
    },
    stock: {
        type: Object,
        default: { cur: 0, total_limit: 0, global_limit: 10 }
    },
    weight: {
        type: Number,
        validate: {
            validator: function (v) {
                return 0 <= v && v <= 1000; // Limit the array to a maximum of 10 items
            },
        },
        default: 1
    },
    updated: { type: Number, default: 0 }
})

module.exports = mongoose.model('item_types_limit', TypeLimit);