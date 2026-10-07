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

const socketCallback = (onSuccess, onTimeout, timeout) => {
    let called = false;
  
    const timer = setTimeout(() => {
      if (called) return;
      called = true;
      onTimeout();
    }, timeout);
  
    return (...args) => {
      if (called) return;
      called = true;
      clearTimeout(timer);
      onSuccess.apply(this, args);
    }
}

export {
    user_cookie, socketCallback
}