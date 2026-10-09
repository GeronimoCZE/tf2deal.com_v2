import * as main from '../main.js'
import * as popUp from './window_form.js'
import { build_item_filters, hide_item_filters } from './item_filters.js'

const img_prefix = "https://community.fastly.steamstatic.com/economy/image/";

const images = {
    key: img_prefix + 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ/115x96',
    ref: img_prefix + 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO1Mv6NGucF1Ygzt8ZQijJukFMiMrbhYDEwI1yRVKNfD6xorQ3qW3Jr6546DNPuou9IOVK4p4kWJaA/115x96',
    rec: img_prefix + 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO0Mv6NGucF1YJlscMEgDdvxVYsMLPkMmFjI1OSUvMHDPBp9lu0CnVluZQxA9Gwp-hIOVK4sMMNWF4/115x96',
    scrap: img_prefix + 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsPZAfOeD-VOn4phtsdQ32ZtxFYoN7PkYmVmIgeaUKNaX_Rjpwy8UHMz6pcxAIfnovUWJ1t9nYFqYw/115x96'
}

const key_value = key_price || null;

const user_trusted = {
    bptf: false
}

class Trade_Object {
    constructor() {
      this.inventory = null;
      this.pure = null;
      this.bots = new Map();
      this.bot_names = new Map();

      this.filters = {bot: null, quality: null, type: null, particle: null, class: null, "item-order": null, price: null, search: null, page: 0, bot: null}
      this.iit = { 
        total: { price: 0 }, 
        total_pure: { price: 0 },
        pure: { key: 0, ref: 0, rec: 0, scrap: 0 }, 
        pureAssets: { key: [], ref: [], rec: [], scrap: [] },
        items: [] 
      };
      this.pureAssets = { key: [], ref: [], rec: [], scrap: [] }
    }
}

class Item_Trade_Object {
    constructor() {
      this.items = [];
      this.party = null;
      this.tier = 0;      // item page: selected killstreak tier
      this.stock = null;  // item page: that tier's stock (null = the item's stock)
      this.bots = new Map();

      this.filters = {bot: null}
      this.iit = []
      this.total = 0;
    }
}

const UserTrade = new Trade_Object(); // => save both invs in localstorage for Trade Created page (display traded items)
const SiteTrade = new Trade_Object();
const ItemTrade = new Item_Trade_Object();

const unusual_effects = localStorage.getItem('unusual_effects')

UserTrade.global_stock = []
UserTrade.stock = []
SiteTrade.iit.bots = []

const title = document.title;

let user_items = []
let trade_req = false;

const tradeoffer = {
    offer: localStorage.getItem(`tradeoffer${user}`),
    last_fetch: null
}

if(tradeoffer.offer){
    if(tradeoffer.offer){
        socket.emit('getTradeOffer')
    }
}

setInterval(() => {
    if(tradeoffer.offer && !document.hidden){
        socket.emit('getTradeOffer')
    }
}, 15000);

// a status that changed while the connection dropped or the tab slept is picked up right away
socket.on('connect', () => { if(tradeoffer.offer){ socket.emit('getTradeOffer') } })
document.addEventListener('visibilitychange', () => {
    if(!document.hidden && tradeoffer.offer){ socket.emit('getTradeOffer') }
})

socket.on('sentOfferChanged', (res) => {
    try {
        if(typeof res === "object" && res !== null){
            tradeOfferConnection(res, 'change')
        } else {
            tradeoffer.offer = null;
            localStorage.removeItem(`tradeoffer${user}`)
            document.querySelector('.trade-offer-bar').classList.remove('active')
        }
    } catch (error) {
        
        
    }
})

socket.on('TradeOffer', (res) => {
        
    try {
        if(typeof res === "object" && res !== null){
                        
        } else {
            tradeoffer.offer = null;
            localStorage.removeItem(`tradeoffer${user}`)
            document.querySelector('.trade-offer-bar').classList.remove('active')
        }
    } catch (error) {
                
    }
})

// use this for item interaction
// in case user changes DOM (compare all item el attributes with item object and find a possible match)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

const mutationObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if(mutation.type === "attributes"){
        if(
            mutation.attributeName.includes('data-')
        ){
            if(mutation.attributeName.includes('data-count')){ return false; }
            window.location.href = lurl('/') + '?error=domchange'
        }
      }
    });
  });

  if(TD_PATH == '/trade' && view == 'trade'){
    mutationObserver.observe(document.querySelector('.index-ps .user-window'), {
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
        childList: true
    });

    mutationObserver.observe(document.querySelector('.index-ps .site-window'), {
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
        childList: true
    });
  }

UserTrade.iit.hash = user_id;
SiteTrade.iit.hash = user_id;
let site_inventory_load = 0;
let fetched_all_pages = false;

function formatUnixTimestamp(unixMs) {
    const date = new Date(unixMs);
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-based
    const year = date.getFullYear();

    return `${hours}:${minutes} ${day}.${month}.${year}`;
}

function playSound(src, volume = 1) {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch(err => {
        
    });
}

let last_load = {
    filters: JSON.stringify({})
}

let processing_site_inventory = false;
const load_site_inventory = async (page, change, reload) => {

    if(processing_site_inventory){ return; }
    processing_site_inventory = true;

    if(reload){
        SiteTrade.filters.page = 0;

    } else {
        SiteTrade.filters.page = SiteTrade.filters.page + 1
    }

    if(typeof SiteTrade.filters.quality == "string"){
        SiteTrade.filters.quality = itemAttr.Quality[SiteTrade.filters.quality[0].toUpperCase() + SiteTrade.filters.quality.slice(1)]?.id || null;
    }
    if(typeof SiteTrade.filters.particle == "string"){
        const effect = JSON.parse(localStorage.getItem('unusual_effects'))?.find(eff => eff.name.toLowerCase() == SiteTrade.filters.particle.toLowerCase())
        SiteTrade.filters.particle = effect["ID"] || null;
        
    }

    if(SiteTrade.filters.page == 0 || SiteTrade.filters.page == 1){
        SiteTrade.filters.page = 1
    }
    
    let Settings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/bots/inventory',
        "method": "POST",
        "data": JSON.stringify({filters: SiteTrade.filters}),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    if(bots == "offline"){
        render_items('site', 'error', 0, change)
        iziToast.error({
            title: __('common.error'),
            message: __('trade.bots_unavailable')
        });
        processing_site_inventory = false;
        return;
    }

    if(user === "no_session" && page > 4){
        iziToast.error({
            title: __('common.error'),
            message: __('trade.login_to_browse')
        });
        processing_site_inventory = false;
        return;
    }

    if(last_load.filters == JSON.stringify(SiteTrade.filters) && !reload){
        processing_site_inventory = false;
        return;
    } else {
        SiteTrade.filters.page = 1;
    }

    const make_request = () => {
        $.ajax(Settings)
        .fail(async function (response){
            processing_site_inventory = false;
            $('.item-grid #site-grid .invisible-item').remove()

            if(page == 0){
                render_items('site', 'error', page, change)
            } else {
                SiteTrade.filters.page = SiteTrade.filters.page - 1
            }
            if(response.statusText == 'Too Many Requests'){
                iziToast.error({
                    title: __('common.error'),
                    message: __('common.too_many_requests')
                });
            } else {
                iziToast.error({
                    title: __('common.error'),
                    message: __('trade.items_error')
                });
            }
        })
        .done(async function (response) {
            processing_site_inventory = false;
            last_load.filters = JSON.stringify(SiteTrade.filters);
            document.querySelectorAll('.filter-btn').forEach((btn) => {
                if(!btn.parentElement.querySelector('.filter-box').classList.contains('hidden')){
                    btn.parentElement.querySelector('.filter-box').classList.toggle('hidden')
                }
                if(btn.classList.contains('active')){
                    btn.classList.toggle('active')
                }
            })
            // save response in FE and render it for 30sec -> then allow refresh
            try {
                if(Array.isArray(response?.inventory?.bots)){
                     document.querySelector('#filter-bot .filter-dropdown').innerHTML = `<div class="fd-value none" data-value="None"><span class="icon icon-close"></span> ${__('filters.none')}</div>`
                    for (const bot of response?.inventory?.bots) {
                        SiteTrade.bots.set(bot.split(';')[1], bot.split(';')[0])
                        SiteTrade.bot_names.set(bot.split(';')[0], bot.split(';')[1])
                        $('#filter-bot .filter-dropdown').append(`<div class="fd-value">${bot.split(';')[1]}</div>`)
                    }
                    document.querySelector('#filter-bot').classList.remove('disabled')
                }
                if(await response != "error"){
                    if(Array.isArray(SiteTrade.inventory)){} else { SiteTrade.inventory = [] }
                    if( response.inventory.items.length < response?.page_limit ){ fetched_all_pages = true }
        
                    let new_items = []
                    for (const item of response.inventory.items) {
                        if(!SiteTrade.inventory.find(itm => itm.bp_sku == item.bp_sku)){
                            new_items.push(item)
                        }
                    }
    
                    SiteTrade.inventory = [...SiteTrade.inventory, ...new_items];
                    
                    SiteTrade.pure = response.inventory.pure;
                    render_items('site', await response, page, change, fetched_all_pages)
                }
                else{
                    if(page == 0){
                        render_items('site', await response, page, change, fetched_all_pages)
                    } else {
                        SiteTrade.filters.page = SiteTrade.filters.page - 1
                        iziToast.error({
                            title: __('trade.items_error_title'),
                            message: __('common.try_later')
                        });
                    }
                }
            } catch (error) {
                iziToast.error({
                    title: __('common.error'),
                    message: __('trade.items_error')
                });
                if(page == 0){
                    render_items('site', 'error', page, change)
                }
            }

            processing_site_inventory = false; 
        })
            
    }    

    if(page < 2){
        $(`.loading-items#site-loading`).removeClass('hidden')
        await delay(1000)
        site_inventory_load = Date.now()
        fetched_all_pages = false;
        make_request()
    } else {
        await delay(1000)
        site_inventory_load = Date.now()
        make_request()
    }
}

let fetched_all_user_pages = false;
let processing_user_inventory = false;
const last_load_user = {
    filters: JSON.stringify({})
}

socket.on('offerChange', (offer) => {
    tradeOfferConnection(offer, 'change')
})

const clearStorage = () => {
    try {
        const trade_offer = JSON.parse(localStorage.getItem(`tradeoffer${user}`));
    
        switch (trade_offer?.status) {
            case "canceled":
                localStorage.removeItem(`tradeoffer${user}`)
                break;
            case "declined":
                localStorage.removeItem(`tradeoffer${user}`)
                break;
            case "error": 
                localStorage.removeItem(`tradeoffer${user}`)
                break;
            case "expired": 
                localStorage.removeItem(`tradeoffer${user}`)
                break;
            case "accepted": 
                localStorage.removeItem(`tradeoffer${user}`)
                break;
            default:
                break;
        }
    } catch (error) {
        
    }
}

/* ---------- trade offer status helpers ---------- */

// bot statuses -> [status the modal knows, detail]; e.g. "declined counter" -> ["declined", "counter"]
const OFFER_STATES = ["loading", "pending", "creating", "waitingApproval", "sent", "accepted", "canceled", "declined", "expired", "invalid", "error"]
const OFFER_ALIASES = {
    "declined expired": ["expired", ""],
    "declined trade hold": ["declined", "hold"],
    "declined counter": ["declined", "counter"],
    "error wrong offer": ["error", "wrong"],
    "error missing items": ["error", "missing"],
    "cancelled": ["canceled", ""],
    "waitingapproval": ["waitingApproval", ""]
}
const offer_status = (raw) => {
    raw = String(raw ?? '').trim()
    if(OFFER_STATES.includes(raw)){ return [raw, ''] }
    // numeric bot states (see trade_states in app.js)
    const NUMERIC = { 1: 'error', 2: 'sent', 3: 'accepted', 4: 'declined counter', 5: 'declined expired', 6: 'error wrong offer', 7: 'declined', 8: 'error missing items', 9: 'pending', 10: 'declined', 11: 'declined trade hold' }
    if(/^\d+$/.test(raw) && NUMERIC[raw]){ raw = NUMERIC[raw] }
    const lower = raw.toLowerCase()
    if(OFFER_ALIASES[lower]){ return OFFER_ALIASES[lower] }
    const first = lower.split(/\s+/)[0]
    if(OFFER_STATES.includes(first)){ return [first, lower.slice(first.length).trim()] }
    return ['loading', '']
}

// progress line at the top of the trade modal: create -> accept on Steam -> done
const FLOW_STEP = { loading: 0, creating: 0, pending: 0, waitingApproval: 0, sent: 1, accepted: 2 }
let last_flow_step = 0
const offer_steps = (status) => {
    const failed = !(status in FLOW_STEP)
    const at = failed ? last_flow_step : FLOW_STEP[status]
    if(!failed){ last_flow_step = at }
    const labels = [__('offer.step_create'), __('offer.step_accept'), __('offer.step_done')]
    return `<ol class="offer-steps${failed ? ' is-failed' : ''}" aria-label="${__('offer.progress')}">${labels.map((label, i) => {
        const cls = i < at || (status == 'accepted' && i == at) ? 'is-done' : i == at ? (failed ? 'is-failed' : 'is-current') : ''
        return `<li class="${cls}"${i == at ? ' aria-current="step"' : ''}><span class="dot"></span><span class="label">${label}</span></li>`
    }).join('')}</ol>`
}

// the bar under the menu while the modal is closed says what the offer is doing
const update_offer_bar = (status) => {
    const bar = document.querySelector('.trade-offer-bar')
    if(!bar){ return }
    const text = { sent: __('offer.bar_sent'), waitingApproval: __('offer.bar_approval'), loading: __('offer.bar_creating'), creating: __('offer.bar_creating'), pending: __('offer.bar_creating') }[status]
    bar.dataset.status = status || ''
    const label = bar.querySelector('span')
    if(label){ label.textContent = text || __('offer.bar_open') }
}

/* ---------- rating after an accepted trade ---------- */

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.3 18.2 21l-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3 7.4 14l-1.6 7z"/></svg>'
const rated_key = (offer_id) => `td_rated_${offer_id || 'last'}`
const rating_box = (offer_id) => {
    const reviews = window.site_settings?.reviews
    if(user == 'no_session' || reviews?.enabled === false){ return '' }
    // asked once per trade offer (without an offer id: at most once a day)
    try {
        const rated = localStorage.getItem(rated_key(offer_id))
        if(rated && (offer_id || Date.now() - Number(rated) < 24 * 60 * 60 * 1000)){ return '' }
    } catch (e) {}
    return `<div class="rating-box" data-offer="${String(offer_id || '').replace(/\D/g, '')}">
        <p class="rating-q">${__('rating.question')}</p>
        <div class="rating-stars" role="radiogroup" aria-label="${__('rating.question')}">
            ${[5, 4, 3, 2, 1].map((n) => `<button type="button" class="rate-star" data-stars="${n}" role="radio" aria-checked="false" aria-label="${__('rating.stars', { n })}">${STAR}</button>`).join('')}
        </div>
        <p class="rating-hint">${__('rating.hint')}</p>
        <div class="rating-follow" aria-live="polite"></div>
    </div>`
}
const send_rating = (data) => fetch('/api/rating', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(data)
}).then((r) => r.json()).catch(() => ({ status: 'error' }))

