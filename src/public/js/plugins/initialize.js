import {lang_suggest} from "./language.js";
import * as popUp from "./window_form.js";

const init = () => {
    /* set user setting, if any */

    document.body.setAttribute('class', session);

    lang_suggest();

    if(user != 'no_session'){
        if(user_tradeurl == ``){
            // popUp.new_user('show')
        }
        if(trade_offer != ``){
            
        }
    }
};

export {init};