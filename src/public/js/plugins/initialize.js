import {lang_suggest} from "./language.js";
import * as popUp from "./window_form.js";

const init = () => {
    /* set user setting, if any */

    // the look's classes come on <body> from the server (season_class, and .lamplight for the normal look): only add
    // the season here, never replace the list
    String(session || '').split(' ').filter(Boolean).forEach((name) => document.body.classList.add(name));

    lang_suggest();

    if(user != 'no_session'){
        if(trade_offer != ``){
            
        }
    }
};

export {init};