document.addEventListener('click', async (e) => {
    const box = e.target.closest?.('.rating-box')
    if(!box){ return }
    const offer_id = box.dataset.offer || ''
    const follow = box.querySelector('.rating-follow')

    const star = e.target.closest('.rate-star')
    if(star && !box.classList.contains('is-sending')){
        const stars = Number(star.dataset.stars)
        box.dataset.stars = stars
        box.querySelectorAll('.rate-star').forEach((b) => {
            const on = Number(b.dataset.stars) <= stars
            b.classList.toggle('is-on', on)
            b.setAttribute('aria-checked', String(Number(b.dataset.stars) == stars))
        })
        box.classList.add('is-rated', 'is-sending')
        const res = await send_rating({ stars, offer_id })
        box.classList.remove('is-sending')
        if(res?.status != 'ok'){
            follow.innerHTML = `<p class="rating-msg is-error">${__('rating.failed')}</p>`
            return
        }
        try { localStorage.setItem(rated_key(offer_id), String(Date.now())) } catch (err) {}
        const url = window.site_settings?.reviews?.trustpilot_url
        if(stars >= 4 && url){
            follow.innerHTML = `<p class="rating-msg">${__('rating.thanks_good')}</p>
                <a class="rating-trustpilot" href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${STAR} ${__('rating.trustpilot')}</a>`
        } else if(stars >= 4){
            follow.innerHTML = `<p class="rating-msg">${__('rating.thanks')}</p>`
        } else {
            follow.innerHTML = `<p class="rating-msg">${__('rating.thanks_bad')}</p>
                <textarea class="rating-comment" rows="3" maxlength="500" placeholder="${__('rating.comment_placeholder')}"></textarea>
                <button type="button" class="offer-btn primary rating-send">${__('rating.send')}</button>`
            follow.querySelector('textarea')?.focus()
        }
        return
    }

    if(e.target.closest('.rating-trustpilot')){
        send_rating({ stars: Number(box.dataset.stars) || 5, offer_id, trustpilot: true })
        return
    }

    const send = e.target.closest('.rating-send')
    if(send){
        const comment = box.querySelector('.rating-comment')?.value.trim()
        if(!comment){ box.querySelector('.rating-comment')?.focus(); return }
        send.disabled = true
        const res = await send_rating({ stars: Number(box.dataset.stars), offer_id, comment })
        follow.innerHTML = res?.status == 'ok' ? `<p class="rating-msg">${__('rating.comment_thanks')}</p>` : `<p class="rating-msg is-error">${__('rating.failed')}</p>`
    }
})

const tradeOfferConnection = async (offer, action) => {

    // Save offer correctly (avoid double JSON.stringify)
    if (offer) {
        localStorage.setItem(
            `tradeoffer${user}`,
            typeof offer === "string" ? offer : JSON.stringify(offer)
        );
    }


    tradeoffer.offer = offer || { status: "loading" };


    // Parse JSON strings (supports old double/triple encoded data)
    if (typeof tradeoffer.offer === "string") {
        try {
            while (typeof tradeoffer.offer === "string") {
                tradeoffer.offer = JSON.parse(tradeoffer.offer);
            }
        } catch (error) {
            console.error("Failed parsing trade offer:", error);
            tradeoffer.offer = { status: "loading" };
        }
    }


    // "declined counter", "3" (numeric), ... -> a status the modal knows + a detail for the text
    const [status, status_detail] = offer_status(tradeoffer.offer?.status);
    update_offer_bar(status);


    let modal_title = "";
    let modal_html = "";


    // Trade modal body: one layout for every state (styles: scss/partials/_modals.scss)
    const esc_html = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ICONS = {
        check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
        cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
        clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z"/></svg>',
        alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>',
        info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/></svg>',
        external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg>'
    };
    const spinner = `<div class="offer-visual is-busy"><span class="offer-spinner"></span><img src="/img/trade-icon.jpg" alt=""></div>`;
    const visual = (kind, icon) => `<div class="offer-visual is-${kind}">${ICONS[icon]}</div>`;
    const state = (top, heading, text = '', extra = '') => `
        <div class="offer_content offer-state">
            ${top}
            ${heading ? `<h3 class="offer-heading">${heading}</h3>` : ''}
            ${text ? `<p class="offer-text">${text}</p>` : ''}
            ${extra}
        </div>`;

    switch (status) {

        case "loading":
            modal_title = __('offer.loading_title');
            modal_html = state(spinner, __('offer.loading_data'));
            break;

        case "waitingApproval":
            if(Array.isArray(tradeoffer.offer.priceChanges)){
                for (const item of tradeoffer.offer.priceChanges) {
                    console.log(item)
                }
            }

            modal_title = __('offer.prices_changed_title');
            modal_html = state(visual('warning', 'alert'), __('offer.prices_changed'), '', `
                <div class="changes"></div>
                <p class="offer-text small">${__('offer.prices_changed_confirm')}</p>
                <div class="buttons offer-actions">
                    <button type="button" class="offer-btn ghost" id="denyTrade">${__('offer.deny')}</button>
                    <button type="button" class="offer-btn primary" id="approveTrade">${__('offer.approve')}</button>
                </div>`);
            break;

        case "creating":
            modal_title = __('offer.creating');
            modal_html = state(spinner, __('offer.creating'), __('offer.few_seconds'));
            break;

        case "pending":
            modal_title = __('offer.creating');
            modal_html = state(spinner, __('offer.waiting_guard'), __('offer.ratelimit_hint'));
            break;

        case "sent": {
            const bot = tradeoffer.offer?.offer?.bot || null;

            modal_title = __('offer.ready');
            modal_html = `
                <div class="offer_content offer-sent">
                    ${bot ? `
                        <p class="offer-label">${__('offer.trading_with')}</p>
                        <div class="bot-info">
                            <img class="bot-avatar" src="${esc_html(bot.avatar_url)}" alt="">
                            <div class="bot-data">
                                <span class="bot-name">${esc_html(bot.name || "")}</span>
                                <span class="bot-meta">
                                    <span class="bot-level">${__('offer.bot_level', { level: esc_html(bot.level || __('offer.unknown')) })}</span>
                                    <span class="bot-created">${__('offer.bot_joined', { date: bot.created ? new Date(bot.created * 1000).toLocaleDateString(TD_LANG) : __('offer.unknown') })}</span>
                                </span>
                            </div>
                        </div>` : ''}

                    <div class="offer-callout info">${ICONS.clock}<p>${__('offer.time_limit_html')}</p></div>
                    <div class="offer-callout warning">${ICONS.alert}<p>${__('offer.check_items')}</p></div>

                    <div class="buttons">
                        <a href="https://steamcommunity.com/tradeoffer/${esc_html(tradeoffer.offer?.offer?.offerID)}" target="_blank" rel="noopener" class="open-trade">
                            <span class="icon-steam_circle stat-icon"></span> ${__('offer.open_trade')} ${ICONS.external}
                        </a>
                    </div>
                </div>`;
            break;
        }

        case "accepted":
            modal_title = __('offer.accepted_title');
            modal_html = state(visual('success', 'check'), `🎉 ${__('offer.accepted_thanks')}`, `${__('offer.accepted_enjoy')} 😏`, `
                ${rating_box(tradeoffer.offer?.offer?.offerID || tradeoffer.offer?.offerID)}`);
            break;

        case "canceled":
            modal_title = __('offer.canceled_title');
            modal_html = state(visual('neutral', 'cross'), __('offer.canceled'), __('offer.canceled_hint'));
            break;

        case "declined":
            modal_title = __('offer.declined_title');
            modal_html = state(visual('neutral', 'cross'), __('offer.declined'),
                status_detail == 'hold' ? __('offer.declined_hold') : status_detail == 'counter' ? __('offer.declined_counter') : __('offer.retry_hint'));
            break;

        case "invalid":
            modal_title = __('offer.invalid_title');
            modal_html = state(visual('neutral', 'alert'), __('offer.invalid'), __('offer.retry_hint'));
            break;

        case "expired":
            modal_title = __('offer.expired_title');
            modal_html = state(visual('neutral', 'clock'), __('offer.expired'), __('offer.retry_hint'));
            break;

        case "error":
            modal_title = __('offer.error_title');
            modal_html = state(visual('error', 'alert'), __('common.error'),
                status_detail == 'missing' ? __('offer.error_missing') : status_detail == 'wrong' ? __('offer.error_wrong') : __('offer.error_hint'));
            break;

        default:
            modal_title = "";
            modal_html = "";
            break;
    }

    if(modal_html){ modal_html = offer_steps(status) + modal_html }



    const modal = document.querySelector(
        `.modal_overlay .modal`
    );

    for (const status of [
        "loading",
        "pending",
        "creating",
        "accepted",
        "sent",
        "waitingApproval",
        "canceled",
        "declined",
        "expired",
        "invalid",
        "error"
    ]) {
        modal.classList.remove(
            'status-' + status
        );
    }


    if (action === "open") {

        main.toggleModal(
            main.modals.trade_offer,
            'open'
        );


        modal.classList.add(
            'status-' + status
        );


        modal.querySelector(
            '.modal_header .modal_name'
        ).textContent = modal_title;


        modal.querySelector(
            '.modal_content'
        ).innerHTML = modal_html;


        document
            .querySelector('.trade-offer-bar')
            .classList.remove('active');


    } else if (action === "change") {

        // a status update from the bot server: show it even when the modal is closed
        // (before, this looked the modal up by its "open" classes, so an update that arrived while the
        // modal was closed failed silently and the user never saw "accepted")
        modal.classList.add(
            'status-' + status
        );

        modal.querySelector(
            '.modal_header .modal_name'
        ).textContent = modal_title;

        modal.querySelector(
            '.modal_content'
        ).innerHTML = modal_html;

        main.toggleModal(
            main.modals.trade_offer,
            'open'
        );

        document
            .querySelector('.trade-offer-bar')
            .classList.remove('active');


    } else {


        modal.classList.add(
            'status-' + status
        );


        main.toggleModal(
            main.modals.trade_offer,
            'close'
        );


        document
            .querySelector('.trade-offer-bar')
            .classList.add('active');
    }


    try {
        document.querySelector(".modal #approveTrade").addEventListener('click', (e) => {
            
        })

        document.querySelector(".modal #denyTrade").addEventListener('click', (e) => {
            
        })

        if(status != "waitingApproval"){
            document.querySelector(".modal #approveTrade").removeEventListener('click')
            document.querySelector(".modal #denyTrade").addEventListener('click')
        }
    } catch (error) {
        
    }

    if(status == "sent"){
        if(document.title != __('offer.ready')){
            playSound('/audio/trade_ready.mp3', 1)
        }
        document.title = __('offer.ready')
    }

    // Cleanup finished/invalid offers
    if (
        [
            "canceled",
            "declined",
            "expired",
            "invalid",
            "accepted",
            "error"
        ].includes(status)
    ) {
        document.title = title;
        tradeoffer.offer = null;

        localStorage.removeItem(
            `tradeoffer${user}`
        );

        trade_req = false;
        
        if(TD_PATH.includes('/trade')){
            clear_items(true)

            if(status == "accepted"){
                await delay(4000)
                if(user != "no_session"){
                    try{
                        load_user_inventory(0, 'change', true)
                    } catch{
                        iziToast.error({
                            title: __('trade.reload_failed'),
                            message: __('common.try_refresh')
                        })
                    }
                }

                try{
                    load_site_inventory(0, 'change', true)
                } catch{
                    iziToast.error({
                        title: __('trade.reload_failed'),
                        message: __('common.try_refresh')
                    })
                }
            } else {

            }
        }
        
        document
            .querySelector('.trade-offer-bar')
            .classList.remove('active');
    }
};

// Item page: a message instead of an empty grid (nothing to sell / buy, or the bot server sent an error)
const single_inventory_empty = (response, mode) => {
    let message = null;
    if(!Array.isArray(response?.items)){
        message = (typeof response?.message == 'string') ? response.message : (typeof response?.error == 'string') ? response.error : __('trade.inventory_error');
    } else if(response.items.length == 0){
        message = __(mode == 'sell' ? 'item.no_items_sell' : 'item.no_items_buy');
    }
    if(message === null){ return false; }
    hide_item_filters()
    $(`#trade-item-grid`).empty().append($('<div class="inventory-message"></div>').text(message));
    return true;
}

const load_site_inventory_single = async (bp_sku) => {
    hide_item_filters() // shown again once the items are in
    let siteSettings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/bots/inventory/' + bp_sku,
        "method": "POST",
        "data": JSON.stringify({bp_sku: bp_sku, inventory: "xdqwe"}),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    await delay(2000)

    $.ajax(siteSettings)
    .fail(async function (res){ 
        // res is the jQuery request; the server's message is in responseJSON
        const message = res?.responseJSON?.message || res?.responseJSON?.error;
        if(typeof message == "string"){
            $(`#trade-item-grid`).append(`<div class="inventory-message"> ${message}</div>`)
        } else {
            $(`#trade-item-grid`).append(`<div class="inventory-message"> ${__('trade.inventory_error')}</div>`)
        }
        $(`.loading-items#trade-loading`).addClass('hidden')
        ItemTrade.items = null;
        ItemTrade.party = null;
        ItemTrade.iit = new Item_Trade_Object().iit;
    })
    .done(async function (response) {
        $(`.loading-items#trade-loading`).addClass('hidden')

        if(Array.isArray(response?.items)){ response.items = response.items.filter(tier_visible); }
        ItemTrade.items = response?.items;
        ItemTrade.party = 'trade-site';
        ItemTrade.iit = new Item_Trade_Object().iit;

        if(single_inventory_empty(response, 'buy')){ return; }
        render_items(ItemTrade.party, response, 0, false)
    })
}

const load_user_inventory_single = async (bp_sku) => {
    hide_item_filters() // shown again once the items are in
    clearStorage()

    let userSettings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/user/inventory/' + bp_sku,
        "method": "POST",
        "data": JSON.stringify({bp_sku: bp_sku, inventory: "xdqwe"}),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    await delay(2000)

    $.ajax(userSettings)
    .fail(async function (res){ 
        // res is the jQuery request; the server's message is in responseJSON
        const message = res?.responseJSON?.message || res?.responseJSON?.error;
        if(typeof message == "string"){
            $(`#trade-item-grid`).append(`<div class="inventory-message"> ${message}</div>`)
        } else {
            $(`#trade-item-grid`).append(`<div class="inventory-message"> ${__('trade.inventory_error')}</div>`)
        }
        $(`.loading-items#trade-loading`).addClass('hidden')
        ItemTrade.items = null;
        ItemTrade.party = null;
        ItemTrade.iit = new Item_Trade_Object().iit;
    })
    .done(async function (response) {
        $(`.loading-items#trade-loading`).addClass('hidden')

        if(Array.isArray(response?.items)){ response.items = response.items.filter(tier_visible); }
        ItemTrade.items = response?.items;
        ItemTrade.party = 'trade-user';
        ItemTrade.iit = new Item_Trade_Object().iit;

        if(single_inventory_empty(response, 'sell')){ return; }
        render_items(ItemTrade.party, response, 0, false)
    })
}

