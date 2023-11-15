import * as main from '../main.js'
import * as popUp from './window_form.js'

class Trade_Object {
    constructor() {
      this.inventory = null;
      this.pure = null;
      this.iit = { 
        total: {key: 0, ref: 0}, 
        pure: {key: 0, ref: 0, rec: 0, scrap: 0}, 
        pureAssets: {key: [], ref: [], rec: [], scrap: []},
        items: [] 
      };
    }
}

const UserTrade = new Trade_Object(); // => save both invs in localstorage for Trade Created page (display traded items)
const SiteTrade = new Trade_Object();

// use this for item interaction
// in case user changes DOM (compare all item el attributes with item object and find a possible match)

const mutationObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if(mutation.type === "attributes"){
        if(mutation.attributeName.includes('data-')){
            if(mutation.attributeName.includes('data-count')){ return false; }
            let timeoutSettings = {
                "async": true,
                "crossDomain": false,
                "url": '../api/trade_timeout',
                "method": "GET",
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer ",
                    "Accept": "*/*",
                }
            }
            $.ajax(timeoutSettings).done(function (response) {
                if(response == 'done'){
                    location.reload()
                }
                else{
                    window.location.href = '..//../'
                }
            });
        }
      }
    });
  });

  if(window.location.pathname == '/trade'){
    mutationObserver.observe(document.querySelector('.index-ps'), {
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
        childList: true
    });
  }

const load_site_inventory = async () => {
    let Settings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/bots/inventory',
        "method": "GET",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    $.ajax(Settings)
    .fail(async function (response){
        if(response.statusText == 'Too Many Requests'){
            iziToast.error({
                title: 'Error!',
                message: 'Too many requests!'
            });
        }
    })
    .done(async function (response) {
        // save response in FE and render it for 30sec -> then allow refresh
        if(await response != "error"){
            SiteTrade.inventory = response.items;
            SiteTrade.pure = response.pure;
            render_items('site', await response)
        }
        else{
            render_items('site', await response)
        }
    });
}

