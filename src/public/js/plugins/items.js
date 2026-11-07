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

// the /api/items page (15 items each) the list shows up to; main.js asks for list.page + 1 while scrolling.
// The server sends the first items as plain HTML (views/items.ejs), main.js sets list.page to match them.
const list = { page: 0 }

// Requests for items are paced here, in the browser, so a visitor stays under the server's limit (15 per 10 s,
// api/routes/items.js) and a slow moment doesn't leave the list loading forever:
//   - one request at a time, at least GAP apart; asking for the page that is already on its way waits for that one
//   - a new list (filters, search) replaces the request that was still waiting or loading
//   - "too many requests" (429) and "not ready" (503) wait as long as the server says (Retry-After); any failure is
//     tried again after RETRY; after the last one the list says so and offers Try again
const GAP = 1000
const RETRY = [2000, 4000, 8000, 15000]
const pace = { next: 0, job: null }

// the line under the list: "still loading" while it tries again, "couldn't be loaded" + Try again at the end
const status = (state, job) => {
    const content = document.querySelector('.item-content')
    if(!content){ return }
    let box = content.querySelector('.item-status')
    if(!box){
        box = document.createElement('div')
        box.className = 'item-status'
        box.setAttribute('role', 'status')
        box.innerHTML = '<span></span><button type="button"></button>'
        content.append(box)
    }
    if(state){ content.append(box) } // under the list and its loader
    content.classList.toggle('load-failed', state == 'failed')
    box.hidden = !state
    box.querySelector('span').textContent = state == 'failed' ? __('items.load_failed') : state == 'slow' ? __('items.loading_slow') : ''
    const button = box.querySelector('button')
    button.hidden = state != 'failed'
    button.textContent = __('items.try_again')
    button.onclick = state == 'failed' ? () => {
        status(null)
        document.querySelector('.item-content > .item-loader')?.classList.add('loading')
        get_items(job.page, true, job.reset)
    } : null
}

// reset: replace the list (first load, new filters or search) instead of adding to it
const get_items = (page, validInputs, reset = page === 0) => {
    if(validInputs === false){
        iziToast.error({
            title: __('common.error'),
            message: __('items.invalid_input')
        });
        return Promise.resolve(false)
    }
    if(pace.job){
        if(!reset){ return pace.job.promise } // a page is on its way: scrolling asks again when it's there
        // a new list: the old request doesn't matter any more
        pace.job.cancelled = true
        clearTimeout(pace.job.timer)
        pace.job.xhr?.abort()
        pace.job.resolve(false)
        pace.job = null
    }
    list.page = page
    status(null)

    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    urlParams.delete('page') // the plain-HTML page number (/items?page=2) isn't a filter
    const paramsObject = { page: page }

    if(urlParams.size > 0){
        $('#resetFilters').addClass('active').prop('disabled', false)
    } else if(document.getElementById('applyFilters')?.hidden !== false) {
        // nothing applied and nothing picked that waits for "Apply filters" (main.js)
        clear_filter_elements()
        $('#resetFilters').removeClass('active').prop('disabled', true)
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

    const job = { page, reset, cancelled: false, timer: null, xhr: null }
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject })
    pace.job = job

    const finish = () => { if(pace.job === job){ pace.job = null } }
    const send = (attempt) => {
        job.timer = setTimeout(() => {
            if(job.cancelled){ return }
            pace.next = Date.now() + GAP
            job.xhr = $.ajax({
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
            })
            .done((res) => {
                if(job.cancelled){ return }
                finish()
                status(null)
                show(res, reset, job.resolve, job.reject)
            })
            .fail((xhr) => {
                if(job.cancelled || xhr.statusText == 'abort'){ return }
                // a wrong request (400, 404, ...) won't get better by asking again
                const lasting = xhr.status >= 400 && xhr.status < 500 && ![408, 429].includes(xhr.status)
                if(!lasting && attempt < RETRY.length){
                    const told = Number(xhr.getResponseHeader('Retry-After')) * 1000 || 0
                    pace.next = Math.max(pace.next, Date.now() + Math.max(told, RETRY[attempt]))
                    if(attempt > 0){ status('slow') }
                    return send(attempt + 1)
                }
                finish()
                if(!reset){ list.page = page - 1 } // scrolling or Try again asks for this page again
                document.querySelector('.item-content > .item-loader')?.classList.remove('loading')
                status('failed', job)
                job.resolve(false)
            })
        }, Math.max(0, pace.next - Date.now()))
    }
    send(0)
    return job.promise
}