const load_user_inventory = async (page, change, reload) => {
    if(processing_user_inventory){ return; }

    clearStorage()

    if(localStorage.getItem(`tradeoffer${user}`)){
        try {
            await delay(2000)
            $('.item-grid #user-grid .invisible-item').remove()
    
            $(`.loading-items#user-loading`).addClass('hidden')
    
            $(`#user-item-grid`).empty()
            $(`#user-item-grid`).append(`<div class="inventory-message">${__('trade.active_offer')}</div>`)
            processing_user_inventory = false;
    
            socket.emit('getTradeOffer')
    
            return false;
        } catch (error) {
            
        }
    }

    processing_user_inventory = true;

    if(reload){
        $(`.loading-items#user-loading`).removeClass('hidden')
        UserTrade.filters.page = 1

    } else {

        UserTrade.filters.page = UserTrade.filters.page + 1

        if(typeof UserTrade.filters.quality == "string"){
            UserTrade.filters.quality = itemAttr.Quality[UserTrade.filters.quality[0].toUpperCase() + UserTrade.filters.quality.slice(1)]?.id || null;
        }
        if(typeof UserTrade.filters.particle == "string" && isNaN(parseInt(UserTrade.filters.particle))){
            const effect = JSON.parse(localStorage.getItem('unusual_effects'))?.find(eff => eff.name.toLowerCase() == UserTrade.filters.particle.toLowerCase())
            UserTrade.filters.particle = effect["ID"] || null;
            
        }

        if(last_load_user.filters == JSON.stringify(UserTrade.filters)){
            processing_user_inventory = false;
            return;
        }

        if(UserTrade.filters.page == 0 || UserTrade.filters.page == 1){
            $(`.loading-items#user-loading`).removeClass('hidden')
            UserTrade.filters.page = 1
        }
    }

    let userSettings = {
        "async": true,
        "crossDomain": true,
        "url": '../api/user/inventory',
        "method": "POST",
        "data": JSON.stringify({filters: UserTrade.filters, inventory: "xdqwe"}),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }

    if(main.trade_o == "true"){
        render_items('user', "error", page)
        return false;
    }

    await delay(2000)

    if(page <= 1){
        fetched_all_user_pages = false;
    }

    $.ajax(userSettings)
    .fail(async function (res){ 
        $('.item-grid #user-grid .invisible-item').remove()

        $(`#user-item-grid`).empty()
        if(typeof res?.responseJSON?.message == "string"){
            $(`#user-item-grid`).append(`<div class="inventory-message"> ${res?.responseJSON?.message}.</div>`)
        } else {
            $(`#user-item-grid`).append(`<div class="inventory-message"> ${__('trade.inventory_error')}</div>`)
        }
        $(`.loading-items#user-loading`).addClass('hidden')
        processing_user_inventory = false;
    })
    .done(async function (response) {
        last_load_user.filters = JSON.stringify(UserTrade.filters);
        document.querySelectorAll('.filter-btn').forEach((btn) => {
            if(!btn.parentElement.querySelector('.filter-box').classList.contains('hidden')){
                btn.parentElement.querySelector('.filter-box').classList.toggle('hidden')
            }
            if(btn.classList.contains('active')){
                btn.classList.toggle('active')
            }
        })
        
        // save response in FE and render it for 30sec -> then allow refresh
        if(await response?.success == 1){
            user_trusted.bptf = response?.inventory?.userTrust

            if( response.inventory.items.length < response?.page_limit ){ fetched_all_user_pages = true }
            if(Array.isArray(UserTrade.inventory)){
                UserTrade.inventory.push(...response?.inventory?.items);
            } else {
                UserTrade.inventory = response?.inventory?.items;
            }
            UserTrade.pure = response?.inventory?.pure;
            UserTrade.pureAssets.key = response.keys;
            UserTrade.pureAssets.ref = response.refs;
            UserTrade.pureAssets.rec = response.recs;
            UserTrade.pureAssets.scrap = response.scraps;
            await render_items('user', await response, page, change, fetched_all_user_pages)
            if(response?.fallback){
                $('.trade-inv-window.user-window').append(`<div class="fallback"><span aria-label="${__('trade.fallback_tooltip')}" data-microtip-position="top-right" role="tooltip">&#128712;</span> ${__('trade.fallback_from')} <span>${formatUnixTimestamp(response?.update)}</span></div>`)
            } else if($('.trade-inv-window.user-window .fallback').length) {
                $('.trade-inv-window.user-window .fallback').remove()
            }
        }
        else{
            await render_items('user', await response, page)
            if(response?.error == "You already have an active offer from our bots!"){
                socket.emit('getTradeOffer')
            }
        }

        $(`.loading-items#user-loading`).addClass('hidden')
        processing_user_inventory = false;
    });
}

const round_ref = (refs, direction) => {
    let ref = Math.trunc(refs);
    let ref_float = refs - ref;
    ref_float = parseFloat(ref_float.toFixed(5));

    const steps = [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 1];
    let float;

    if (direction === "up") {
        float = steps.find(s => s >= ref_float) ?? 1;
    } else if (direction === "down") {
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i] <= ref_float) {
                float = steps[i];
                break;
            }
        }
        if (float === undefined) float = 0;
    } else {
        float = steps.reduce((a, b) =>
            Math.abs(b - ref_float) < Math.abs(a - ref_float) ? b : a
        );
    }

    if (ref + ref_float === 0.05) {
        return 0.05;
    }

    return parseFloat((ref + float).toFixed(2));
}

console.log(itemAttr.Quality);


export const create_sku = (bp_sku, qualityID, f, ks) => {
    if(f === 0 && ks === 0){ return bp_sku; }

    const killstreak = itemAttr.killstreaks[ks];

    if(qualityID == 6){
        if(bp_sku.startsWith('The ')){
            if(ks > 0){
                bp_sku = bp_sku.replace('The ', killstreak)
                if(f > 0){
                    bp_sku = bp_sku.replace(killstreak, 'Festivized ' + killstreak)
                }
            } else if(f > 0){
                bp_sku = bp_sku.replace('The ', 'Festivized ' + killstreak)
            }
        } else {
            if(ks > 0){
                bp_sku = killstreak + bp_sku;
                if(f > 0){
                    bp_sku = bp_sku.replace(killstreak, 'Festivized ' + killstreak)
                }
            } else if(f > 0){
                bp_sku = 'Festivized ' + bp_sku;
            }
        }
    } else if(qualityID == 5){
        if(bp_sku.includes('Strange ')){

        } else {

        }
    } else {
        if(bp_sku.includes(itemAttr.Quality[qualityID]?.name)){
            if(ks > 0){
                bp_sku = bp_sku.replace(itemAttr.Quality[qualityID]?.name + " ", itemAttr.Quality[qualityID]?.name + " " + killstreak);
                if(f > 0){
                    bp_sku = bp_sku.replace(killstreak, 'Festivized ' + killstreak)
                }
            } else if(f > 0){
                bp_sku = bp_sku.replace(itemAttr.Quality[qualityID]?.name, itemAttr.Quality[qualityID]?.name + " Festivized");
            }
        }
    }

    return bp_sku;
}

// ---------------------------------------------------------------------------
// Item page: killstreak tiers
//
// item.killstreak comes from the pricing manager as [{ ks_tier, buy, sell, stock }]
// (the older { killstreaks: [{ kt, bp_sku, buy: {key, metal}, ... }] } shape works too).
// Every asset carries its own tier in asset.ks (0 = no killstreak), and is priced
// with that tier's price. A tier without a price falls back to the item's price.
// ---------------------------------------------------------------------------

