const mongoose = require('mongoose');

const TradeScheme = mongoose.Schema({
    id: {}, 
    timestamp: {},
    partner: {}, // steamid
    partner_items: {}, // array of objects {name: "Strange Shotgun", quantity: 1}
    site_items: {} 
})

module.exports = mongoose.model('Trades', TradeScheme);