function user_cookie (steamid, user_db, trade_offer){
    const user_cookie_setting = {
        httpOnly: true, maxAge: Date.now(2147483647 * 1000), secure: true
    };
  
    const cookie = {
        name: `td_${steamid}`,
        value: {user: user_db, trade_offer: trade_offer},
        setting: user_cookie_setting
    };
  
    return cookie;
  }

function trade_offer_obj(trade_id){
    return({id: trade_id})
}

function remove_TradeOfferObj(req, res, trade_id){
    
}

module.exports = {
    user_cookie, trade_offer_obj
}