const KS_NAMES = ['', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak'];

const ks_tier_number = (value) => {
    if(value === undefined || value === null || value === '') return 0;
    if(!isNaN(Number(value))) return Number(value);
    const name = String(value).trim().toLowerCase();
    if(name.startsWith('pro')) return 3;
    if(name.startsWith('spec')) return 2;
    if(name.startsWith('kill')) return 1;
    return 0;
}

// a price in ref; {key, metal} is turned into ref with the item's key price
const ks_ref = (value) => {
    if(value === undefined || value === null) return null;
    if(typeof value == 'object'){
        const ref = (Number(value.key) || 0) * (typeof itemKey == 'number' ? itemKey : 0) + (Number(value.metal) || 0);
        return ref > 0 ? ref : null;
    }
    const ref = Number(value);
    return ref > 0 ? ref : null;
}

const ks_tiers = () => {
    if(typeof item == 'undefined' || !item) return [];
    const raw = Array.isArray(item.killstreak) ? item.killstreak : (item.killstreak?.killstreaks || []);
    return raw.map(entry => {
        const tier = ks_tier_number(entry?.ks_tier ?? entry?.kt ?? entry?.tier);
        const stock = (typeof entry?.stock == 'object' && entry.stock) ? entry.stock : (entry?.stock !== undefined ? { cur: Number(entry.stock) || 0 } : null);
        return { tier, buy: ks_ref(entry?.buy), sell: ks_ref(entry?.sell), stock, bp_sku: entry?.bp_sku || ks_name(tier), updated: entry?.updated };
    }).filter(entry => entry.tier >= 1 && entry.tier <= 3).sort((a, b) => a.tier - b.tier);
}

// "Rocket Launcher" + 3 -> "Professional Killstreak Rocket Launcher" (same naming as the trade page)
const ks_name = (tier) => {
    if(typeof item == 'undefined' || !item || !(tier > 0)) return item?.bp_sku;
    const named = create_sku(item.bp_sku, item.qualityID, 0, tier);
    return (named != item.bp_sku) ? named : itemAttr.killstreaks[tier] + item.bp_sku;
}

// The tier picked in the item page's select (main.js sets ItemTrade.tier / ItemTrade.stock).
// Sell/buy then lists only that tier; "None" lists items without a killstreak and tiers that have no own price.
const tier_visible = (asset) => {
    const tiers = ks_tiers();
    if(tiers.length == 0) return true;
    const tier = Number(asset?.ks) || 0;
    if(ItemTrade.tier > 0) return tier == ItemTrade.tier;
    return tier == 0 || !tiers.some(t => t.tier == tier);
}

// stock used for the "can buy" limit: the selected tier's own stock if it has one
const single_stock = () => {
    const stock = ItemTrade.stock || itemStock || {};
    return { cur: Number(stock.cur) || 0, limit: Number(stock.limit) || 0 };
}

// price in ref of one asset (or of a tier number) on the item page
const single_price = (asset_or_tier, selling) => {
    const tier = (typeof asset_or_tier == 'object') ? (Number(asset_or_tier?.ks) || 0) : (Number(asset_or_tier) || 0);
    const base = selling ? itemBuy : itemSell;
    if(tier > 0){
        const entry = ks_tiers().find(t => t.tier == tier);
        const price = selling ? entry?.buy : entry?.sell;
        if(price > 0) return price;
    }
    return base;
}

// 110.11 ref -> "1 key 50 ref" (the price text used on the item page)
const price_text = (ref) => {
    const key = (typeof itemKey == 'number' && itemKey > 0) ? itemKey : 0;
    const keys = key ? Math.floor(ref / key) : 0;
    const metal = round_ref(ref - keys * key);
    return (keys > 0) ? `${keys} key ${metal} ref` : `${metal} ref`;
}

// ---------------------------------------------------------------------------
// Item stacking
//
// Assets that share the same killstreak tier (ks), attributes (at) and
// festivized flag (f) are visually identical and functionally interchangeable,
// so they're grouped into a single "stack" element instead of one element per
// asset. On the site side, the owning bot (ownerId) is also part of the key:
// you can only trade with one bot at a time, so identical items split across
// two different bots must stay two separate stacks.
//
// Design:
// - `data-assetids` on a BROWSE-GRID item is always the FULL, static list of
//   every asset in that stack (it doesn't shrink as items are added/removed;
//   in/partial/available state is recomputed live from UserTrade/SiteTrade).
// - `data-assetids` on a TRADE-PANEL item is the SUBSET actually added from
//   that stack, and does shrink/grow as the user adds/removes.
// - `data-stack-sig` links a browse-grid stack to its trade-panel counterpart
//   without depending on any specific assetid (since the panel's id list is
//   a moving subset of the grid's).
// ---------------------------------------------------------------------------

const stable_stringify = (val) => {
    if (Array.isArray(val)) {
        return `[${val.map(stable_stringify).join(',')}]`;
    }
    if (val && typeof val === 'object') {
        return `{${Object.keys(val).sort().map(k => `${JSON.stringify(k)}:${stable_stringify(val[k])}`).join(',')}}`;
    }
    return JSON.stringify(val);
};

// Deterministic, HTML-attribute-safe signature for a stack. Two assets get
// the same signature iff they should render/merge as the same stack. Must
// include the item's own identity (bp_sku) - without it, two different
// items that both happen to have no killstreak/attributes (the common case)
// would hash identically and incorrectly merge together.
const stack_sig = (asset, bp_sku) => {
    const raw = stable_stringify({
        item: bp_sku || null,
        f: asset?.f || 0,
        ks: asset?.ks || 0,
        bot: asset?.ownerId || null,
        at: asset?.at || null
    });
    try {
        return btoa(unescape(encodeURIComponent(raw))).replace(/[=+/]/g, '');
    } catch (e) {
        // Fallback: non-cryptographic hash, in case btoa/unicode ops are unavailable.
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return 'h' + Math.abs(hash);
    }
};

const group_assets = (assets) => {
    const groups = new Map();
    for (const asset of (assets || [])) {
        const key = stack_sig(asset);
        if (!groups.has(key)) { groups.set(key, []); }
        groups.get(key).push(asset);
    }
    return groups;
};

// Reads the assetid list off an <.item> element. Prefers the new plural
// data-assetids (stacked elements); falls back to the old singular
// data-assetid so any render path that still uses it keeps working.
const read_assetids = (item_el) => {
    const plural = item_el?.getAttribute('data-assetids');
    if(plural){ return plural.split(',').filter(Boolean); }
    const single = item_el?.getAttribute('data-assetid');
    return single ? [single] : [];
};

// Of this stack's assets, which ones are NOT already in `trade` - i.e. how
// many (and which) could still be added from clicking this element.
const get_available_ids = (trade, item_el) => {
    const iit_ids = trade.iit.items.map(i => i.a);
    return read_assetids(item_el).filter(id => !iit_ids.includes(id));
};

// Of this stack's assets, which ones can be removed by clicking `item_el`.
// A trade-panel entry's data-assetids IS the in-trade subset already; a
// browse-grid element's data-assetids is the full static group, so it needs
// intersecting against what's actually in the trade.
const get_removable_ids = (trade, item_el) => {
    const is_panel_item = !!item_el.closest('.items-in-trade');
    if(is_panel_item){ return read_assetids(item_el); }
    const iit_ids = trade.iit.items.map(i => i.a);
    return read_assetids(item_el).filter(id => iit_ids.includes(id));
};

(function inject_stack_styles(){
    if(document.getElementById('stack-styles')) return;
    const style = document.createElement('style');
    style.id = 'stack-styles';
    // stack badge; the quantity picker is styled in scss/partials/_modals.scss
    style.textContent = `
        .item.stacked { position: relative; }
        .item .stack-count {
            position: absolute;
            bottom: 3px;
            right: 3px;
            min-width: 18px;
            box-sizing: border-box;
            text-align: center;
            background: rgba(8, 12, 40, 0.86);
            border: 1px solid rgba(255, 255, 255, 0.18);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            line-height: 1;
            padding: 3px 6px;
            border-radius: 999px;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
})();

// Opens the select_items modal (declared in main.js's `modals`, reusing the
// same .modal_overlay .modal shell tradeOfferConnection drives) letting the
// user choose a quantity between 1 and `max`, then calls on_confirm(qty).
// `label` becomes the confirm button's text ('Add' or 'Remove') so it
// matches the action being taken. If max <= 1 there's no real choice to
// make, so it skips the modal entirely and just runs on_confirm(1).
const open_qty_picker = (anchor_el, max, on_confirm, label = __('trade.add')) => {
    if(max <= 1){
        on_confirm(1);
        return;
    }

    const modal = document.querySelector('.modal_overlay .modal');
    if(!modal){
        // No modal shell in the DOM for some reason - fall back to adding
        // everything available rather than silently doing nothing.
        on_confirm(max);
        return;
    }

    // Don't leave the hover tooltip floating over/behind the modal.
    document.getElementById('item_tooltip')?.classList.remove('show');

    const removing = label === __('trade.remove');
    const item_label = anchor_el?.getAttribute('data-bp_sku') || anchor_el?.getAttribute('data-name') || '';
    const image = anchor_el?.querySelector('img')?.getAttribute('src') || '';
    const quality = anchor_el?.getAttribute('data-quality') || '';
    const esc_html = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const half = Math.max(1, Math.round(max / 2));
    const presets = [...new Set([1, half, max])].filter((n) => n >= 1 && n <= max);

    modal.querySelector('.modal_header .modal_name').textContent = __('trade.qty_items', { action: label });
    modal.querySelector('.modal_content').innerHTML = `
        <div class="qty-picker ${removing ? 'is-remove' : 'is-add'}">
            <div class="qty-item">
                <div class="qty-thumb q-${esc_html(quality)}">${image ? `<img src="${esc_html(image)}" alt="">` : ''}</div>
                <div class="qty-item-text">
                    <strong translate="no">${esc_html(item_label)}</strong>
                    <span>${removing ? __('trade.qty_in_trade', { count: max }) : __('trade.qty_available', { count: max })}</span>
                </div>
            </div>

            <p class="qty-question">${removing ? __('trade.qty_how_many_remove') : __('trade.qty_how_many_add')}</p>

            <div class="qty-stepper">
                <button type="button" class="qty-step qty-minus" aria-label="-1">&minus;</button>
                <input type="number" class="qty-input" min="1" max="${max}" value="1" inputmode="numeric" aria-label="${esc_html(label)}">
                <button type="button" class="qty-step qty-plus" aria-label="+1">+</button>
            </div>

            <input type="range" class="qty-range" min="1" max="${max}" value="1" step="1" aria-hidden="true" tabindex="-1">

            <div class="qty-presets">
                ${presets.map((n) => `<button type="button" class="qty-preset ${n == max ? 'qty-max' : ''}" data-qty="${n}">${n == max ? __('trade.qty_max', { max }) : n}</button>`).join('')}
            </div>

            <div class="qty-actions">
                <button type="button" class="qty-cancel">${__('trade.cancel')}</button>
                <button type="button" class="qty-confirm">${esc_html(label)} <span class="qty-confirm-count">1</span>&times;</button>
            </div>
        </div>
    `;

    const input = modal.querySelector('.qty-input');
    const range = modal.querySelector('.qty-range');
    const count = modal.querySelector('.qty-confirm-count');

    const set_qty = (value) => {
        const qty = clamp(parseInt(value) || 1, 1, max);
        input.value = qty;
        range.value = qty;
        count.textContent = qty;
        range.style.setProperty('--fill', `${max > 1 ? ((qty - 1) / (max - 1)) * 100 : 100}%`);
        modal.querySelector('.qty-minus').disabled = qty <= 1;
        modal.querySelector('.qty-plus').disabled = qty >= max;
        modal.querySelectorAll('.qty-preset').forEach((b) => b.classList.toggle('active', Number(b.dataset.qty) === qty));
    };
    set_qty(1);

    modal.querySelector('.qty-minus').addEventListener('click', () => set_qty((parseInt(input.value) || 1) - 1));
    modal.querySelector('.qty-plus').addEventListener('click', () => set_qty((parseInt(input.value) || 1) + 1));
    modal.querySelectorAll('.qty-preset').forEach((b) => b.addEventListener('click', () => set_qty(b.dataset.qty)));
    range.addEventListener('input', () => set_qty(range.value));
    input.addEventListener('input', () => { if(input.value !== ''){ set_qty(input.value) } });
    input.addEventListener('blur', () => set_qty(input.value));

    const confirm_qty = () => {
        const qty = clamp(parseInt(input.value) || 1, 1, max);
        main.toggleModal(main.modals.select_items, 'close');
        on_confirm(qty);
    };
    modal.querySelector('.qty-confirm').addEventListener('click', confirm_qty, { once: true });
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); confirm_qty(); } });
    modal.querySelector('.qty-cancel').addEventListener('click', () => main.toggleModal(main.modals.select_items, 'close'));

    main.toggleModal(main.modals.select_items, 'open');
    setTimeout(() => { input.focus(); input.select(); }, 50);
};

// Recomputes a browse-grid stack's visual state (in-trade / stacked + badge
// count) from the live UserTrade/SiteTrade iit arrays. data-assetids on a
// grid element is always the full static group, so this can be called any
// time without needing to mutate that attribute.
const refresh_stack_state = (party, item_el) => {
    if(!item_el){ return; }
    const trade = (party === 'user') ? UserTrade : SiteTrade;
    const iit_ids = trade.iit.items.map(i => i.a);
    const all_ids = read_assetids(item_el);
    const in_trade_count = all_ids.filter(id => iit_ids.includes(id)).length;
    const remaining = all_ids.length - in_trade_count;

    // Only mark the whole stack in-trade once every asset in it is used up -
    // same as a normal single item, which only goes in-trade once its one
    // copy is added. While some copies remain, leave it unmarked (no
    // special class at all) so it stays clickable/addable; the badge count
    // already communicates that part of the stack is already in the trade.
    item_el.classList.toggle('in-trade', all_ids.length > 0 && remaining === 0);
    item_el.classList.toggle('stacked', remaining > 1);

    let badge = item_el.querySelector('.stack-count');
    if(remaining > 1){
        if(!badge){
            badge = document.createElement('div');
            badge.className = 'stack-count';
            item_el.appendChild(badge);
        }
        badge.textContent = remaining;
    } else if(badge){
        badge.remove();
    }
};

// Adds one asset to the trade panel, folding it into an existing stacked
// panel entry (same data-stack-sig) if one is already there, or cloning the
// source browse-grid element to start a new panel entry otherwise.
const add_to_trade_panel = (party, source_item_el, asset) => {
    const container = document.querySelector(`.items-in-trade #${party}-grid`);
    if(!container){ return; }

    const sig = source_item_el.getAttribute('data-stack-sig');
    let panel_item = sig ? container.querySelector(`.item[data-stack-sig="${sig}"]`) : null;

    if(panel_item){
        const ids = read_assetids(panel_item);
        ids.push(asset.a);
        panel_item.setAttribute('data-assetids', ids.join(','));
        let badge = panel_item.querySelector('.stack-count');
        if(ids.length > 1){
            if(!badge){
                badge = document.createElement('div');
                badge.className = 'stack-count';
                panel_item.appendChild(badge);
            }
            badge.textContent = ids.length;
            panel_item.classList.add('stacked');
        }
    } else {
        const clone = source_item_el.cloneNode(true);
        clone.classList.remove('in-trade', 'stacked');
        const old_badge = clone.querySelector('.stack-count');
        if(old_badge){ old_badge.remove(); }
        clone.setAttribute('data-assetids', asset.a);
        container.appendChild(clone);
    }
};

// Removes up to `qty` assets belonging to this stack from the trade (works
// whether `item_el` is the browse-grid stack or its trade-panel entry), then
// syncs both the grid stack's visual state and the panel entry's badge/removal.
const remove_from_stack = (party, item_el, qty) => {
    const trade = (party === 'user') ? UserTrade : SiteTrade;
    const is_panel_item = !!item_el.closest('.items-in-trade');
    const all_ids = read_assetids(item_el);
    const iit_ids = trade.iit.items.map(i => i.a);

    const removable_ids = is_panel_item ? all_ids : all_ids.filter(id => iit_ids.includes(id));
    const ids_to_remove = removable_ids.slice(0, qty);

    for (const id of ids_to_remove) {
        const idx = trade.iit.items.findIndex(i => i.a === id);
        if(idx > -1){ trade.iit.items.splice(idx, 1); }
    }

    const sig = item_el.getAttribute('data-stack-sig');
    const grid_el = sig ? document.querySelector(`#${party}-item-grid .item[data-stack-sig="${sig}"]`) : null;
    const panel_el = sig ? document.querySelector(`.items-in-trade #${party}-grid .item[data-stack-sig="${sig}"]`) : null;

    if(grid_el){ refresh_stack_state(party, grid_el); }

    if(panel_el){
        const remaining_ids = read_assetids(panel_el).filter(id => !ids_to_remove.includes(id));
        if(remaining_ids.length === 0){
            panel_el.remove();
        } else {
            panel_el.setAttribute('data-assetids', remaining_ids.join(','));
            let badge = panel_el.querySelector('.stack-count');
            if(remaining_ids.length > 1){
                if(!badge){
                    badge = document.createElement('div');
                    badge.className = 'stack-count';
                    panel_el.appendChild(badge);
                }
                badge.textContent = remaining_ids.length;
            } else if(badge){
                badge.remove();
            }
        }
    }

    update_trade();
};

const render_items = async (party, items, page, change, fetched_all_pages) => {
    try {
        
    let grid = $(`<div class='grid' id='${party.replace('-user', '').replace('-site', '')}-grid'></div>`);
    let loading = $(`.loading-items#${party.replace('-user', '').replace('-site', '')}-loading`);

    if(party === "trade-user" && items?.items){
        const item_desc = item;
        const assets = items?.items;
        const classes = (item?.classes instanceof Array && party == "trade-user") ? item?.classes.join(","):"";
        const craftable = (item_desc?.bp_sku?.includes('Non-Craftable')) ? "non-craftable":"craftable"

        if(item_desc?.image.startsWith('ms/')){
            item_desc.image = item_desc.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/')
        }

       for (const asset of assets) {        
            if(item_desc){
                let item_image = item_desc.image;
                if(asset?.icon_url){
                    item_image = img_prefix + asset?.icon_url;
                }

                const ks_class = (asset?.ks > 0) ? `ks${asset?.ks}`:"";
                grid.append($(`<div class="item q-${item_desc?.qualityID} ${craftable} ${ks_class}" data-assetid="${asset.a}" data-quality="${item_desc?.qualityID}" data-effect="${item_desc?.effectID}" data-name="${item_desc.bp_sku}" data-bp_sku="${create_sku(item_desc?.bp_sku, item_desc.qualityID, asset?.f, asset?.ks)}" data-type="${item_desc?.type}" data-price="${single_price(asset, true)}" data-classes="${classes}" data-tradable="1" style="background-image: url('https://api.backpack.tf/images/440/particles/${item?.effectID}_94x94.png')"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="${item_image}" loading="lazy"></div>`)   )
            }         
        }

        $(`.loading-items#trade-loading`).addClass('hidden')
        $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).empty()
        $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).append(grid)
        build_item_filters(party, assets) // paint, spells, ... (only the ones that differ)
        return;
    } else if(party === "trade-site" && items?.items){
        const item_desc = item;
        const assets = items?.items;
        const classes = (item?.classes instanceof Array && party == "trade-site") ? item?.classes.join(","):"";
        const craftable = (item_desc?.bp_sku?.includes('Non-Craftable')) ? "non-craftable":"craftable"

        if(item_desc?.image.startsWith('ms/')){
            item_desc.image = item_desc.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/')
        }

       for (const asset of assets) {
            let item_image = item_desc.image;
            if(asset?.icon_url){
                item_image = img_prefix + asset?.icon_url;
            }

            const ks_class = (asset?.ks > 0) ? `ks${asset?.ks}`:"";
            if(item_desc){
                grid.append($(`<div class="item q-${item_desc?.qualityID} ${craftable} ${ks_class}" data-assetid="${asset.a}" data-bot="${asset.ownerId}" data-quality="${item_desc?.qualityID}" data-effect="${item_desc?.effectID}" data-name="${item_desc.bp_sku}" data-bp_sku="${create_sku(item_desc?.bp_sku, item_desc.qualityID, asset?.f, asset?.ks)}" data-type="${item_desc?.type}" data-price="${single_price(asset, false)}" data-classes="${classes}" data-tradable="1" style="background-image: url('https://api.backpack.tf/images/440/particles/${item?.effectID}_94x94.png')"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="${item_image}" loading="lazy"></div>`)   )
            }
        }

        $(`.loading-items#trade-loading`).addClass('hidden')

        $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).empty()
        $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).append(grid)
        build_item_filters(party, assets) // bot (same as the trade window), paint, spells, ...
        return;
    }

    if(items?.success == 0 || items?.error || items == "error"){
        $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).empty()
        const error = (items?.error) ? items.error : null;
        if(party == 'user'){
            $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).append(`<div class="inventory-message">${error || __('trade.inventory_private')}</div>`)
        } else {
            $(`#${party.replace('-user', '').replace('-site', '')}-item-grid`).append(`<div class="inventory-message"> ${error ? error : __('trade.no_items_of_type')}</div>`)
        }
        loading.addClass('hidden')
        return false;
    }

    const key_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ/330x192';
    const ref_image = 'fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbZQsUYhTkhzJWhsO1Mv6NGucF1Ygzt8ZQijJukFMiMrbhYDEwI1yRVKNfD6xorQ3qW3Jr6546DNPuou9IOVK4p4kWJaA/330x192'

    const pure = items.inventory.pure;
    const scrapRefs = round_ref(Number(pure.scrap) / 9)
    const recRefs = round_ref(Number(pure.rec) / 3)
    const refs_count = round_ref(pure.ref + recRefs + scrapRefs)
    const keys_count = pure.key
    const keys = $(`<div class="pure keys" data-quality="Unique" data-type="Pure" data-count="${keys_count}" data-name="Mann Co. Supply Crate Key"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="https://community.cloudflare.steamstatic.com/economy/image/${key_image}"><div class='pure-count'>${keys_count}</div></div>`);
    const refs = $(`<div class="pure refs" data-quality="Unique" data-type="Pure" data-count="${refs_count}" data-name="Refined Metal"><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="https://community.cloudflare.steamstatic.com/economy/image/${ref_image}"><div class='pure-count'>${refs_count}</div></div>`);
    
    if(pure.ref == 0 && pure.key == 0 && items.inventory.items.length == 0){
        if(party == 'user'){
            $(`#${party}-item-grid`).empty()
            $(`#${party}-item-grid`).append(`<div class="inventory-message">${__('trade.none_tradable')}</div>`)
            UserTrade.inventory = null;
            UserTrade.pure = null;
            loading.addClass('hidden')
        } else {
            if(page == 0){
                $(`#${party}-item-grid`).empty()
                $(`#${party}-item-grid`).append(`<div class="inventory-message">${__('trade.none_tradable')}</div>`)
                SiteTrade.inventory = null;
                SiteTrade.pure = null;
                loading.addClass('hidden')
            } else {
                loading.addClass('hidden')
            }
        }
        return false;
    }

    if(page == 0 || change == 'change'){
        grid.append([keys, refs])
    } else {
        $(`#${party}-item-grid .pure.keys`).attr('data-count', keys_count)
        $(`#${party}-item-grid .pure.keys .pure-count`).text(keys_count  + 'x')
        $(`#${party}-item-grid .pure.refs`).attr('data-count', refs_count)
        $(`#${party}-item-grid .pure.refs .pure-count`).text(Math.trunc(refs_count) + 'x')
    }
    const items_ = items.inventory.items;
    
    if(items.inventory.items.length == 0){
        // display items

        $(`#${party}-item-grid`).empty()
        $(`#${party}-item-grid`).append(grid)
        loading.addClass('hidden')
        
        return false;
    }

    const eff_arr = JSON.parse(localStorage.getItem('unusual_effects'))

    const site_iit_assetids = SiteTrade.iit.items.map(function(item) {
        return item['a'];
    });
    const user_iit_assetids = UserTrade.iit.items.map(function(item) {
        return item['a'];
    });

    $(`.item-grid #${party}-grid .invisible-item`).remove()

    for (const [i,item] of items_.entries()){
        const classes = (item?.classes instanceof Array && party == "user") ? item?.classes.join(","):""

        if(party == 'site'){
            if(item?.image.startsWith('ms/')){
                item.image = item.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/')
            }

            if('bp_sku' in item && 'sell' in item){
                const craftable = (item?.bp_sku?.includes('Non-Craftable')) ? "non-craftable":"craftable"
                const asset_groups = group_assets(item.stock.items)

                for (const group of asset_groups.values()) {
                    const rep = group[0];
                    const all_ids = group.map(a => a.a);
                    const in_trade_count = all_ids.filter(id => site_iit_assetids.includes(id)).length;
                    const remaining = all_ids.length - in_trade_count;

                    let item_image = item.image;
                    if(rep?.icon_url){
                        item_image = img_prefix + rep?.icon_url;
                    }

                    const ks_class = (rep?.ks > 0) ? `ks${rep?.ks}`:"";
                    const stacked_class = (remaining > 1) ? "stacked" : "";
                    const badge = (remaining > 1) ? `<div class="stack-count">${remaining}</div>` : "";
                    const bg_style = (item.effectID > 0) ? `style="background-image: url('https://api.backpack.tf/images/440/particles/${item?.effectID}_94x94.png')"` : "";
                    const sig = stack_sig(rep, item.bp_sku);

                    const item_el = $(`<div class="item q-${item?.qualityID} ${craftable} ${(remaining === 0) ? 'in-trade':''} ${ks_class} ${stacked_class}" data-assetids="${all_ids.join(',')}" data-stock="${all_ids.length}" data-stack-sig="${sig}" data-classid="${item?.classid}" data-bot="${rep?.ownerId || ''}" data-quality="${item?.qualityID}" data-effect="${item.effectID > 0 ? item?.effectID : 'null'}" data-name="${item.bp_sku}" data-bp_sku="${create_sku(item?.bp_sku, item.qualityID, rep?.f, rep?.ks)}" data-type="${item?.type}" data-price="${item?.sell}" data-classes="${classes}" data-tradable="1" ${bg_style}><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="${item_image}" loading="lazy">${badge}</div>`)

                    if(page < 1){
                        grid.append(item_el)
                    } else {
                        $(`#${party}-item-grid #${party}-grid`).append(item_el)
                    }
                }
            }
        } else if(party == 'user'){
            if(item?.image.startsWith('ms/')){
                item.image = item.image.replace('ms/', 'http://media.steampowered.com/apps/440/icons/')
            }

            if('bp_sku' in item && 'buy' in item){
                const craftable = (item?.bp_sku?.includes('Non-Craftable')) ? "non-craftable":"craftable"
                const in_trade_all = UserTrade.iit.items.filter(itm => itm.bp_sku == item.bp_sku)
                const overstocked = (item?.stock?.cur + in_trade_all?.length >= item?.stock?.limit) ? 'over-stocked':''

                const asset_groups = group_assets(item.user_stock)

                for (const group of asset_groups.values()) {
                    const rep = group[0];
                    const all_ids = group.map(a => a.a);
                    const in_trade_count = all_ids.filter(id => user_iit_assetids.includes(id)).length;
                    const remaining = all_ids.length - in_trade_count;

                    let item_image = item.image;
                    if(rep?.icon_url){
                        item_image = img_prefix + rep?.icon_url;
                    }

                    const ks_class = (rep?.ks > 0) ? `ks${rep?.ks}`:"";
                    const stacked_class = (remaining > 1) ? "stacked" : "";
                    const badge = (remaining > 1) ? `<div class="stack-count">${remaining}</div>` : "";
                    const bg_style = (item.effectID > 0) ? `style="background-image: url('https://api.backpack.tf/images/440/particles/${item?.effectID}_94x94.png')"` : "";
                    const sig = stack_sig(rep, item.bp_sku);

                    const item_el = $(`<div class="item q-${item?.qualityID} ${craftable} ${(remaining === 0) ? 'in-trade':''} ${ks_class} ${stacked_class} ${overstocked}" data-assetids="${all_ids.join(',')}" data-stock="${all_ids.length}" data-stack-sig="${sig}" data-classid="${item?.classid}" data-quality="${item?.qualityID}" data-effect="${item.effectID > 0 ? item?.effectID : 'null'}" data-name="${item.bp_sku}" data-bp_sku="${create_sku(item?.bp_sku, item.qualityID, rep?.f, rep?.ks)}" data-type="${item?.type}" data-price="${item?.buy}" data-classes="${classes}" data-tradable="1" ${bg_style}><img class="item-img lazy-fade" onload="this.classList.add('loaded')" src="${item_image}" loading="lazy">${badge}</div>`)

                    if(page < 1){
                        grid.append(item_el)
                    } else {
                        $(`#${party}-item-grid #${party}-grid`).append(item_el)
                    }
                }
            }
        }

        if(i === items_.length - 1){            
            if(party == 'user'){
                if(page == 0){
                    
                    $(`#${party}-item-grid`).empty()
                    $(`#${party}-item-grid`).append(grid)
                    if(!fetched_all_pages){
                        $(`#${party}-item-grid #${party}-grid`).append(`<div class="item invisible-item"><img class="item-img" src="/img/trade-icon.jpg"></div>`)
                    }

                    put_novalue_last(party)
                    loading.addClass('hidden')
                    if(change != 'change'){
                        reset_filters(party, 'init')
                    }
                } else {

                    put_novalue_last(party)
                    loading.addClass('hidden')
                    if(!fetched_all_pages){
                        $(`#${party}-item-grid #${party}-grid`).append(`<div class="item invisible-item"><img class="item-img" src="/img/trade-icon.jpg"></div>`)
                    }
                }
            } else {
                if(page == 0){
                    if(!fetched_all_pages){
                        grid.append(`<div class="item invisible-item"><img class="item-img" src="/img/trade-icon.jpg"></div>`)
                    }
                    $(`#${party}-item-grid`).empty()
                    $(`#${party}-item-grid`).append(grid)
                    put_novalue_last(party)
                    loading.addClass('hidden')
                    if(change != 'change'){
                        reset_filters(party, 'init')
                    }
                } else {
                    put_novalue_last(party)
                    loading.addClass('hidden')
                    if(!fetched_all_pages){
                        $(`#${party}-item-grid #${party}-grid`).append(`<div class="item invisible-item"><img class="item-img" src="/img/trade-icon.jpg"></div>`)
                    }
                }
            }
        }
    }

    } catch (error) {
        console.error(error)
        if(page == 0){
            render_items(party, 'error', 0, 'change')
        }
    }
}

