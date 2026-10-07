import * as main from '../main.js'
import * as trade from '../plugins/trade.js'

function normalizeGerman(str) {
    if (typeof str !== 'string') return '';

    return str
        .toLowerCase()
        .replace(/ß/g, 'ss') // Replace ß with ss
        .normalize('NFD')    // Decompose accented characters
        .replace(/[\u0300-\u036f]/g, ''); // Remove diacritic marks
}

const cli_token='awe46awe42aw1!sada!@clia_sdssdas_qweqw98d4dqwd21/as';
const cli_secret='!!!!!!!asadas@q5qwe5qw4ew62qwe13qwe89qwe4666qw3';
const get_items = async (page, validInputs) => {
    return new Promise(async (resolve, reject) => {
        if(validInputs === false){
            iziToast.error({
                title: __('common.error'),
                message: __('items.invalid_input')
            });
            return false;
        }
        
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const paramsObject = { page: page }
        paramsObject['client_token'] = cli_token
        paramsObject['client_secret'] = cli_secret

        if(urlParams.size > 0){
            $('#resetFilters').addClass('active')
        } else {
            clear_filter_elements()
            $('#resetFilters').removeClass('active')
        }

        for (const entry of urlParams.entries()) {            
            if(entry[0] == 'class'){
                if(entry[1] == 'All Classes'){
                    paramsObject[entry[0]] = 'Scout, Soldier, Pyro, Demoman, Heavy, Engineer, Medic, Sniper, Spy'
                } else {
                    paramsObject[entry[0]] = (entry[1].startsWith(' ')) ? entry[1].slice(1) : entry[1]
                }
            } else if(entry[0] == 'particle'){
                try {
                    const id = JSON.parse(localStorage.getItem("unusual_effects")).find(p => p.name === entry[1])["ID"]    
                    if(typeof id === "string"){
                        paramsObject[entry[0]] = id
                    }
                } catch (error) {       
                }
            } else {
                paramsObject[entry[0]] = (entry[1].startsWith(' ')) ? entry[1].slice(1) : entry[1]
            }
        }

        const params = new URLSearchParams(window.location.search);

        // build new url
        const newUrl = `${window.location.pathname}?${params.toString()}`;

        // push to history
        history.pushState({}, "", newUrl);

        let itemsSettings = {
            "async": true,
            "crossDomain": true,
            "url": '../api/items',
            "method": "POST",
            "data": JSON.stringify(paramsObject),
            "headers": {
                "Content-Type": "application/json",
                "Authorization": "Bearer ",
                "Accept": "*/*",
            }
        }

        $.ajax(itemsSettings)
        .done(async function (res) {
            if(res?.status == "ok"){
                if(res?.response.length == 0){
                    if(page === 0){
                        if(res?.item_count){
                            $('.h2-info #item_count').text(res?.item_count)
                        } else {
                            $('.h2-info #item_count').text(0)
                        }
                        $('.item-loader').addClass('loading')
                        document.querySelector('.item-content').classList.remove('last-page')
                        document.querySelector('.item-content').classList.add('no-items')
                        reject('no items')
                    } else {
                        document.querySelector('.item-content').classList.remove('no-items')
                        document.querySelector('.item-content').classList.add('last-page')
                        reject('last page')
                    }
                    return false
                } else {
                    document.querySelector('.item-content').classList.remove('no-items')
                    document.querySelector('.item-content').classList.remove('last-page')
                }

                if(page == 0){
                    if(res?.item_count){
                        $('.h2-info #item_count').text(res?.item_count)
                    } else {
                        $('.h2-info #item_count').text(0)
                    }
                    document.querySelector('.item-content').classList.add('loaded')
                    const loader = document.querySelector('.item-content > .item-loader')
                    loader.remove()
                    if(res?.response != undefined){
                        $('.item-content .items a.item_card').remove()
                        for (const item of res?.response) {
                            if(item?.bp_sku != undefined && typeof item?.bptf_data?.update_key_price == "number"){
                                if(typeof item.buy != 'number' || typeof item.sell != 'number' || (item.sell / item.buy) > 30 || item.sell > 100000*100){
                                    continue
                                }
                                let keys = Math.floor(item.sell / item.bptf_data.update_key_price);
                                let metals = trade.round_ref(((item.sell / item.bptf_data.update_key_price) - keys) * item.bptf_data.update_key_price);
                                
                                if(metals >= item.bptf_data.update_key_price && item.bptf_data.update_key_price != 0){
                                    metals = trade.round_ref(metals - item.bptf_data.update_key_price)
                                    keys ++
                                }
                                
                                let stock = (typeof (item.stock?.items) == "object") ? item.stock.items.length:0
                                let stock_string =  __('common.in_stock', { count: stock })
                                let price_string = (keys > 0) ? `${keys} key ${metals} ref`:`${metals} ref`;
                                let craft = ''
                                let name = item.bp_sku
                                if(['unusualifier', 'strange filter', 'tool kit'].some((typ) => item.type.toLowerCase().includes(typ))){
                                    name = name.replace('Non-Craftable ', '')
                                }

                                // if(name.startsWith('Non-Craftable ')){ craft = 'non-craftable'; name = name.replace('Non-Craftable ', '')}
                                $('.item-content .items').append(`<a href="${lurl('/items/' + encodeURIComponent(item.bp_sku))}" class="item_card id_${item.index} q-${item.qualityID} ${craft} s_${stock > 0 ? "true":"false"}"><div class="item-name" translate="no">${name}</div><img class="item-image lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${item.image}" style="background-image: ${(item?.effectID > 0) ? "url(https://api.backpack.tf/images/440/particles/" + item?.effectID + "_94x94.png)" : "none"};" alt="${String(item.bp_sku).replace(/"/g, '&quot;')}"><div class="item-data"><div class="stock ${(stock > 0) ? 'yes':'no'}">${stock_string}</div><div class="price">${price_string}</div><div class="quality q-${item.qualityID}"></div></div></a>`)      
                            }
                        }
                        $('.item-content').append(`<div class="item-loader"><img src="/img/trade-icon.jpg" alt=""></div>`)
                    }
                } else {
                    const loader = document.querySelector('.item-content > .item-loader')
                    if(res?.response != undefined){
                        for (const item of res?.response) {
                            if(item?.bp_sku != undefined && typeof item?.bptf_data?.update_key_price == "number"){
                                if(typeof item.buy != 'number' || typeof item.sell != 'number' || (item.sell / item.buy) > 30 || item.sell > 100000*100){
                                    continue
                                }
                                let keys = Math.floor(item.sell / item.bptf_data.update_key_price);
                                let metals = trade.round_ref(((item.sell / item.bptf_data.update_key_price) - keys) * item.bptf_data.update_key_price);
                                
                                if(metals >= item.bptf_data.update_key_price && item.bptf_data.update_key_price != 0){
                                    metals = trade.round_ref(metals - item.bptf_data.update_key_price)
                                    keys ++
                                }

                                let stock = (typeof (item.stock?.items) == "object") ? item.stock.items.length:0
                                let stock_string =  __('common.in_stock', { count: stock })
                                let price_string = (keys > 0) ? `${keys} key ${metals} ref`:`${metals} ref`
                                let craft = ''
                                let name = item.bp_sku
                                if(['unusualifier', 'strange filter', 'tool kit'].some((typ) => item.type.toLowerCase().includes(typ))){
                                    name = name.replace('Non-Craftable ', '')
                                }
                                // if(name.startsWith('Non-Craftable ')){ craft = 'non-craftable'; name = name.replace('Non-Craftable ', '')}
                                $('.item-content .items').append(`<a href="${lurl('/items/' + encodeURIComponent(item.bp_sku))}" class="item_card id_${item.index} q-${item.qualityID} ${craft} s_${stock > 0 ? "true":"false"}"><div class="item-name" translate="no">${name}</div><img class="item-image lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${item.image}" style="background-image: ${(item?.effectID > 0) ? "url(https://api.backpack.tf/images/440/particles/" + item?.effectID + "_94x94.png)" : "none"};" alt="${String(item.bp_sku).replace(/"/g, '&quot;')}"><div class="item-data"><div class="stock ${(stock > 0) ? 'yes':'no'}">${stock_string}</div><div class="price">${price_string}</div><div class="quality q-${item.qualityID}"></div></div></a>`)      
                            }
                        }
                        loader.classList.remove('loading')
                    }
                }
            } else {
                $('.h2-info #item_count').text(0)
            }
        })
        .catch(async function (res){
            iziToast.error({
                title: __('common.error'),
                message: res.statusText
            });
        });
    })
}

const clear_filter_elements = () => {
    const els = document.querySelectorAll('.filter')

    for (const el of els) {
        el.classList.remove('selected')
        el.querySelector('.filter-value').innerHTML = ""
        el.querySelector('.filter-value').removeAttribute('style')
    }

    document.querySelector('#itemInput').value = ''
}

const query_change = async () => {}


export {
    get_items, query_change, clear_filter_elements, normalizeGerman
};