const mongoose = require('mongoose');

// create db_index in format: ''
const Instance = mongoose.Schema({
    bp_sku: {
        type: String
    },
    steam_sku: {
        type: String
    },
    params: {
        type: Object,
        default: {
            name: '', // default name (sug name)
            craftable: '-1',

            type: '', // string
            classes: '', // string
            defindex: [] // array        
        }
    },
    stock: {
        type: Object,
        default: {
            current: 0,
            limit: 3
        }
    }, 
    sell: {
        type: Object,
        default: {
            keys: 0,
            metal: 0
        }
    }, 
    buy: {
        type: Object,
        default: {
            keys: 0,
            metal: 0
        }
    },
    image: {
        type: String,
        required: true
    },
    method: {
        type: String, 
        required: true
    },
    update: {
        type: Number,
        required: true
    }
})

module.exports = mongoose.model('item_instances', Instance);