const animateBotFilter = (value) => {
    
}

const single_update_trade = async (party) => {
    const key_price = itemKey;
    const trade_total = ItemTrade.total;
    
    const keyCount = trade_total / key_price;
    const has_scrap_items = ItemTrade.iit.some(asset => single_price(asset, party === "trade-user") == 0.05);
    const refCount = has_scrap_items ? Number((keyCount - Math.trunc(keyCount)) * key_price).toFixed(3) : round_ref((keyCount - Math.trunc(keyCount)) * key_price)
    
    document.querySelector('.trade-stats #trade-count').textContent = ItemTrade.iit.length;    
    document.querySelector('.trade-total #trade-key-total').textContent = Math.trunc(keyCount);    
    // 0.550 -> 0.55 (only cut zeros after the decimal point: 50 stays 50)
    document.querySelector('.trade-total #trade-ref-total').textContent = String(refCount).includes('.') ? String(refCount).replace(/0+$/, '').replace(/\.$/, '') : refCount;

    document.querySelector(".trade-nav #trade-btn").classList.toggle('ready', ItemTrade.iit.length > 0)
    document.querySelector(".trade-nav #remove-iit")?.classList.toggle('ready', ItemTrade.iit.length > 0)
}

const single_item_to_trade = async (action, item, party) => {
    try {
        if(ItemTrade.iit.length >= 10 && action =='add'){
            iziToast.error({
                title: __('trade.item_limit_title'),
                message: __('trade.item_limit')
            });
            return false;
        } 
        if(typeof itemKey != "number" || typeof itemSell != "number" || typeof itemBuy != "number"){
            iziToast.error({
                title: __('common.error_occurred'),
                "message": __('trade.no_key_price')
            })
            return;
        }
        const asset = (ItemTrade.party == "trade-user") ? ItemTrade.items?.find(stk => stk.a == item.getAttribute('data-assetid')) : ItemTrade.items?.find(stk => stk.a == item.getAttribute('data-assetid') && stk.ownerId == item.getAttribute('data-bot'))
        if(asset){
            if(action === 'add'){
                const locked_bot = ItemTrade.iit[0]?.ownerId;
                if(ItemTrade.party == "trade-site" && locked_bot && asset.ownerId != locked_bot){
                    iziToast.error({
                        title: __('trade.one_bot_title'),
                        message: __('trade.one_bot')
                    });
                    return false;
                }
                const overstocked = (single_stock().cur + ItemTrade.iit.length >= single_stock().limit) ? true:false
                if(overstocked && party == "trade-user"){
                    iziToast.error({
                        title: __('trade.stock_limit_title'),
                        message: __('trade.stock_limit')
                    });
                    return false;
                }
                const price = single_price(asset, ItemTrade.party == "trade-user");
                ItemTrade.total += (price == 0.05) ? 0.055 : price;
                ItemTrade.iit.push(asset)
                item.classList.add('in-trade')

                // full once the items in the trade fill the free stock ("Can buy 2" -> 2 items can be picked)
                const overstocked_now = (single_stock().cur + ItemTrade.iit.length >= single_stock().limit) ? true:false
                if(overstocked_now && party == "trade-user"){
                    const all_items = document.querySelectorAll(`#trade-grid .item`)
                    
                    all_items.forEach(itm => {
                        if(itm.classList.contains('in-trade')){  }
                        else {
                            itm.classList.add('over-stocked')
                        }
                    })
                }
            } else {
                const index = (asset?.ownerId) ? ItemTrade.iit.findIndex(itm => itm.a == item.getAttribute('data-assetid') && itm.ownerId == item.getAttribute('data-bot')) : ItemTrade.iit.findIndex(itm => itm.a == item.getAttribute('data-assetid'))
                if(index > -1){
                    const price = single_price(ItemTrade.iit[index], ItemTrade.party == "trade-user");
                    ItemTrade.total -= (price == 0.05) ? 0.055 : price;
                    ItemTrade.iit.splice(index, 1)

                    const overstocked = (single_stock().cur + ItemTrade.iit.length >= single_stock().limit) ? true:false
                                    
                    if(!overstocked && party == "trade-user"){
                        const all_items = document.querySelectorAll(`#trade-grid .item`)
                        all_items.forEach(itm => {
                            itm.classList.remove('over-stocked')
                        })
                    }

                    item.classList.remove('in-trade')
                }
            }

            mark_other_bots()
            single_update_trade(party)
        } else {
            iziToast.error({
                title: __('common.error_occurred'),
                "message": __('trade.item_not_found')
            })
        }
    } catch (error) {
        iziToast.error({
            title: __('common.unknown_error'),
            "message": __('common.try_refresh')
        })
    }
}

// Item page: grey out items owned by other bots once the first item is selected.
const mark_other_bots = () => {
    const locked_bot = (ItemTrade.party == "trade-site") ? ItemTrade.iit[0]?.ownerId : null;
    document.querySelectorAll('#trade-item-grid .item').forEach(el => {
        el.classList.toggle('other-bot', Boolean(locked_bot) && el.getAttribute('data-bot') != locked_bot)
    })
}

// Item page: unselect everything ("remove selected" button and after a trade was sent).
const clear_single_items = () => {
    ItemTrade.iit = [];
    ItemTrade.total = 0;
    document.querySelectorAll('#trade-item-grid .item').forEach(el => el.classList.remove('in-trade', 'over-stocked', 'other-bot'))
    single_update_trade(ItemTrade.party)
}

// Item page: the /api/create_trade body, in the same shape the /trade page sends
// (items in trade on one side, the bot server adds the pure on the paying side).
const item_page_trade_body = () => {
    const selling = ItemTrade.party == "trade-user";
    const key_metal = key_price?.metal > 0 ? key_price.metal : itemKey;
    const items = ItemTrade.iit.map(asset => ({...asset, bp_sku: item.bp_sku, [selling ? 'buy' : 'sell']: single_price(asset, selling), stock: itemStock, key: itemKey}));
    const items_metal = items.reduce((sum, itm) => sum + ((selling ? itm.buy : itm.sell) / (itm.key || 1)) * key_metal, 0);

    const user_iit = new Trade_Object().iit;
    const site_iit = new Trade_Object().iit;
    user_iit.hash = user_id;
    site_iit.hash = user_id;

    if(selling){
        user_iit.items = items;
        user_iit.total.price = items_metal;
        site_iit.total_pure.price = items_metal;
        site_iit.total.price = items_metal;
    } else {
        site_iit.items = items;
        site_iit.total.price = items_metal;
        user_iit.total_pure.price = items_metal;
        user_iit.total.price = items_metal;
    }

    return {User: user_iit, Site: site_iit, key: key_price || {metal: itemKey}};
}

// Item page trade button states (styles: .creating / .confirmed / .denied)
const set_item_trade_btn = (state) => {
    const btn = document.querySelector('.trade-nav #trade-btn');
    if(!btn){ return; }
    btn.classList.remove('creating', 'confirmed', 'denied');
    if(state){ btn.classList.add(state); }
    if(state == 'confirmed' || state == 'denied'){
        setTimeout(() => btn.classList.remove(state), 3000);
    }
}

let currentBot = null;

const setBot = (steamid) => {
    currentBot = steamid;

    if(!steamid){ steamid = "None" }

    set_filter('site', 'bot', steamid)
    SiteTrade.filters.page = 0;
    load_site_inventory(0, "change")
}

