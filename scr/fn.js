const SteamID = require('steamid');

const res_data = (auth, user, user_db, title, info, datas) => {
    const data = {key_price: key_price, data: datas};

    const obj = {
        user: user,
        data: data,
        title: title,
        info: info
    }

    if(!info){
        obj.info = {view: undefined, message: ''}
        if(tradeStatus != ''){
            obj.info = {view: undefined, message: tradeStatus}
        }
    } 
    else{
        if(!obj.info.view){
            obj.info.view = undefined
        }
        if(tradeStatus != ''){
            obj.info.message = tradeStatus
        }
    }
    if(auth == true){
        let sid = new SteamID(user.steamid);
        if(user_db == undefined){
            user_db = {user: {tradelink: '', role: 1, email: '', firstlogin: '', accountid: '', trades: 0, giveaways: {entries:0, won: 0}}, trade_offer: {}}
            user_db.user.accountid = sid.accountid
            obj.user_db = user_db;
            return obj
        } else {
            if(user_db.user == null){
                user_db.user = {tradelink: '', role: 1, email: '', firstlogin: '', accountid: '', trades: 0, giveaways: {entries:0, won: 0}}
            }
            user_db.user.accountid = sid.accountid
            obj.user_db = user_db;
            return obj
        }
    }
    else{
        return obj
    }
}

function user_cookie (steamid, user_db, trade_offer){
    const user_cookie_setting = {
        httpOnly: true, maxAge: Date.now(2147483647 * 1000), secure: true
    };
  
    const cookie = {
        name: `td_${steamid}`,
        value: {user: user_db, trade_offer: trade_offer, update: (Date.now() + 1000*60*60*24)},
        setting: user_cookie_setting
    };
  
    return cookie;
  }

  function trade_offer_obj(trade_id, trade_url){
    return({id: trade_id, url: trade_url})
}   

const round_ref = (refs) => {
    let ref = Math.trunc(refs);
    let ref_float = refs - Math.trunc(refs);
    ref_float = parseFloat((ref_float).toFixed(5))
    
    const float = [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 1].reduce((a, b) => {
        return Math.abs(b - ref_float) < Math.abs(a - ref_float) ? b : a;
    });
    return (ref + float)
}

async function update_pure(){
    const fetch = require('node-fetch')
    const Pure = require('./model/dev/_pure')
    const Key = await Pure.find({name: "Mann Co. Supply Crate Key"})

    fetch('http://46.101.135.110/prices')
     .then(res => res.json())
     .then(async(res) => {
        if(res?.response.success == 1){
            let key_value = Object.values(res.response.items)[Object.keys(res.response.items).indexOf("Mann Co. Supply Crate Key")].prices['6'].Tradable['Craftable'][0].value_raw
            if(key_value != undefined){
                key_value = key_value.toString()
                if(key_value.includes('.')){
                    key_value = Math.trunc(parseFloat(key_value)) + '.' + key_value.slice(key_value.indexOf('.') + 1).slice(0,2)
                } 
                key_value = parseFloat(key_value)
                key_price.metal = key_value
                try{
                    let updated = await Pure.findOneAndUpdate({name: "Mann Co. Supply Crate Key"}, {metal: key_value, usd: "2.00", update: Date.now().toString()}, { new: true, useFindAndModify: false })
                    console.log(updated)
                } catch { console.log(key_value) }
            } else {
                if(Key != undefined){
                    key_price.metal = Key.metal
                }
            }
        } else {
            if(Key != undefined){
                key_price.metal = Key.metal
            }
        }
     })
}

async function setup_cache () {
    const config = require('./config/config.json')

    await require('./model/dev/_itemParticle').find((err, data) => { if (err == null) { config.unusual_particles = data }})
    await require('./model/dev/_itemWarpaints').find((err, data) => { if (err == null) { config.warpaints = data }})
    await require('./model/dev/_itemSkins').find((err, data) => { if (err == null) { config.skins = data ;}})
}

async function item_check () {
    // checks if our bots own specific item, if yes return item and Bot owner
}

async function update_bot_inv () {
    // adds or remove items from bot's inv
}

module.exports = {
    res_data, user_cookie, trade_offer_obj,
    round_ref, update_pure, setup_cache
}