// one answer from /api/items on the page: the cards, the count, "no items" or "last page"
const show = (res, reset, resolve, reject) => {
    if(res?.status == "ok"){
        if(res?.response.length == 0){
            if(reset){
                $('.item-content .items a.item_card').remove()
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

        if(reset){
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
                        
                        let stock = Number(item.stock?.items_length) || 0
                        let stock_string =  __('common.in_stock', { count: stock })
                        let price_string = (keys > 0) ? `${keys} key ${metals} ref`:`${metals} ref`;
                        let craft = ''
                        let name = item.bp_sku
                        if(['unusualifier', 'strange filter', 'tool kit', 'chemistry set'].some((typ) => item.type.toLowerCase().includes(typ))){
                            name = name.replace('Non-Craftable ', '')
                        }

                        // if(name.startsWith('Non-Craftable ')){ craft = 'non-craftable'; name = name.replace('Non-Craftable ', '')}
                        $('.item-content .items').append(`<a href="${lurl('/items/' + encodeURIComponent(item.bp_sku))}" class="item_card id_${item.index} q-${item.qualityID} ${craft} s_${stock > 0 ? "true":"false"}"><div class="item-name" translate="no">${name}</div><img class="item-image lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${item.image}" style="background-image: ${(item?.effectID > 0) ? "url(https://api.backpack.tf/images/440/particles/" + item?.effectID + "_94x94.png)" : "none"};" alt="${trade.item_alt(item.bp_sku, item.qualityID)}"><div class="item-data"><div class="stock ${(stock > 0) ? 'yes':'no'}">${stock_string}</div><div class="price">${price_string}</div><div class="quality q-${item.qualityID}"></div></div></a>`)      
                    }
                }
                $('.item-content').append(`<div class="item-loader"><img src="/img/trade-icon.jpg" alt="${__('alt.loading')}"></div>`)
            }
        } else {
            const loader = document.querySelector('.item-content > .item-loader')
            // an item can move while the list is read page by page (stock changes the order): show it once
            const shown = new Set(Array.from(document.querySelectorAll('.item-content .items a.item_card'), (a) => a.getAttribute('href')))
            if(res?.response != undefined){
                for (const item of res?.response) {
                    if(item?.bp_sku != undefined && typeof item?.bptf_data?.update_key_price == "number"){
                        if(shown.has(lurl('/items/' + encodeURIComponent(item.bp_sku)))){
                            continue
                        }
                        if(typeof item.buy != 'number' || typeof item.sell != 'number' || (item.sell / item.buy) > 30 || item.sell > 100000*100){
                            continue
                        }
                        let keys = Math.floor(item.sell / item.bptf_data.update_key_price);
                        let metals = trade.round_ref(((item.sell / item.bptf_data.update_key_price) - keys) * item.bptf_data.update_key_price);
                        
                        if(metals >= item.bptf_data.update_key_price && item.bptf_data.update_key_price != 0){
                            metals = trade.round_ref(metals - item.bptf_data.update_key_price)
                            keys ++
                        }

                        let stock = Number(item.stock?.items_length) || 0
                        let stock_string =  __('common.in_stock', { count: stock })
                        let price_string = (keys > 0) ? `${keys} key ${metals} ref`:`${metals} ref`
                        let craft = ''
                        let name = item.bp_sku
                        if(['unusualifier', 'strange filter', 'tool kit', 'chemistry set'].some((typ) => item.type.toLowerCase().includes(typ))){
                            name = name.replace('Non-Craftable ', '')
                        }
                        // if(name.startsWith('Non-Craftable ')){ craft = 'non-craftable'; name = name.replace('Non-Craftable ', '')}
                        $('.item-content .items').append(`<a href="${lurl('/items/' + encodeURIComponent(item.bp_sku))}" class="item_card id_${item.index} q-${item.qualityID} ${craft} s_${stock > 0 ? "true":"false"}"><div class="item-name" translate="no">${name}</div><img class="item-image lazy-fade" onload="this.classList.add('loaded')" loading="lazy" src="${item.image}" style="background-image: ${(item?.effectID > 0) ? "url(https://api.backpack.tf/images/440/particles/" + item?.effectID + "_94x94.png)" : "none"};" alt="${trade.item_alt(item.bp_sku, item.qualityID)}"><div class="item-data"><div class="stock ${(stock > 0) ? 'yes':'no'}">${stock_string}</div><div class="price">${price_string}</div><div class="quality q-${item.qualityID}"></div></div></a>`)      
                    }
                }
                loader.classList.remove('loading')
            }
        }
    } else {
        $('.h2-info #item_count').text(0)
    }
    resolve(true)
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
    get_items, query_change, clear_filter_elements, normalizeGerman, list
};