const item_to_trade = async (party, action, item) => {
    try {
        if((!item.getAttribute('data-assetids') && !item.getAttribute('data-assetid')) || !item.getAttribute('data-name')){ 
            iziToast.error({
                title: __('trade.add_error_title'),
                message: __('trade.add_error')
            });
            return false
        }
        if(trade_req){ return false }
        if(processing_site_inventory || processing_user_inventory){ return false; }

        if((!UserTrade.pure && !UserTrade.inventory) || (!SiteTrade.pure && !SiteTrade.inventory)){
            iziToast.error({
                title: __('trade.add_error_title'),
                message: ''
            });
            return false
        }
    
        if(document.querySelector('.btn.trade-btn').classList.contains('confirmed')){
            return false;
        }
    
        document.querySelector('.btn.trade-btn').classList.remove('denied')
    
    
        if((UserTrade.iit.items.length >= 10 && action =='add' && party=='user') || (SiteTrade.iit.items.length >= 10 && action == 'add' && party=='site')){
            iziToast.error({
                title: __('trade.item_limit_title'),
                message: (party == 'user')? __('trade.limit_user'):__('trade.limit_site')
            });
            return false;
        }
    
        if(party == 'user'){
            const item_obj = UserTrade.inventory.find(itm => itm.bp_sku == item.getAttribute('data-name'))
            if(!item_obj){
                iziToast.error({
                    title: __('trade.add_error_title'),
                    message: __('trade.add_error')
                });
                return false;
            }

            if(action == 'add'){
                const available_ids = get_available_ids(UserTrade, item);

                if(available_ids.length === 0){
                    iziToast.error({
                        title: __('trade.add_error_title'),
                        message: __('trade.already_in_trade')
                    });
                    return false;
                }

                const do_add = (qty) => {
                    let added = 0;
                    for (const id of available_ids.slice(0, qty)) {
                        if(UserTrade.iit.items.length >= 10){
                            iziToast.error({
                                title: __('trade.item_limit_title'),
                                message: __('trade.limit_user')
                            });
                            break;
                        }

                        if(!user_trusted.bptf){
                            if((UserTrade.iit.total.price - UserTrade.iit.total_pure.price + ((item_obj.buy / item_obj.bptf_data.update_key_price) * key_price.metal)) / key_price.metal > 10 || SiteTrade.iit.total.price / key_price.metal > 10){
                                iziToast.error({
                                    title: __('trade.bptf_trust_title'),
                                    message: __('trade.bptf_trust')
                                });
                                break;
                            }
                        }

                        const in_trade_now = UserTrade.iit.items.filter(itm => itm.bp_sku == item.getAttribute('data-name'))
                        const overstocked = (item_obj?.stock?.cur + in_trade_now?.length >= item_obj?.stock?.limit) ? true:false
                        if(overstocked){
                            iziToast.error({
                                title: __('trade.stock_limit_title'),
                                message: __('trade.stock_limit')
                            });
                            break;
                        }

                        const asset = item_obj.user_stock.find(stk => stk.a == id);
                        if(!asset){ continue; }

                        UserTrade.iit.items.push({...asset, bp_sku: item.getAttribute('data-name'), buy: item_obj.buy, stock: item_obj.stock, key: item_obj?.bptf_data?.update_key_price})
                        add_to_trade_panel('user', item, asset);
                        added++;

                        const overstocked_now = (item_obj?.stock?.cur + in_trade_now?.length + 1 >= item_obj?.stock?.limit) ? true:false
                        if(overstocked_now){
                            const all_items = document.querySelectorAll(`#user-item-grid .item[data-name="${item.getAttribute('data-name')}"]`)
                            all_items.forEach(itm => {
                                itm.classList.add('over-stocked')
                            })
                        }
                    }

                    if(added > 0){
                        refresh_stack_state('user', item);
                        update_trade();
                    }
                };

                if(available_ids.length > 1){
                    open_qty_picker(item, available_ids.length, do_add);
                } else {
                    do_add(1);
                }

            } else if(action == 'remove'){
                const removable_ids = get_removable_ids(UserTrade, item);

                if(removable_ids.length === 0){
                    iziToast.error({
                        title: __('trade.remove_error_title'),
                        message: __('trade.remove_error')
                    });
                    return false;
                }

                const finish_remove = (qty) => {
                    remove_from_stack('user', item, qty);

                    const bp_sku = item.getAttribute('data-name');
                    const in_trade_now = UserTrade.iit.items.filter(itm => itm.bp_sku == bp_sku)
                    const overstocked = (item_obj?.stock?.cur + in_trade_now?.length >= item_obj?.stock?.limit) ? true:false
                    if(!overstocked){
                        const all_items = document.querySelectorAll(`#user-item-grid .item[data-name="${bp_sku}"]`)
                        all_items.forEach(itm => {
                            itm.classList.remove('over-stocked')
                        })
                    }
                };

                if(removable_ids.length > 1){
                    open_qty_picker(item, removable_ids.length, finish_remove, __('trade.remove'));
                } else {
                    finish_remove(1);
                }
            }

        } else if(party == 'site'){
            const item_obj = SiteTrade.inventory.find(itm => itm.bp_sku == item.getAttribute('data-name'))
            if(!item_obj){
                iziToast.error({
                    title: __('trade.add_error_title'),
                    message: __('trade.add_error')
                });
                return false;
            }

            if(action == 'add'){
                const bot_id = item.getAttribute('data-bot');
                if(currentBot && bot_id && (currentBot != bot_id)){
                    return false;
                }

                const available_ids = get_available_ids(SiteTrade, item);

                if(available_ids.length === 0){
                    iziToast.error({
                        title: __('trade.add_error_title'),
                        message: __('trade.already_in_trade')
                    });
                    return false;
                }

                const do_add = (qty) => {
                    let added = 0;
                    for (const id of available_ids.slice(0, qty)) {
                        if(SiteTrade.iit.items.length >= 10){
                            iziToast.error({
                                title: __('trade.item_limit_title'),
                                message: __('trade.limit_site')
                            });
                            break;
                        }

                        if(!user_trusted.bptf){
                            if(UserTrade.iit.total.price / key_price.metal > 10 || (SiteTrade.iit.total.price - SiteTrade.iit.total_pure.price + ((item_obj.sell / item_obj.bptf_data.update_key_price) * key_price.metal)) / key_price.metal > 10){
                                iziToast.error({
                                    title: __('trade.bptf_trust_title'),
                                    message: __('trade.bptf_trust')
                                });
                                break;
                            }
                        }

                        const asset = item_obj.stock.items.find(stk => stk.a == id);
                        if(!asset){ continue; }

                        SiteTrade.iit.items.push({...asset, bp_sku: item.getAttribute('data-name'), sell: item_obj.sell, stock: item_obj.stock, key: item_obj?.bptf_data?.update_key_price})
                        add_to_trade_panel('site', item, asset);
                        added++;

                        // Lock in the bot only once an item has actually landed in
                        // the trade - not just because the stack was clicked.
                        if(!currentBot && bot_id){
                            setBot(bot_id);
                        }
                    }

                    if(added > 0){
                        refresh_stack_state('site', item);
                        update_trade();
                    }
                };

                if(available_ids.length > 1){
                    open_qty_picker(item, available_ids.length, do_add);
                } else {
                    do_add(1);
                }

            } else if(action == 'remove'){
                const removable_ids = get_removable_ids(SiteTrade, item);

                if(removable_ids.length === 0){
                    iziToast.error({
                        title: __('trade.remove_error_title'),
                        message: __('trade.remove_error')
                    });
                    return false;
                }

                const finish_remove = (qty) => {
                    remove_from_stack('site', item, qty);
                    if(SiteTrade.iit.items.length === 0){
                        setBot(null);
                    }
                };

                if(removable_ids.length > 1){
                    open_qty_picker(item, removable_ids.length, finish_remove, __('trade.remove'));
                } else {
                    finish_remove(1);
                }
            }
        }
    } catch (error) {
        iziToast.error({
            title: __('trade.manage_error_title'),
            message: __('trade.manage_error')
        });
    }
}

const update_trade = async () => {
    try {
        const user_item_total = Object.values(UserTrade.iit.items).reduce((sum, item) => {
            const buy = item.buy || 0;
            const key = item.key || 1;
    
            return sum + (buy / key);
        }, 0);
    
        const site_item_total = Object.values(SiteTrade.iit.items).reduce((sum, item) => {
            const buy = item.sell || 0;
            const key = item.key || 1;
    
            return sum + (buy / key);
        }, 0);
    
        const key_metal = key_price.metal > 0 ? key_price.metal : SiteTrade.iit.items[0]?.key;
    
        if(!key_metal || key_metal == 0){
            clear_items()
    
            iziToast.error({
                title: __('trade.totals_error_title'),
                message: __('trade.totals_error')
            });
            return false;
        }
    
        const user_item_metal = user_item_total*key_metal
        const site_item_metal = site_item_total*key_metal
    
        const user_key_el = document.querySelector(`.item-grid #user-grid .pure.keys`)
        const user_ref_el = document.querySelector(`.item-grid #user-grid .pure.refs`)
        const site_key_el = document.querySelector(`.item-grid #site-grid .pure.keys`)
        const site_ref_el = document.querySelector(`.item-grid #site-grid .pure.refs`)
    
        const user_key_it_el = document.querySelector(`.items-in-trade #user-grid .pure.keys`)
        const user_ref_it_el = document.querySelector(`.items-in-trade #user-grid .pure.refs`)
        const site_key_it_el = document.querySelector(`.items-in-trade #site-grid .pure.keys`)
        const site_ref_it_el = document.querySelector(`.items-in-trade #site-grid .pure.refs`)
    
        const trade_key_limit = clamp(Math.trunc(10 * key_metal), 330, 800);
        const trade_ref_limit = clamp(10 * key_metal, 330, 650);
        const trade_rec_limit = 150;
        const trade_scrap_limit = 150;
    
        if(round_ref(user_item_metal) > round_ref(site_item_metal)){
            const diff = user_item_metal - site_item_metal
            const keys_diff = Math.trunc(diff / key_metal)
            const metal_diff = round_ref(diff - (keys_diff * key_metal))
    
            UserTrade.iit.total_pure.price = 0
            SiteTrade.iit.total_pure.price = diff
    
            let keys_to_add = keys_diff; 
            let metal_to_add = metal_diff;
    
            let keys_added = 0;
            let refs_added = 0;
            let recs_added = 0;
            let scraps_added = 0;
    
            
    
            SiteTrade.iit.pure.key = keys_added
            SiteTrade.iit.pure.ref = refs_added
            SiteTrade.iit.pure.rec = recs_added
            SiteTrade.iit.pure.scrap = scraps_added
    
            if(metal_diff > 0){
                if(!site_ref_it_el){
                    const copy_ref_el = site_ref_el.cloneNode(true)
                    copy_ref_el.setAttribute('data-count', metal_diff)
                    copy_ref_el.querySelector('.pure-count').textContent = metal_diff 
                    document.querySelector(`.items-in-trade #site-grid`).prepend(copy_ref_el)
                } else {
                    site_ref_it_el.setAttribute('data-count', metal_diff)
                    site_ref_it_el.querySelector('.pure-count').textContent = metal_diff 
                }
            } else {
                if(site_ref_it_el){
                    document.querySelector(`.items-in-trade #site-grid`).removeChild(site_ref_it_el)
                }
            }
    
            if(keys_diff > 0){
                if(!site_key_it_el){
                    const copy_key_el = site_key_el.cloneNode(true)
                    copy_key_el.setAttribute('data-count', keys_diff)
                    copy_key_el.querySelector('.pure-count').textContent = keys_diff
                    document.querySelector(`.items-in-trade #site-grid`).prepend(copy_key_el)
                } else {
                    site_key_it_el.setAttribute('data-count', keys_diff)
                    site_key_it_el.querySelector('.pure-count').textContent = keys_diff
                }
            } else {
                if(site_key_it_el){
                    document.querySelector(`.items-in-trade #site-grid`).removeChild(site_key_it_el)
                }
            }
    
            if(user_ref_it_el){
                document.querySelector(`.items-in-trade #user-grid`).removeChild(user_ref_it_el)
            }
            if(user_key_it_el){
                document.querySelector(`.items-in-trade #user-grid`).removeChild(user_key_it_el)
            }
        } else if(round_ref(user_item_metal) < round_ref(site_item_metal)){
            const diff = site_item_metal - user_item_metal
            const keys_diff = Math.trunc(diff / key_metal)
            const metal_diff = round_ref(diff - (keys_diff * key_metal))
    
            let keys_to_add = keys_diff; 
            let metal_to_add = metal_diff;
    
            let keys_added = 0;
            let refs_added = 0;
            let recs_added = 0;
            let scraps_added = 0;
    
            UserTrade.iit.total_pure.price = diff
            SiteTrade.iit.total_pure.price = 0
    
            UserTrade.iit.pure.key = keys_added
            UserTrade.iit.pure.ref = refs_added
            UserTrade.iit.pure.rec = recs_added
            UserTrade.iit.pure.scrap = scraps_added
    
            if(metal_diff > 0){
                if(!user_ref_it_el){
                    const copy_ref_el = user_ref_el.cloneNode(true)
                    copy_ref_el.setAttribute('data-count', metal_diff)
                    copy_ref_el.querySelector('.pure-count').textContent = metal_diff 
                    document.querySelector(`.items-in-trade #user-grid`).prepend(copy_ref_el)
                } else {
                    user_ref_it_el.setAttribute('data-count', metal_diff)
                    user_ref_it_el.querySelector('.pure-count').textContent = metal_diff 
                }
            } else {
                if(user_ref_it_el){
                    document.querySelector(`.items-in-trade #user-grid`).removeChild(user_ref_it_el)
                }
            }
    
            if(keys_diff > 0){
                if(!user_key_it_el){
                    const copy_key_el = user_key_el.cloneNode(true)
                    copy_key_el.setAttribute('data-count', keys_diff)
                    copy_key_el.querySelector('.pure-count').textContent = keys_diff
                    document.querySelector(`.items-in-trade #user-grid`).prepend(copy_key_el)
                } else {
                    user_key_it_el.setAttribute('data-count', keys_diff)
                    user_key_it_el.querySelector('.pure-count').textContent = keys_diff
                }
            } else {
                if(user_key_it_el){
                    document.querySelector(`.items-in-trade #user-grid`).removeChild(user_key_it_el)
                }
            }
    
            if(site_ref_it_el){
                document.querySelector(`.items-in-trade #site-grid`).removeChild(site_ref_it_el)
            }
            if(site_key_it_el){
                document.querySelector(`.items-in-trade #site-grid`).removeChild(site_key_it_el)
            }
        } else {
            if(site_ref_it_el){
                document.querySelector(`.items-in-trade #site-grid`).removeChild(site_ref_it_el)
            }
            if(site_key_it_el){
                document.querySelector(`.items-in-trade #site-grid`).removeChild(site_key_it_el)
            }
            if(user_ref_it_el){
                document.querySelector(`.items-in-trade #user-grid`).removeChild(user_ref_it_el)
            }
            if(user_key_it_el){
                document.querySelector(`.items-in-trade #user-grid`).removeChild(user_key_it_el)
            }
        }
    
    
        UserTrade.iit.total.price = user_item_metal + UserTrade.iit.total_pure.price;
        SiteTrade.iit.total.price = site_item_metal + SiteTrade.iit.total_pure.price;
    
        const user_key_raw = UserTrade.iit.total.price / key_metal
        const site_key_raw = SiteTrade.iit.total.price / key_metal
        const user_keys = Math.trunc(user_key_raw)
        const site_keys = Math.trunc(site_key_raw)
        const user_metal = round_ref((user_key_raw - user_keys) * key_metal)
        const site_metal = round_ref((site_key_raw - site_keys) * key_metal)
    
        document.querySelector(`#user-key-total`).textContent = user_keys;
        document.querySelector(`#user-ref-total`).textContent = (user_metal == 0) ? "0.00":user_metal;
    
        document.querySelector(`#site-key-total`).textContent = site_keys;
        document.querySelector(`#site-ref-total`).textContent = (site_metal == 0) ? "0.00":site_metal;
    
        if(round_ref(UserTrade.iit.total.price) === round_ref(SiteTrade.iit.total.price) && UserTrade.iit.total.price > 0){
            document.querySelector('.btn.trade-btn').classList.add('ready')
        } else {
            document.querySelector('.btn.trade-btn').classList.remove('ready')        
        }
    
        if(UserTrade.iit.items.length == 0 && SiteTrade.iit.items.length == 0){
            document.querySelector(`.items-in-trade #user-grid`).appendChild(document.createElement('span')).classList.add('no-items')
            document.querySelector(`.items-in-trade #user-grid .no-items`).classList.add('fade-in-absolute')
            document.querySelector(`.items-in-trade #user-grid .no-items`).textContent = __('trade.no_items_user')
            document.querySelector(`.items-in-trade #site-grid`).appendChild(document.createElement('span')).classList.add('no-items')
            document.querySelector(`.items-in-trade #site-grid .no-items`).classList.add('fade-in-absolute')
            document.querySelector(`.items-in-trade #site-grid .no-items`).textContent = __('trade.no_items_site')
            document.querySelector('.clear-btn').classList.remove('ready')
        } else {
            document.querySelector(`.items-in-trade #user-grid`).removeChild(document.querySelector(`.items-in-trade #user-grid .no-items`))
            document.querySelector(`.items-in-trade #site-grid`).removeChild(document.querySelector(`.items-in-trade #site-grid .no-items`))
            document.querySelector('.clear-btn').classList.add('ready')
        }
    } catch (error) {
    }
}