const load_user_inventory = async () => {
    let userSettings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/user/inventory',
        "method": "POST",
        "data": '',
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    $.ajax(userSettings)
    .fail(async function (res){ 
        iziToast.error({
            title: 'Error!',
            message: res.statusText
        });
    })
    .done(async function (response) {
        // save response in FE and render it for 30sec -> then allow refresh
        if(await response != "error"){
            UserTrade.inventory = response.items;
            UserTrade.pure = response.pure;
            UserTrade.pureAssets = response.pureAssets;
            render_items('user', await response)
            try{
                localStorage.setItem('user_inventory', JSON.stringify({nextRefresh: Date.now() + 30000, steamid: user, inventory: await response}))
            } catch{}
        }
        else{
            render_items('user', await response)
        }
    });
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

const render_items = async (party, items) => {

    let grid = $(`<div class='grid' id='${party}-grid'></div>`);
    let loading = $(`.loading-items#${party}-loading`);

    if(items == 'error'){
        $(`#${party}-item-grid`).empty()
        $(`#${party}-item-grid`).append(`<div class="inventory-message">Couldn't load your inventory. Try again later...</div>`)
        loading.addClass('hidden')
        return false;
    }

    const key_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ/330x192';
    const ref_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO1Mv6NGucF1Ygzt8ZQijJukFMiMrbhYDEwI1yRVKNfD6xorQ3qW3Jr6546DNPuou9IOVK4p4kWJaA/330x192'

    const pure = items.pure;
    const scrapRefs = round_ref(Number(pure.scrap) / 9)
    const recRefs = round_ref(Number(pure.rec) / 9)
    const refs_count = round_ref(pure.ref + recRefs + scrapRefs)
    const keys_count = pure.key
    const keys = $(`<div class="pure keys" data-quality="Unique" data-type="Pure" data-count="${keys_count}" data-name="Mann Co. Supply Crate Key"><img class="item-img" src="https://community.cloudflare.steamstatic.com/economy/image/${key_image}"><div class='pure-count'>${keys_count} x</div></div>`);
    const refs = $(`<div class="pure refs" data-quality="Unique" data-type="Pure" data-count="${refs_count}" data-name="Refined Metal"><img class="item-img" src="https://community.cloudflare.steamstatic.com/economy/image/${ref_image}"><div class='pure-count'>${Math.trunc(refs_count)} x</div></div>`);
    
    if(pure.ref == 0 && pure.key == 0 && items.length == 0){
        $(`#${party}-item-grid`).empty()
        $(`#${party}-item-grid`).append(`<div class="inventory-message">None of your items is tradable on our site. 😛</div>`)
        loading.addClass('hidden')
        return false;
    }

    grid.append([keys, refs])
    items = items.items;
    
    if(items.length == 0){
        // display items
        $(`#${party}-item-grid`).empty()
        $(`#${party}-item-grid`).append(grid)
        loading.addClass('hidden')
        reset_filters(party)
        return false;
    }
    const eff_arr = JSON.parse(localStorage.getItem('unusual_effects'))
    for (const [i,item] of items.entries()){
        if('name' in item){
            
            if(item.quality == 'Unusual'){
                let effect = null; let effect_id = null;
                try{
                    let effect_obj = item.description.find((obj) => obj.color === "ffd700");
                    effect = effect_obj.value.replace('★ Unusual Effect: ', '')
                    if(eff_arr != null && effect_obj != undefined){
                        effect_id = eff_arr.find((eff) => eff.name == effect).ID;
                    }
                } catch{ }
                if(effect == null || effect_id == null){                 
                    const item_el = $(`<div class="item q-${item.quality} c-${item.craftable}" data-assetid="${item.assetid}" data-quality="${item.quality}" data-name="${item.name}" data-type="${item.type}" data-keys="${item.keys}" data-refs="${item.refs}" data-tradable="${item.tradable}"><img class="item-img" src="https://community.cloudflare.steamstatic.com/economy/image/${item.image}/128x128" loading="lazy"></div>`)
                    grid.append(item_el) 
                }
                else{                 
                    const item_el = $(`<div class="item q-${item.quality} c-${item.craftable}" data-assetid="${item.assetid}" data-quality="${item.quality}" data-effect="${effect}" data-name="${item.name}" data-type="${item.type}" data-keys="${item.keys}" data-refs="${item.refs}" data-tradable="${item.tradable}"><img class="item-img" style='background-image: url("https://backpack.tf/images/440/particles/${effect_id}_94x94.png")' src="https://community.cloudflare.steamstatic.com/economy/image/${item.image}/128x128" loading="lazy"></div>`)
                    grid.append(item_el)
                 }
            } else {
                const item_el = $(`<div class="item q-${item.quality} c-${item.craftable}" data-assetid="${item.assetid}" data-quality="${item.quality}" data-name="${item.name}" data-type="${item.type}" data-keys="${item.keys}" data-refs="${item.refs}" data-tradable="${item.tradable}"><img class="item-img" src="https://community.cloudflare.steamstatic.com/economy/image/${item.image}/128x128" loading="lazy"></div>`)
                grid.append(item_el)
            }
        }
        else{
            
        }

        if(i === items.length - 1){
            // display items
            $(`#${party}-item-grid`).empty()
            // $('#user-item-grid').append(res_header)
            $(`#${party}-item-grid`).append(grid)
            loading.addClass('hidden')
            reset_filters(party)
            // set User item-order filter to "desc" by default
        }
    }
}

const item_to_trade = (party, action, item) => {
    document.querySelector('.btn.trade-btn').classList.remove('denied')
    const update_tt = (action, itemVal) => {
        if(action == 'add'){
            Trade.iit.total.key += itemVal.keys;
            if(Trade.iit.total.ref + itemVal.refs >= key_price){
                const xKeys = (Trade.iit.total.ref + itemVal.refs) / parseFloat(key_price)
                let refs = (Trade.iit.total.ref + itemVal.refs);
                Trade.iit.total.key += Math.trunc(xKeys)
                for (let i = 0; i < xKeys; i++) {
                    if(refs - key_price >= 0){
                        refs = round_ref(refs - key_price)
                    }
                }
                Trade.iit.total.ref = round_ref(refs)
            } else {
                Trade.iit.total.ref = round_ref(Trade.iit.total.ref + itemVal.refs)
            }
            
            document.querySelector(`#${party}-key-total`).textContent = Trade.iit.total.key;
            document.querySelector(`#${party}-ref-total`).textContent = Trade.iit.total.ref;
        }
        else if(action == 'remove'){
            // FIX
            Trade.iit.total.key -= itemVal.keys;
            if(Trade.iit.total.ref - itemVal.refs < 0){
                let ref_dif = Trade.iit.total.ref - itemVal.refs
                let x = 1
                ref_dif = ref_dif + parseFloat(key_price)
                if(ref_dif < 0){
                    x++
                    ref_dif = ref_dif + parseFloat(key_price)
                }
                ref_dif = parseFloat(ref_dif)

                Trade.iit.total.key -= x
                Trade.iit.total.ref = round_ref(ref_dif)
            } else {
                Trade.iit.total.ref = round_ref(Trade.iit.total.ref - itemVal.refs)
            }
            
            document.querySelector(`#${party}-key-total`).textContent = Trade.iit.total.key;
            document.querySelector(`#${party}-ref-total`).textContent = Trade.iit.total.ref;
        }
        const user_total = round_ref(round_ref(UserTrade.iit.total.key * parseFloat(key_price)) + UserTrade.iit.total.ref)
        const site_total = round_ref(round_ref(SiteTrade.iit.total.key * parseFloat(key_price)) + SiteTrade.iit.total.ref)
        if(user_total >= site_total && user_total != 0){
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.add('ready')
        } else{
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.remove('ready')
        }
        if(user_total > 0 || site_total > 0){
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.add('hide')
        } else {
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.remove('hide')    
        }
    }
    let Trade = undefined;
    switch (party) {
        case 'user':
            Trade = UserTrade; break;
        case 'site':
            Trade = SiteTrade; break;
        default: break;
    }
    if(action == 'add'){
        const itemASSET = item.getAttribute('data-assetid')
        const itemObj = Trade.inventory.find((item) => item.assetid == itemASSET);
        if(itemObj == undefined){ return false; }
        else { 
            Trade.iit.items.push(itemObj)
        }

        const itemEL = item.cloneNode(true);
        document.querySelector(`.items-in-trade .${party}-items`).appendChild(itemEL)
        item.classList.add('in-trade')
        
        update_tt('add', {keys: itemObj.keys, refs: itemObj.refs})
    }
    else if(action == 'remove') {
        const itemASSET = item.getAttribute('data-assetid');
        const itemKeys = item.getAttribute('data-keys');
        const itemRefs = item.getAttribute('data-refs');
        Trade.iit.items = Trade.iit.items.filter(item => item.assetid != itemASSET);

        item.remove()
        document.querySelector(`#${party}-item-grid .grid .item[data-assetid='${itemASSET}']`).classList.remove('in-trade');
        
        update_tt('remove', {keys: parseFloat(itemKeys), refs: parseFloat(itemRefs)})
    }
    // add pure to Trade ref_total

    if(Trade.iit.items.length == 0){
        document.querySelector(`#${party}-key-total`).textContent = 0;
        document.querySelector(`#${party}-ref-total`).textContent = "0.00";

    }
}

const pure_to_trade = (party, action, pure, amount) => {
    if(amount <= 0){ return false }

    const IIT_parent = document.querySelector(`.items-in-trade .${party}-items`)
    if(party == 'user'){
        if(action == 'add'){
            if(pure == 'keys'){
                updateKeys()
                if(IIT_parent.querySelector('.pure.keys')){
                    let pureEL = IIT_parent.querySelector('.pure.keys')
                    pureEL.querySelector('.pure-count').textContent = `${Number(pureEL.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(pureEL.getAttribute('data-count')) + Number(amount))
                } else {
                    let pureEL = document.querySelector(`.grid#${party}-grid .pure.keys`).cloneNode(true)
                    pureEL.querySelector('.pure-count').textContent = `${Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(amount))
                    IIT_parent.append(pureEL)
                }
            }
        }
        else if(action == 'remove'){
            if(pure == 'keys'){
                updateKeys()

                IIT_parent.querySelector('.pure.keys').remove()
            }
        }
    }
    if(party == 'site'){
        if(action == 'add'){
            if(pure == 'keys'){
                updateKeys()
                if(IIT_parent.querySelector('.pure.keys')){
                    let pureEL = IIT_parent.querySelector('.pure.keys')
                    pureEL.querySelector('.pure-count').textContent = `${Number(pureEL.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(pureEL.getAttribute('data-count')) + Number(amount))
                } else {
                    let pureEL = document.querySelector(`.grid#${party}-grid .pure.keys`).cloneNode(true)
                    pureEL.querySelector('.pure-count').textContent = `${Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(amount))
                    IIT_parent.append(pureEL)
                }
            }
            if(pure == 'refs'){

                if(IIT_parent.querySelector('.pure.refs')){
                    let pureEL = IIT_parent.querySelector('.pure.refs')
                    pureEL.querySelector('.pure-count').textContent = `${Number(pureEL.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(pureEL.getAttribute('data-count')) + Number(amount))
                } else {
                    let pureEL = document.querySelector(`.grid#${party}-grid .pure.refs`).cloneNode(true)
                    pureEL.querySelector('.pure-count').textContent = `${Number(amount)} x`;
                    pureEL.setAttribute('data-count', Number(amount))
                    IIT_parent.append(pureEL)
                }

            }
        }
        else if(action == 'remove'){
            if(pure == 'keys'){
                updateKeys()

                IIT_parent.querySelector('.pure.keys').remove()
            }
        }
    }

    function updateKeys (){
        if(party == 'user'){
            const keys = document.querySelector(`.grid#${party}-grid .pure.keys`)

            if(action == 'add'){
                UserTrade.iit.total.key += Number(amount);
                UserTrade.iit.pure.key += Number(amount);
                UserTrade.pure.key -= Number(amount);

                let finalCount = Number(keys.querySelector('.pure-count').textContent.replace(' x', '')) - Number(amount);
                keys.querySelector('.pure-count').textContent = `${finalCount} x`
                keys.setAttribute('data-count', finalCount)
            }
            else if(action == 'remove'){
                UserTrade.iit.total.key -= Number(amount);
                UserTrade.iit.pure.key -= Number(amount);
                UserTrade.pure.key += Number(amount);

                let finalCount = Number(keys.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount);
                keys.querySelector('.pure-count').textContent = `${finalCount} x`
                keys.setAttribute('data-count', finalCount)
            }

            document.querySelector(`#${party}-key-total`).textContent = UserTrade.iit.total.key;
        }
        if(party == 'site'){
            const keys = document.querySelector(`.grid#${party}-grid .pure.keys`)

            if(action == 'add'){
                SiteTrade.iit.total.key += Number(amount);
                SiteTrade.iit.pure.key += Number(amount);
                SiteTrade.pure.key -= Number(amount);

                let finalCount = Number(keys.querySelector('.pure-count').textContent.replace(' x', '')) - Number(amount);
                keys.querySelector('.pure-count').textContent = `${finalCount} x`
                keys.setAttribute('data-count', finalCount)
            }
            else if(action == 'remove'){
                SiteTrade.iit.total.key -= Number(amount);
                SiteTrade.iit.pure.key -= Number(amount);
                SiteTrade.pure.key += Number(amount);

                let finalCount = Number(keys.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount);
                keys.querySelector('.pure-count').textContent = `${finalCount} x`
                keys.setAttribute('data-count', finalCount)
            }

            document.querySelector(`#${party}-key-total`).textContent = SiteTrade.iit.total.key;
        }

        const user_total = round_ref(round_ref(UserTrade.iit.total.key * parseFloat(key_price)) + UserTrade.iit.total.ref)
        const site_total = round_ref(round_ref(SiteTrade.iit.total.key * parseFloat(key_price)) + SiteTrade.iit.total.ref)
        if(user_total >= site_total && user_total != 0){
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.add('ready')
        } else{
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.remove('ready')
        }
        if(user_total > 0 || site_total > 0){
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.add('hide')
        } else {
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.remove('hide')    
        }
    }

    function updateRefs (){
        const refs = document.querySelector(`.grid#${party}-grid .pure.refs`)
        amount = round_ref( parseFloat(amount) )   

        if(party == 'user'){            
            if(amount % 1 != 0){ // has decimal number

            }
            
            ////////////
            if(action == 'add'){
                UserTrade.iit.total.ref += Number(amount);
                UserTrade.iit.pure.ref += Number(amount);
                UserTrade.pure.key -= Number(amount);

                let finalCount = Number(refs.querySelector('.pure-count').textContent.replace(' x', '')) - Number(amount);
                refs.querySelector('.pure-count').textContent = `${finalCount} x`
                refs.setAttribute('data-count', finalCount)
            }
            else if(action == 'remove'){
                UserTrade.iit.total.key -= Number(amount);
                UserTrade.iit.pure.key -= Number(amount);
                UserTrade.pure.key += Number(amount);

                let finalCount = Number(refs.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount);
                refs.querySelector('.pure-count').textContent = `${finalCount} x`
                refs.setAttribute('data-count', finalCount)
            }

            document.querySelector(`#${party}-key-total`).textContent = UserTrade.iit.total.key;
        }
        if(party == 'site'){
            const refs = document.querySelector(`.grid#${party}-grid .pure.refs`)

            if(action == 'add'){
                SiteTrade.iit.total.key += Number(amount);
                SiteTrade.iit.pure.key += Number(amount);
                SiteTrade.pure.key -= Number(amount);

                let finalCount = Number(refs.querySelector('.pure-count').textContent.replace(' x', '')) - Number(amount);
                refs.querySelector('.pure-count').textContent = `${finalCount} x`
                refs.setAttribute('data-count', finalCount)
            }
            else if(action == 'remove'){
                SiteTrade.iit.total.key -= Number(amount);
                SiteTrade.iit.pure.key -= Number(amount);
                SiteTrade.pure.key += Number(amount);

                let finalCount = Number(refs.querySelector('.pure-count').textContent.replace(' x', '')) + Number(amount);
                refs.querySelector('.pure-count').textContent = `${finalCount} x`
                refs.setAttribute('data-count', finalCount)
            }

            document.querySelector(`#${party}-key-total`).textContent = SiteTrade.iit.total.key;
        }

        const user_total = round_ref(round_ref(UserTrade.iit.total.key * parseFloat(key_price)) + UserTrade.iit.total.ref)
        const site_total = round_ref(round_ref(SiteTrade.iit.total.key * parseFloat(key_price)) + SiteTrade.iit.total.ref)
        if(user_total >= site_total && user_total != 0){
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.add('ready')
        } else{
            document.querySelector("body > main > div > div.widget-wrapper > div.btns > div.btn.trade-btn").classList.remove('ready')
        }
        if(user_total > 0 || site_total > 0){
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.add('hide')
        } else {
            document.querySelector(`.items-in-trade #${party}-grid .no-items`).classList.remove('hide')    
        }
    }
    console.log(UserTrade, SiteTrade)
}

const reset_filters = async (party) => {
    document.querySelector(`#${party}-filters > div.reset-filters`).classList.remove('show')
    set_filter(party, 'quality', 'None')
    set_filter(party, 'type', 'None')
    set_filter(party, 'item-order', 'None')

    switch (party) {
        case 'user':
            document.querySelectorAll('#user-filters .filter.selected').forEach(selFilter => {
                selFilter.querySelector('.filter-value').innerHTML = ''
                selFilter.classList.remove('selected')    
            })
            break;
        case 'site':
            document.querySelectorAll('#site-filters .filter.selected').forEach(selFilter => {
                selFilter.querySelector('.filter-value').innerHTML = ''
                selFilter.classList.remove('selected')    
            })
            break;
        default:
            break;
    }
}
const search = async (party, value) => {
    if(party == 'user' && UserTrade.inventory == undefined){ return false; }
    if(party == 'site' && SiteTrade.inventory == undefined){ return false; }

    let itemGrid = document.querySelector(`#${party}-item-grid #${party}-grid`)
    if(value == ''){
        itemGrid.querySelector('.grid .keys').classList.remove('s-hdn')
        itemGrid.querySelector('.grid .refs').classList.remove('s-hdn')    
        itemGrid.querySelectorAll('.item').forEach(item => {
            item.classList.remove('s-hdn')
        })
    }
    else{
        itemGrid.querySelector('.grid .keys').classList.add('s-hdn')
        itemGrid.querySelector('.grid .refs').classList.add('s-hdn')
        itemGrid.querySelectorAll('.item').forEach(item => {
            if(!item.getAttribute('data-name').toLowerCase().includes(value.toLowerCase())){
                item.classList.add('s-hdn')
            } else {
                item.classList.remove('s-hdn')
            }
        })
    }
}

const set_filter = async (party, filter, value) => {
    // hide pure on quality,or type filter or input search
    // display pure when all those are set to "none" and on when input searching for "Key" ("Ref")
    if(party == 'user' && UserTrade.inventory == undefined){ return false; }
    if(party == 'site' && SiteTrade.inventory == undefined){ return false; }
    let itemGrid = document.querySelector(`#${party}-item-grid #${party}-grid`)
    if(value == "None"){
        itemGrid.querySelectorAll('.item').forEach(item => {
            switch (filter) {
                case 'quality':
                    item.classList.remove('q-hdn')
                    itemGrid.querySelector('.keys').classList.remove('q-hdn')
                    itemGrid.querySelector('.refs').classList.remove('q-hdn')
                    break;
                case 'type':
                    item.classList.remove('t-hdn')
                    itemGrid.querySelector('.keys').classList.remove('t-hdn')
                    itemGrid.querySelector('.refs').classList.remove('t-hdn')
                    break;
                case 'item-order':
                    
                    break;
                default:
                    break;
            }
        })
    }
    else {
        if(!document.querySelector(`#${party}-filters .reset-filters.show`)){
            document.querySelector(`#${party}-filters .reset-filters`).classList.add('show')
        }
        if(filter == 'item-order'){
            const comparator = (a, b) => {
                let v1 = Number(Number(a.getAttribute('data-keys')) * key_price) + Number(a.getAttribute('data-refs'));
                let v2 = Number(Number(b.getAttribute('data-keys')) * key_price) + Number(b.getAttribute('data-refs'));
    
                v1 = parseFloat(v1);
                v2 = parseFloat(v2);
    
                if(value.toLowerCase().includes('ascending')) {
                    return v1 - v2;
                } else {
                    return v2 - v1;
                }
            };

            const items = Array.from(document.querySelectorAll(`#${party}-item-grid .grid .item`));
            const sorted = items.sort(comparator);
    
            sorted.forEach(el => {
                el.parentNode.appendChild(el);
            });
        } else {
            itemGrid.querySelectorAll('.item').forEach(item => {
                switch (filter) {
                    case 'quality':
                        if(!item.getAttribute('data-quality').toLowerCase().includes(value.toLowerCase())){
                            item.classList.add('q-hdn')
                        } else {
                            item.classList.remove('q-hdn')
                        }
                        itemGrid.querySelector('.keys').classList.add('q-hdn')
                        itemGrid.querySelector('.refs').classList.add('q-hdn')

                        break;
                    case 'type':
                        if(!item.getAttribute('data-type').toLowerCase().includes(value.toLowerCase())){
                            item.classList.add('t-hdn')
                        } else {
                            item.classList.remove('t-hdn')
                        }
                        itemGrid.querySelector('.keys').classList.add('t-hdn')
                        itemGrid.querySelector('.refs').classList.add('t-hdn')

                        break;
                    default:
                        break;
                }
            })
        }
    }
}

const item_tooltip = async (state, item, party) => {
    const tooltip = document.getElementById('item_tooltip');
    if(state == "show"){
        if(item.getAttribute('class').includes('item')){
            const showTooltip = (itemDesc) => {
                tooltip.querySelector('.item_description .item-desc').style.display = 'block';
                tooltip.querySelector('.item_description .pure-desc').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_paint').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_killstreaker').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_sheen').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_parts').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_spell').style.display = 'none';
                if(itemDesc != undefined){
                    tooltip.setAttribute('q', itemDesc.quality)
                    tooltip.querySelector('.item_name').textContent = itemDesc.name;

                    if(itemDesc.keys > 0){
                        tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'block';
                        tooltip.querySelector('.item-desc .desc_price .key_price #key_amount').textContent = itemDesc.keys;
                        tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = itemDesc.refs;
                    } else {
                        tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                        tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = itemDesc.refs;
                    }

                    if(itemDesc.quality == 'Unusual'){
                        let effect_obj = itemDesc.description.find((obj) => obj.color === "ffd700");
                        if(effect_obj != undefined){
                            tooltip.querySelector('.item-desc .desc_effect').style.display = 'block';
                            tooltip.querySelector('.item-desc .desc_effect').textContent = `★ ${effect_obj.value.replace('★ Unusual Effect: ', '')}`;
                        } else { tooltip.querySelector('.item-desc .desc_effect').style.display = 'none'; }
                    } else {
                        tooltip.querySelector('.item-desc .desc_effect').style.display = 'none';
                    }

                    tooltip.querySelector('.item-desc .descs_ .desc_type .value').textContent = itemDesc.type;
                    
                    const class_arr = []
                    for(const class_obj of itemDesc.tags.filter(obj => obj.category === "Class")){
                        if(itemDesc.tags.filter(obj => obj.category === "Class").length == 9){
                            class_arr.push('All Classes')
                            break;
                        }
                        class_arr.push(class_obj.internal_name)
                    }
                    if(class_arr.length == 0){
                        tooltip.querySelector('.item-desc .descs_ .desc_class').style.display = 'none';
                    } else {
                        tooltip.querySelector('.item-desc .descs_ .desc_class').style.display = 'flex';
                        tooltip.querySelector('.item-desc .descs_ .desc_class .value').textContent = class_arr.join(', ');
                    }

                    const parts = []
                    const spells = []
                    for(const obj of itemDesc.description.filter(obj => obj.color === "756b5e" || obj.color === "7ea9d1")){
                        if(obj?.value.startsWith('Paint Color: ')){
                            tooltip.querySelector('.item-desc .descs_ .desc_paint').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_paint .value').textContent = obj.value.replace('Paint Color: ', '');    
                        }
                        else if(obj?.value.startsWith('(') && obj?.value.endsWith(')') && obj?.value.includes(':')){
                            parts.push(obj.value.substring(
                                obj.value.indexOf('(') + 1,
                                obj.value.lastIndexOf(':')
                            ))    
                        }
                        else if(obj?.value.startsWith('Halloween: ') && obj?.value.endsWith('(spell only active during event)')){
                            let spell = obj.value.replace('Halloween: ', '')
                            spells.push(spell.replace(' (spell only active during event)', ''))    
                        }
                    }
                    if(parts.length != 0){
                        tooltip.querySelector('.item-desc .descs_ .desc_parts').style.display = 'flex';
                        tooltip.querySelector('.item-desc .descs_ .desc_parts .value').textContent = parts.join(', ');
                    }
                    if(spells.length != 0){
                        tooltip.querySelector('.item-desc .descs_ .desc_spell').style.display = 'flex';
                        tooltip.querySelector('.item-desc .descs_ .desc_spell .value').textContent = spells.join(', ');
                    }
                    if(itemDesc.name.includes('Killstreak')){
                        const killstreaker = itemDesc.description.find(obj => obj.value.includes('Killstreaker: ') && obj.color === "7ea9d1")
                        const sheen = itemDesc.description.find(obj => obj.value.includes('Sheen: ') && obj.color === "7ea9d1")
                        if(killstreaker != undefined){ 
                            tooltip.querySelector('.item-desc .descs_ .desc_killstreaker').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_killstreaker .value').textContent = killstreaker.value.replace('Killstreaker: ', ''); 
                        }
                        if(sheen != undefined){ 
                            tooltip.querySelector('.item-desc .descs_ .desc_sheen').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_sheen .value').textContent = sheen.value.replace('Sheen: ', ''); 
                        }
                    }
                } else {
                    tooltip.querySelector('.item_name').textContent = "description not found";
                }
                tooltip.classList.add('show')
                tooltip.style.top = item.getBoundingClientRect().top + item.offsetHeight + 9 + "px"
                tooltip.style.left = item.getBoundingClientRect().left - (tooltip.offsetWidth/2) + (item.offsetWidth/2) + "px"
                if(tooltip.offsetWidth + tooltip.getBoundingClientRect().left >= document.body.offsetWidth){
                    tooltip.style.left = document.body.offsetWidth - tooltip.offsetWidth - 5 + "px"
                }
                if(tooltip.getBoundingClientRect().left < 1){
                    tooltip.style.left = 5 + "px"
                }
            }
            if(party == 'user'){
                if(UserTrade.inventory == null){
                    const itemDesc = JSON.parse(localStorage.getItem('user_inventory')).inventory.items.find(x => x.assetid == item.getAttribute('data-assetid'));
                    showTooltip(itemDesc);
                } else {
                    const itemDesc = UserTrade.inventory.find(x => x.assetid == item.getAttribute('data-assetid'));
                    showTooltip(itemDesc);
                }
            }
            else if(party == 'site'){
                const itemDesc = SiteTrade.inventory.find(x => x.assetid == item.getAttribute('data-assetid'));
                showTooltip(itemDesc);
            }
        }
        if(item.getAttribute('class').includes('pure')){
            tooltip.querySelector('.item_description .item-desc').style.display = 'none';
            tooltip.querySelector('.item_description .pure-desc').style.display = 'block';

            let commodity;
            if(item.getAttribute('class').includes('keys')){
                tooltip.querySelector('.item_name').textContent = "Mann Co. Supply Crate Key";
                commodity = 'keys'
            } else { 
                tooltip.querySelector('.item_name').textContent = "Refined Metal"; 
                commodity = 'refs'
            }

            tooltip.querySelector('.item_description .pure-desc #pure_stock').textContent = item.getAttribute('data-count') + ' ' + commodity

            tooltip.setAttribute('q', item.getAttribute('data-quality'))
            tooltip.classList.add('show')
            tooltip.style.top = item.getBoundingClientRect().top + item.offsetHeight + 9 + "px"
            tooltip.style.left = item.getBoundingClientRect().left - (tooltip.offsetWidth/2) + (item.offsetWidth/2) + "px"
            if(tooltip.offsetWidth + tooltip.getBoundingClientRect().left >= document.body.offsetWidth){
                tooltip.style.left = document.body.offsetWidth - tooltip.offsetWidth - 5 + "px"
            }
            if(tooltip.getBoundingClientRect().left < 1){
                tooltip.style.left = 5 + "px"
            }
        }
    }
    else{
        tooltip.classList.remove('show')
    }
}

const create_trade = async () => {
    document.querySelector('.btn.trade-btn.ready').classList.add('processing')

    let new_trade_Settings = {
        "async": true,
        "crossDomain": false,
        "url": '../api/new_trade',
        "method": "POST",
        "data": JSON.stringify({user: UserTrade.iit, site: SiteTrade.iit}),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }
    $.ajax(new_trade_Settings)
    .fail(function( data ) {
        document.querySelector('.btn.trade-btn.ready').classList.replace('processing', 'denied')
        if(data.statusText != undefined){
            iziToast.error({
                title: 'Error!',
                message: data.statusText
            });
        } else {
            iziToast.error({
                title: 'Error!',
                message: 'Failed to create trade'
            });
        }
    })
    .done(function( data ) {
        if(data.status == 'OK'){
            document.querySelector('.page-section.index-ps').classList.add('trade-created')            
            document.querySelector('.btn.trade-btn.ready').classList.replace('processing', 'confirmed')
            setTimeout(() => {
                location.reload()
                // send to all user sessions
            }, 1000);
        } 
        if(data.status == 'ERROR'){
            document.querySelector('.btn.trade-btn.ready').classList.replace('processing', 'denied')
            if(data.message != undefined){
                iziToast.error({
                    title: 'Error!',
                    message: data.message
                });
            } else {
                iziToast.error({
                    title: 'Error!',
                    message: 'Failed to create trade'
                });
            }
        }
    });

    /* let tradeAlert = `<div class="trade-offer-alert"><div class="alert-content"><span class="icon-arrow_down"></span>Show Trade Offer <span class="icon-arrow_down"></span></div></div>`;

    localStorage.setItem('td-tradeWindow', 'shown')

    document.querySelector('#minimise-pop-up').addEventListener('click', () => {
        $('.trade-offer-pop-up').fadeOut(500);
        localStorage.setItem('td-tradeWindow', 'hidden');
        $('header').after(tradeAlert);
    }) */
};

const check_trade = () => {
    
};

export {
    load_user_inventory, load_site_inventory, item_tooltip, render_items,
    set_filter, reset_filters, search, item_to_trade, pure_to_trade, round_ref,
    create_trade, check_trade,
    UserTrade, SiteTrade
};