const clear_items = async (tradeRemoved) => {
    if(trade_req && !tradeRemoved){ return false }
    if(document.querySelector('.btn.trade-btn').classList.contains('confirmed') && !tradeRemoved){
        return false;
    }

    UserTrade.iit.items = []
    UserTrade.pure.key += UserTrade.iit.pure.key
    UserTrade.iit.pure.key = 0

    UserTrade.pure.ref += UserTrade.iit.pure.ref
    UserTrade.iit.pure.ref = 0

    UserTrade.pure.rec += UserTrade.iit.pure.rec
    UserTrade.iit.pure.rec = 0

    UserTrade.pure.scrap += UserTrade.iit.pure.scrap
    UserTrade.iit.pure.scrap = 0
    UserTrade.iit.total = {price: 0}

    UserTrade.iit.total_pure.price = 0;

    if(document.querySelectorAll('.items-in-trade #user-grid .item').length == 0){
        $('.items-in-trade #user-grid').children().remove();
    }
    document.querySelectorAll('.items-in-trade #user-grid .item').forEach((el, i, items) => {
        const sig = el.getAttribute('data-stack-sig')
        const name = el.getAttribute('data-name')

        const grid_item = sig ? document.querySelector(`#user-item-grid #user-grid .item[data-stack-sig="${sig}"]`) : null
        if(grid_item){
            refresh_stack_state('user', grid_item)
        }

        const all_items = document.querySelectorAll(`#user-item-grid .item[data-name="${name}"]`)
        all_items.forEach(itm => {
            itm.classList.remove('over-stocked')
        })

        if(i == items.length - 1){
            $('.items-in-trade #user-grid').children().remove();
        }
    })

    SiteTrade.iit.items = []
    SiteTrade.iit.bots = []
    SiteTrade.pure.key += SiteTrade.iit.pure.key
    SiteTrade.iit.pure.key = 0

    SiteTrade.pure.ref += SiteTrade.iit.pure.ref
    SiteTrade.iit.pure.ref = 0

    SiteTrade.pure.rec += SiteTrade.iit.pure.rec
    SiteTrade.iit.pure.rec = 0

    SiteTrade.pure.scrap += SiteTrade.iit.pure.scrap
    SiteTrade.iit.pure.scrap = 0
    SiteTrade.iit.total = {price: 0}

    SiteTrade.iit.total_pure.price = 0

    if(document.querySelectorAll('.items-in-trade #site-grid .item').length == 0){
        $('.items-in-trade #site-grid').children().remove();
    }
    document.querySelectorAll('.items-in-trade #site-grid .item').forEach((el, i, items) => {
        const sig = el.getAttribute('data-stack-sig')

        const grid_item = sig ? document.querySelector(`#site-item-grid #site-grid .item[data-stack-sig="${sig}"]`) : null
        if(grid_item){
            refresh_stack_state('site', grid_item)
        }
        if(i == items.length - 1){
            $('.items-in-trade #site-grid').children().remove();
        }
    })

    if(UserTrade.iit.total.price < key_price){ 
        document.querySelector(`#user-key-total`).textContent = 0;
        document.querySelector(`#user-ref-total`).textContent = (round_ref(UserTrade.iit.total.price) == 0) ? "0.00":round_ref(UserTrade.iit.total.price);
    }
    else { 
        const ratio = UserTrade.iit.total.price / key_price
        let keys = Math.trunc(ratio)
        let metal = round_ref((ratio - keys) * key_price)

        document.querySelector(`#user-key-total`).textContent = keys;
        document.querySelector(`#user-ref-total`).textContent = (metal == 0) ? "0.00":metal;
    }

    if(SiteTrade.iit.total.price < key_price){ 
        document.querySelector(`#site-key-total`).textContent = 0;
        document.querySelector(`#site-ref-total`).textContent = (round_ref(SiteTrade.iit.total.price) == 0) ? "0.00":round_ref(SiteTrade.iit.total.price);
    }
    else { 
        const ratio = SiteTrade.iit.total.price / key_price
        let keys = Math.trunc(ratio)
        let metal = round_ref((ratio - keys) * key_price)

        document.querySelector(`#site-key-total`).textContent = keys;
        document.querySelector(`#site-ref-total`).textContent = (metal == 0) ? "0.00":metal;
    }

    if(document.querySelector(`#site-key-total`).textContent == document.querySelector(`#user-key-total`).textContent && document.querySelector(`#site-ref-total`).textContent == document.querySelector(`#user-ref-total`).textContent){
        if(SiteTrade.iit.total.price == 0 && UserTrade.iit.total.price == 0){
            $('.btns .trade-btn').removeClass('ready')
        } else {
            $('.btns .trade-btn').addClass('ready')
        }
    } else {
        $('.btns .trade-btn').removeClass('ready')
    }

    const user_scrapRefs = round_ref(Number(UserTrade.pure.scrap) / 9)
    const user_recRefs = round_ref(Number(UserTrade.pure.rec) / 3)
    const user_refs = round_ref(UserTrade.pure.ref + user_recRefs + user_scrapRefs)
    $('#user-item-grid #user-grid .pure.keys').attr('data-count', UserTrade.pure.key)
    $('#user-item-grid #user-grid .pure.keys .pure-count').text(UserTrade.pure.key + ' x')
    $('#user-item-grid #user-grid .pure.refs').attr('data-count', `${user_refs}`)
    $('#user-item-grid #user-grid .pure.refs .pure-count').text(`${Math.trunc(user_refs)} x`)

    const site_scrapRefs = round_ref(Number(SiteTrade.pure.scrap) / 9)
    const site_recRefs = round_ref(Number(SiteTrade.pure.rec) / 3)
    const site_refs = round_ref(SiteTrade.pure.ref + site_recRefs + site_scrapRefs)
    $('#site-item-grid #site-grid .pure.keys').attr('data-count', SiteTrade.pure.key)
    $('#site-item-grid #site-grid .pure.keys .pure-count').text(SiteTrade.pure.key + ' x')
    $('#site-item-grid #site-grid .pure.refs').attr('data-count', `${site_refs}`)
    $('#site-item-grid #site-grid .pure.refs .pure-count').text(`${Math.trunc(site_refs)} x`)

    update_trade()

    if(currentBot){
        setBot(null)
    }

    document.querySelector('.btn.trade-btn').classList.remove('confirmed')
}

const reset_filters = async (party, type, reset) => {
    document.querySelector(`div.reset-filters.${party}`).classList.remove('show')
    
    if(party == 'site' && reset == true){
        set_filter(party, 'quality', 'None', type, reset)
    } else if(party == 'user' && reset == true){
        set_filter(party, 'quality', 'None', type, reset)
    } else if(party == 'site' && type == 'init'){
        set_filter(party, 'quality', 'None', type)
        set_filter(party, 'type', 'None', type)
        set_filter(party, 'particle', 'None', type)
        set_filter(party, 'class', 'None', type)
        set_filter(party, 'price', 'None', type)
        set_filter(party, 'item-order', 'None', type)    

    } 
    else {
        set_filter(party, 'quality', 'None', type)
        set_filter(party, 'type', 'None', type)
        set_filter(party, 'particle', 'None', type)
        set_filter(party, 'class', 'None', type)
        set_filter(party, 'price', 'None', type)
        set_filter(party, 'item-order', 'None', type)    
    }

    if(type == 'init'){
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
}

const search = async (party, value) => {
    if(party == 'user' && UserTrade.inventory == undefined){ return false; }
    if(party == 'site' && SiteTrade.inventory == undefined){ return false; }

    let itemGrid = document.querySelector(`#${party}-item-grid #${party}-grid`)
    if(value == ''){
        if(party == 'user'){ UserTrade.filters['search'] = null; }
        if(party == 'site'){ SiteTrade.filters['search'] = null; }  
    }
    else{
        if(party == 'user'){ UserTrade.filters['search'] = value.toLowerCase(); }
        if(party == 'site'){ SiteTrade.filters['search'] = value.toLowerCase(); }   
    }

    if(party == 'site'){
        SiteTrade.filters.page = 0
        load_site_inventory(SiteTrade.filters.page, 'change')

        return false;
    } else {
        UserTrade.filters.page = 0
        load_user_inventory(UserTrade.filters.page, 'change')

        return false;
    }
}

const filtersNull = (obj) => {
    // Loop through object properties
    for (const key in obj) {
        // Skip 'page' and 'bot' properties
        if (key === 'page' || key === 'bot' || key === 'search') continue;

        // If any property is not null, return false
        if (obj[key] !== null) {
            return false;
        }
    }

    // All relevant properties are null
    return true;
};


const setFiltersToNULL = (obj) => {
    // Loop through object properties
    for (const key in obj) {
        // Skip 'page' and 'bot' properties
        if (key === 'bot') continue;
        if (key === 'batch') continue;
        if (key === 'page'){ obj[key] = 0; continue; } 

        // If any property is not null, return false
        obj[key] = null
    }
};

const set_filter = async (party, filter, value, type, reset) => {
    // hide pure on quality,or type filter or input search
    // display pure when all those are set to "none" and on when input searching for "Key" ("Ref")
    if(trade_req){ return; }
    if(party == 'site' && SiteTrade.inventory == undefined){ return false; }
    let itemGrid = document.querySelector(`#${party}-item-grid #${party}-grid`)

    if(filter === "bot"){
        if(SiteTrade.iit.items.length > 0 && SiteTrade.filters.bot){
            return false;
        }
        if(SiteTrade.bots.has(value)){
            value = SiteTrade.bots.get(value)
        }
    }

    if(party == 'site' && type == 'init' && reset == true){
        setFiltersToNULL(SiteTrade.filters)
        if(filtersNull(SiteTrade.filters)){ $(`#filter-btn-site`).removeClass('selected') }
        else { $(`#filter-btn-site`).addClass('selected') }
        if(filtersNull(UserTrade.filters)){ $(`#filter-btn-user`).removeClass('selected') }
        else { $(`#filter-btn-user`).addClass('selected') }
        load_site_inventory(SiteTrade.filters.page, 'change')
        return false
    } else if(party == 'user' && type == 'init' && reset == true){
        setFiltersToNULL(UserTrade.filters)
        if(filtersNull(SiteTrade.filters)){ $(`#filter-btn-site`).removeClass('selected') }
        else { $(`#filter-btn-site`).addClass('selected') }
        if(filtersNull(UserTrade.filters)){ $(`#filter-btn-user`).removeClass('selected') }
        else { $(`#filter-btn-user`).addClass('selected') }
        load_user_inventory(UserTrade.filters.page, 'change')
        return false
    }
    

    if(value == "None"){
        if(party == 'user'){ UserTrade.filters[filter] = null; UserTrade.filters.page = 0; }
        if(party == 'site'){ SiteTrade.filters[filter] = null; SiteTrade.filters.page = 0; }   

        if(filtersNull(SiteTrade.filters)){ $(`#filter-btn-site`).removeClass('selected') }
        else { $(`#filter-btn-site`).addClass('selected') }
        if(filtersNull(UserTrade.filters)){ $(`#filter-btn-user`).removeClass('selected') }
        else { $(`#filter-btn-user`).addClass('selected') }

        if(!itemGrid){
            return false;
        }
     
     
        if(party == 'site' && type != 'init' ){
            
            load_site_inventory(SiteTrade.filters.page)
            return false;
        }
        else if(party == 'user' && type != 'init' ){
            load_user_inventory(UserTrade.filters.page)
            return false;
        }
    }
    else {
        if(party == 'user'){ 
            if(filter == "class" && value != "All Classes"){
                UserTrade.filters[filter] = value
            } else {
                UserTrade.filters[filter] = value.toLowerCase();
            }
        }
        if(party == 'site'){
            if(filter == "class" && value != "All Classes"){
                SiteTrade.filters[filter] = value
            } else {
                SiteTrade.filters[filter] = value.toLowerCase();
            }
        }    

        if(filtersNull(SiteTrade.filters)){ 
            $(`#filter-btn-site`).removeClass('selected')
            $(`#site-filters .reset-filters.site`).removeClass('show')
        }
        else {
            $(`#filter-btn-site`).addClass('selected')
            $(`#site-filters .reset-filters.site`).addClass('show')
        }
        if(filtersNull(UserTrade.filters)){ 
            $(`#filter-btn-user`).removeClass('selected') 
            $(`#user-filters .reset-filters.user`).removeClass('show')
        }
        else { 
            $(`#filter-btn-user`).addClass('selected') 
            $(`#user-filters .reset-filters.user`).addClass('show')
        }

        if(!itemGrid){
            return false;
        }
        if(party == 'site' && type != 'init'){
            SiteTrade.filters.page = 0
            load_site_inventory(SiteTrade.filters.page, 'change')
            return false
        } else if(party == 'user' && type != 'init'){
            UserTrade.filters.page = 0
            load_user_inventory(UserTrade.filters.page, 'change')
            return false
        }


        if(!document.querySelector(`.reset-filters.${party}.show`)){
            document.querySelector(`.reset-filters.${party}`).classList.add('show')
        }
    }

    put_novalue_last(party)
}

async function reset_pures_iit() {
    return new Promise((resolve, reject) => {
        try {
            UserTrade.iit.total.key -= UserTrade.iit.pure.key
            UserTrade.iit.total.price -= UserTrade.iit.pure.key * key_price
            UserTrade.pureAssets.key.push(...UserTrade.iit.pureAssets.key)
            UserTrade.iit.pureAssets.key = []
            UserTrade.pure.key += UserTrade.iit.pure.key
            UserTrade.iit.pure.key = 0
            
            UserTrade.iit.total.metal -= UserTrade.iit.pure.ref
            UserTrade.iit.total.price -= UserTrade.iit.pure.ref
            UserTrade.pureAssets.ref.push(...UserTrade.iit.pureAssets.ref)
            UserTrade.iit.pureAssets.ref = []
            UserTrade.pure.ref += UserTrade.iit.pure.ref
            UserTrade.iit.pure.ref = 0

            UserTrade.iit.total.metal = round_ref(UserTrade.iit.total.metal - (UserTrade.iit.pure.rec / 3)) 
            UserTrade.iit.total.price -= UserTrade.iit.pure.rec / 3
            UserTrade.pureAssets.rec.push(...UserTrade.iit.pureAssets.rec)
            UserTrade.iit.pureAssets.rec = []
            UserTrade.pure.rec += UserTrade.iit.pure.rec
            UserTrade.iit.pure.rec = 0

            UserTrade.iit.total.metal = round_ref(UserTrade.iit.total.metal - (UserTrade.iit.pure.scrap / 9)) 
            UserTrade.iit.total.price -= UserTrade.iit.pure.scrap / 9
            UserTrade.pureAssets.scrap.push(...UserTrade.iit.pureAssets.scrap)
            UserTrade.iit.pureAssets.scrap = []
            UserTrade.pure.scrap += UserTrade.iit.pure.scrap
            UserTrade.iit.pure.scrap = 0
            UserTrade.iit.total_pure.price = 0;
            
            if(UserTrade.iit.total.price < 0){ UserTrade.iit.total.price = 0 }

            SiteTrade.iit.total.key -= SiteTrade.iit.pure.key
            SiteTrade.iit.total.price -= SiteTrade.iit.pure.key * key_price
            SiteTrade.pure.key += SiteTrade.iit.pure.key
            SiteTrade.iit.pure.key = 0
            
            SiteTrade.iit.total.metal -= SiteTrade.iit.pure.ref
            SiteTrade.iit.total.price -= SiteTrade.iit.pure.ref
            SiteTrade.pure.ref += SiteTrade.iit.pure.ref
            SiteTrade.iit.pure.ref = 0

            SiteTrade.iit.total.metal = round_ref(SiteTrade.iit.total.metal - (SiteTrade.iit.pure.rec / 3)) 
            SiteTrade.iit.total.price -= SiteTrade.iit.pure.rec / 3
            SiteTrade.pure.rec += SiteTrade.iit.pure.rec 
            SiteTrade.iit.pure.rec = 0

            SiteTrade.iit.total.metal = round_ref(SiteTrade.iit.total.metal - (SiteTrade.iit.pure.scrap / 9)) 
            SiteTrade.iit.total.price -= SiteTrade.iit.pure.scrap / 9
            SiteTrade.pure.scrap += SiteTrade.iit.pure.scrap
            SiteTrade.iit.pure.scrap = 0
            SiteTrade.iit.total_pure.price = 0;

            if(SiteTrade.iit.total.price < 0){ SiteTrade.iit.total.price = 0 }
        } catch (error) {
            
        }
        
        resolve()
    })
}


const item_tooltip = async (state, item, party) => {
    const tooltip = document.getElementById('item_tooltip');
    if(state == "show"){
        if(item.getAttribute('class').includes('iit') && item.getAttribute('class').includes('pure')){ return false; }    

        if(item.getAttribute('class').includes('item')){
            const showTooltip = (itemDesc) => {
                tooltip.querySelector('.item_description .item-desc').style.display = 'block';
                tooltip.querySelector('.item_description .pure-desc').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_cname').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_paint').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_killstreaker').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_sheen').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_parts').style.display = 'none';
                tooltip.querySelector('.item-desc .descs_ .desc_spell').style.display = 'none';
                if(itemDesc != undefined){           
                        // A stacked element's assets all share the same ks/at/f by construction,
                        // so the first id in the stack is representative for tooltip purposes.
                        const rep_id = (item.getAttribute('data-assetids') || item.getAttribute('data-assetid') || '').split(',')[0];
                        const Item = (party.includes("site")) ? itemDesc?.stock?.items.find(i => i.a == rep_id) : itemDesc?.user_stock.find(i => i.a == rep_id);
             
                        if(typeof itemDesc.buy !== "number" && typeof itemDesc.sell !== "number" ){
                            tooltip.setAttribute('q', itemDesc.quality)
                            tooltip.querySelector('.item_name').textContent = item.getAttribute('data-bp_sku') || itemDesc.bp_sku;
                            tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .ref_price').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .nan').style.display = 'block';
                        } else {
                            tooltip.setAttribute('q', itemDesc.quality)
                            tooltip.querySelector('.item_name').textContent = item.getAttribute('data-bp_sku') || itemDesc.bp_sku;
                            tooltip.querySelector('.item-desc .desc_price .nan').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'block';
                            tooltip.querySelector('.item-desc .desc_price .ref_price').style.display = 'block';
                        }

                        if(typeof itemDesc?.custom_name == "string"){
                            tooltip.querySelector('.item-desc .descs_ .desc_cname').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_cname .value').textContent = itemDesc?.custom_name;
                        }

                        if((typeof itemDesc.buy == "number" || typeof itemDesc.sell == "number") && typeof itemDesc?.bptf_data?.update_key_price == "number"){
                            const key_price = itemDesc.bptf_data.update_key_price;
                            if(party.includes('site')){
                                const sell = (Item?.sell > 0 && Item?.sell > itemDesc.sell) ? Item?.sell : itemDesc.sell;
                                let keys_raw = sell / key_price;
                                let keys = Math.trunc(keys_raw)
                                let refs = (keys_raw > 0) ? round_ref(sell - (Math.trunc(keys_raw) * key_price)) : round_ref(sell);
                    
                                if(keys == 0 || !keys){
                                    tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                                    tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = refs;    
                                } else {
                                    tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'block';
                                    tooltip.querySelector('.item-desc .desc_price .key_price #key_amount').textContent = keys;
                                    tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = refs;    
                                }
                            } else if (party.includes('user')){
                                const buy = (Item?.buy > 0 && Item?.buy > itemDesc.buy) ? Item?.buy : itemDesc.buy;

                                let keys_raw = buy / key_price;
                                let keys = Math.trunc(keys_raw)
                                let refs = (keys_raw > 0) ? round_ref(buy - (Math.trunc(keys_raw) * key_price)) : round_ref(buy);
                    
                                if(keys == 0 || !keys){
                                    tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                                    tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = refs;    
                                } else {
                                    tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'block';
                                    tooltip.querySelector('.item-desc .desc_price .key_price #key_amount').textContent = keys;
                                    tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = refs;    
                                }
                            }
                        } else {
                            tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent = __('trade.price_not_found');
                        }
                        // prices read "2 keys, 15.33 ref"; no unit when the price is missing
                        const key_count = Number(tooltip.querySelector('.item-desc .desc_price .key_price #key_amount').textContent)
                        tooltip.querySelector('.item-desc .desc_price .key_price .unit').textContent = key_count == 1 ? 'key' : 'keys'
                        tooltip.querySelector('.item-desc .desc_price .ref_price').classList.toggle('no-unit', isNaN(Number(tooltip.querySelector('.item-desc .desc_price .ref_price #ref_amount').textContent)))

                        if(party.includes('show-') && itemDesc.qualityID == "5" && itemDesc.effectID > 0){
                            const effect = JSON.parse(unusual_effects)?.find(eff => eff["ID"] == itemDesc.effectID)
                            if(effect){
                                tooltip.querySelector('.item-desc .desc_effect').style.display = 'block';
                                tooltip.querySelector('.item-desc .desc_effect').textContent = `★ ${effect["ID"]}`;
                            }
                        }
    
                        if(itemDesc.quality == 'Unusual' && itemDesc.effect != ""){
                            /* tooltip.querySelector('.item-desc .desc_effect').style.display = 'block';
                            tooltip.querySelector('.item-desc .desc_effect').textContent = `★ ${itemDesc.effect}`; */
                        } else {
                            tooltip.querySelector('.item-desc .desc_effect').style.display = 'none';
                        }

                        tooltip.querySelector('.item-desc .descs_ .desc_type .value').textContent = itemAttr.Types[itemDesc.type];
                        
                        try {
                            const class_arr = (itemDesc.classes.length == 9) ? ['All Classes'] : itemDesc.classes
                            if(class_arr.length == 0){
                                tooltip.querySelector('.item-desc .descs_ .desc_class').style.display = 'none';
                            } else {
                                tooltip.querySelector('.item-desc .descs_ .desc_class').style.display = 'flex';
                                tooltip.querySelector('.item-desc .descs_ .desc_class .value').textContent = class_arr.join(', ');
                            }
                        } catch (error) {
                            tooltip.querySelector('.item-desc .descs_ .desc_class').style.display = 'none';
                        }
                        
    
                        const parts = (Item?.at?.hasOwnProperty('strangeParts')) ? Item.at['strangeParts'] : []
                        const spells = (Item?.at?.hasOwnProperty('spells')) ? Item.at['spells'] : []
                        const paint = (Item?.at?.hasOwnProperty('paint')) ? Item.at['paint'] : []

                        if(parts.length != 0){
                            tooltip.querySelector('.item-desc .descs_ .desc_parts').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_parts .value').textContent = parts.join(', ');
                        }
                        if(spells.length != 0){
                            tooltip.querySelector('.item-desc .descs_ .desc_spell').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_spell .value').textContent = spells.join(', ');
                        }
                        if(paint.length != 0){
                            tooltip.querySelector('.item-desc .descs_ .desc_paint').style.display = 'flex';
                            tooltip.querySelector('.item-desc .descs_ .desc_paint .value').textContent = paint;
                        }

                        if(Item?.ks > 0){
                            const killstreaker = (Item?.at?.hasOwnProperty('killstreaker')) ? Item.at['killstreaker'] : null
                            const sheen = (Item?.at?.hasOwnProperty('sheen')) ? Item.at['sheen'] : null
                            if(killstreaker){ 
                                tooltip.querySelector('.item-desc .descs_ .desc_killstreaker').style.display = 'flex';
                                tooltip.querySelector('.item-desc .descs_ .desc_killstreaker .value').textContent = killstreaker;
                            }
                            if(sheen){ 
                                tooltip.querySelector('.item-desc .descs_ .desc_sheen').style.display = 'flex';
                                tooltip.querySelector('.item-desc .descs_ .desc_sheen .value').textContent = sheen;
                            }
                        }

                        tooltip.querySelector('.item-desc .desc_festivized').style.display = 'none';
    
                        if(item.classList.contains('over-stocked')){
                            tooltip.querySelector('.item-desc .desc_price .key_price').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .ref_price').style.display = 'none';
                            tooltip.querySelector('.item-desc .desc_price .nan').style.display = 'block';
                            tooltip.querySelector('.item-desc .desc_price .nan').textContent = __('trade.over_stocked')
                        }
                    
                } else {
                    tooltip.querySelector('.item_name').textContent = __('trade.description_not_found');
                }
                
                tooltip.classList.add('show')
                const itemRect = item.getBoundingClientRect();

                // default: below
                let top = itemRect.top + item.offsetHeight + 8;

                // apply
                tooltip.style.top = top + "px";

                // check overflow
                const rect = tooltip.getBoundingClientRect();

                if (rect.bottom > window.innerHeight) {
                    // move above instead
                    tooltip.style.top = (itemRect.top - tooltip.offsetHeight - 8) + "px";
                }
                tooltip.style.left = item.getBoundingClientRect().left - (tooltip.offsetWidth/2) + (item.offsetWidth/2) + "px"
                if(tooltip.offsetWidth + tooltip.getBoundingClientRect().left >= document.body.offsetWidth){
                    tooltip.style.left = document.body.offsetWidth - tooltip.offsetWidth - 5 + "px"
                }
                if(tooltip.getBoundingClientRect().left < 1){
                    tooltip.style.left = 5 + "px"
                }
            }
            if(party == 'user'){
                const itemDesc = UserTrade.inventory.find(x => x.bp_sku == item.getAttribute('data-name'));
                showTooltip(itemDesc);
            }
            else if(party == 'site'){
                const itemDesc = SiteTrade.inventory.find(x => x.bp_sku == item.getAttribute('data-name'));
                showTooltip(itemDesc);
            }
            else if(party == 'trade-user'){
                const itemDesc = { 
                    bp_sku: item.getAttribute('data-bp_sku') || item.getAttribute('data-name'),
                    type: item.getAttribute('data-type'),
                    classes: itemClasses ? itemClasses : [],
                    bptf_data: {update_key_price: itemKey},
                    buy: Number(item.getAttribute('data-price')) || itemBuy,
                    user_stock: ItemTrade.items
                };
                showTooltip(itemDesc);
            }
            else if(party == 'trade-site'){
                const itemDesc = { 
                    bp_sku: item.getAttribute('data-bp_sku') || item.getAttribute('data-name'),
                    type: item.getAttribute('data-type'),
                    classes: itemClasses ? itemClasses : [],
                    bptf_data: {update_key_price: itemKey},
                    sell: Number(item.getAttribute('data-price')) || itemSell,
                    stock: {items: ItemTrade.items}
                };
                showTooltip(itemDesc);
            } else if(party == 'show-user'){
                const itemDesc = { 
                    bp_sku: item.getAttribute('data-name'),
                    qualityID: item.getAttribute('data-quality'),
                    type: item.getAttribute('data-type'),
                    classes: [],
                    bptf_data: {update_key_price: Number(item.getAttribute('data-key'))},
                    effectID: item.getAttribute('data-effect'),
                    buy: item.getAttribute('data-price'),
                    sell: 0,
                    stock: {items: []},
                    user_stock: []
                };
                showTooltip(itemDesc);
            } else if(party == 'show-site'){
                const itemDesc = { 
                    bp_sku: item.getAttribute('data-name'),
                    qualityID: item.getAttribute('data-quality'),
                    type: item.getAttribute('data-type'),
                    classes: [],
                    bptf_data: {update_key_price: Number(item.getAttribute('data-key'))},
                    effectID: item.getAttribute('data-effect'),
                    sell: item.getAttribute('data-price'),
                    buy: 0,
                    stock: {items: []}
                };
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

            if(party.includes('show-')){
                tooltip.querySelector('.item_description .pure-desc .desc-automatic').style.display = 'none';
            }

            tooltip.querySelector('.item_description .pure-desc #pure_stock').textContent = item.getAttribute('data-count') + ' ' + commodity
            

            tooltip.setAttribute('q', item.getAttribute('data-quality'))
            tooltip.classList.add('show')
            const itemRect = item.getBoundingClientRect();

            // default: below
            let top = itemRect.top + item.offsetHeight + 8;

            // apply
            tooltip.style.top = top + "px";

            // check overflow
            const rect = tooltip.getBoundingClientRect();

            if (rect.bottom > window.innerHeight) {
                // move above instead
                tooltip.style.top = (itemRect.top - tooltip.offsetHeight - 8) + "px";
            }
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

const create_trade = async (type, data) => {
    if(window.site_settings?.trading === false){
        iziToast.warning({ title: __('site.trading_paused_title'), message: __('site.trading_paused') });
        return false;
    }

    if(processing_site_inventory || processing_user_inventory){ 
        iziToast.error({
            title: __('common.error'),
            message: __('trade.create_failed')
        });
        document.querySelector('.btn.trade-btn.ready')?.classList.replace('processing', '')
        return false;
    }

    if(view == "item_page"){
        if(trade_req || ItemTrade.iit.length == 0){ return false; }
        set_item_trade_btn('creating')
    }

    if(view == "trade"){
        if(!document.querySelector('.btn.trade-btn').classList.contains('ready')){
            return false;
        }
        document.querySelector('.btn.trade-btn.ready').classList.add('processing')
    }
    trade_req = true;

    const user_iit = {...UserTrade.iit}
    const site_iit = {...SiteTrade.iit}

    let body = {}

    switch (type) {
        case "single_item":
            body = {single_item: true, User: {hash: user_id}, Site: {assetid: data?.assetid, hash: user_id}, key: key_price, partner_steamid: data?.partner_steamid};
            break;

        case "item_page":
            body = item_page_trade_body();
            break;
    
        default:
            body = {User: user_iit, Site: site_iit, key: key_price};
            break;
    }

    let new_trade_Settings = {
        "async": true,
        "crossDomain": false,
        "url": '../api/create_trade',
        "method": "POST",
        "timeout": 7000,
        "data": JSON.stringify(body),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer ",
            "Accept": "*/*",
        }
    }
    $.ajax(new_trade_Settings)
        .fail(function( data ) {
            trade_req = false;

            iziToast.error({
                title: __('common.error'),
                message: data?.responseJSON?.message || __('trade.create_failed')
            });
            document.querySelector('.btn.trade-btn.ready')?.classList.replace('processing', 'denied')
            if(view == "item_page"){ set_item_trade_btn('denied') }
        })
        .done(async function ( data ) {
            trade_req = false;
            if(data.success == 1){
                if(view == "trade"){
                    document.querySelector('.btn.trade-btn.ready').classList.replace('processing', 'confirmed')
                }
                if(view == "item_page"){
                    set_item_trade_btn('confirmed')
                    clear_single_items()
                }

                await delay(3000)

                if(data?.status === "waitingApproval"){
                    tradeOfferConnection({ status: "waitingApproval", offer: null, priceChanges: data?.priceChanges }, 'open')
                } else {
                    localStorage.setItem(`tradeoffer${user}`, JSON.stringify({ status: "creating", created: Date.now() }))
                    tradeOfferConnection({ status: "creating" }, 'open')
                }

                iziToast.success({
                    title: __('trade.creating_toast'),
                    message: ""
                });
            } else {
                if(view == "trade"){
                    document.querySelector('.btn.trade-btn.ready').classList.replace('processing', 'denied')
                }
                if(view == "item_page"){ set_item_trade_btn('denied') }
                if(data?.message == "You already have an active offer from our bots!"){
                    tradeOfferConnection(localStorage.getItem(`tradeoffer${user}`), 'open')
                }

                iziToast.error({
                    title: __('common.error'),
                    message: data?.message || data?.error || __('trade.create_failed')
                });
            }
        })
};

const check_trade = () => {
    
};

const convert_scrap = (metal) => {
    let keys = 0;
    let refs = 0;
    if(metal < parseFloat(key_price)){
        refs = metal
    } else {
        let key_raw = metal / key_price
        keys = Math.trunc( key_raw )
        let scraps = Math.round(((key_raw - keys) * parseFloat(key_price)) * 9)
        refs = round_ref( parseFloat(scraps) / 9 )
    }

    return {keys, refs}
}

const put_novalue_last = (party) => {
    const comparator = (a, b) => {
        let v1 = a.classList.contains("true");
        let v2 = b.classList.contains("true");

        return v2 - v1;
    };

    const items = Array.from(document.querySelectorAll(`#${party}-item-grid .grid .item`));
    const sorted = items.sort(comparator);

    sorted.forEach(el => {
        el.parentNode.appendChild(el);
    });
}

const getLatestTrades = () => {
    return new Promise((resolve, reject) => {
        fetch('../api/latest_trades')
            .then(response => response.json())
            .then(data => resolve(data))
            .catch(error => reject(error));
    }); 
};

export {
    load_user_inventory, load_user_inventory_single, load_site_inventory, load_site_inventory_single,
    item_tooltip, render_items,
    setBot, set_filter, reset_filters, search, item_to_trade, single_item_to_trade, clear_single_items, clear_items, round_ref,
    group_assets, stack_sig,
    ks_tiers, ks_name, single_price, price_text,
    create_trade, check_trade, getLatestTrades,
    UserTrade, SiteTrade, ItemTrade,
    tradeoffer, tradeOfferConnection,
    Trade_Object, Item_Trade_Object,
    img_prefix
};