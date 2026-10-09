import {init} from "./plugins/initialize.js";
import {navDropdown, collapseLinks} from "./plugins/navbar.js";
import {create_tooltip, remove_tooltip} from "./plugins/tooltip.js";
import * as popUp from "./plugins/window_form.js";
import * as trade from "./plugins/trade.js";
import * as items from "./plugins/items.js";
import {render_trade} from "./plugins/trades_render.js";
import "./plugins/notifications.js";
import * as buy_link from "./plugins/buy_link.js";

const particles = JSON.parse(localStorage.getItem('unusual_effects'))

// filter options keep their English value in data-value (the label is translated)
const fd_value = (el) => el.dataset?.value ?? el.textContent.trim()
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let trade_o = trade_offer
let trade_o_details = false;
let last_trades = false;
const bot_server = server;
const bot_state = bots;
const fetchedItems = []
const selectedItems = []

let lastSearch = null;
const maxSuggestions = 10;

let curModal = { class: "", lock: false };

// lock = true cannot hide or swap modal until resolved
const modals = {
    "search": { class: "searchbar", lock: false },
    "select_items": { class: "modal select_items", lock: false },
    "trade_offer": { class: "modal trade_offer", lock: false },
    "buy_link": { class: "modal buy_link", lock: false }
}

const chat = document.querySelector('#chatRoom')
// const openChatBtn = document.querySelector('#openChat')

/* const toggleChat = (init = false) => {

    if (init) {
        const isOpen = localStorage.getItem('chatRoom') === "true"

        chat.classList.add('noAnim')
        chat.classList.toggle('closed', !isOpen)
        openChatBtn.classList.toggle('active', !isOpen)

        return
    }

    chat.classList.remove('noAnim')

    const isClosed = chat.classList.toggle('closed')

    localStorage.setItem('chatRoom', !isClosed)

    openChatBtn.classList.toggle('active', isClosed)
} */

const toggleModal = async (modal, action, data) => {
    if(curModal.lock){
        return false;
    } else {
        if(action === "open"){
            if(curModal.class != ""){
                toggleModal(curModal, 'close')
            }

            document.body.style.overflowY = "hidden";
            curModal = modal
            $('#modal_overlay').removeClass('active')
            $('#modal_overlay').addClass('active')
            $('#modal_overlay').addClass(modal.class)
            clearModal(modal)
        } else if (curModal.class === modal.class){
            document.body.style.overflowY = "auto";
            curModal = { class: "", lock: false }
            $('#modal_overlay').removeClass(modal.class)
            $('#modal_overlay').removeClass('active')

            if(data?.trade_status == "active"){
                document.querySelector('.trade-offer-bar').classList.add('active')
            }
        }   
    }
}

const clearModal = (modal) => {
    if(modal.class === "searchbar"){
        lastSearch = null
        $('#searchbarItems').val('')
        $('#searchbarItems').focus()
        $('#searchbar .suggestions').children().remove()
        $('#searchbar .suggestions').append(`<li>${__('search.results_here')}</li>`)
    }
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function startsWithBuyAndDigit(str) {
    if (typeof str !== 'string') return false; // Validate input
    return /^\/buy\/\d/.test(str);
}

function isInViewport(el) {
    const rect = el.getBoundingClientRect();

    return (
        rect.top < window.innerHeight &&
        rect.bottom > 0
    );
}

const set_trade_o = (status, trade) => {
    trade_o = status,
    trade_o_details = trade
}

const sm = 677;
const md = 1370;

// Live site settings (admin panel / other apps over the /settings socket): announcement banner + trading on/off
const apply_site_settings = (next) => {
    if(!next || typeof next != 'object'){ return }
    const prev = window.site_settings || { trading: true }
    window.site_settings = next

    const banner = document.getElementById('site-announcement')
    if(banner){
        const ann = next.announcement
        banner.className = `site-announcement ${ann ? 'level-' + ann.level : 'hidden'}`
        banner.querySelector('.site-announcement-text').textContent = ann ? ann.text : ''
    }

    if(prev.trading !== false && next.trading === false){
        iziToast.warning({ title: __('site.trading_paused_title'), message: __('site.trading_paused') })
    } else if(prev.trading === false && next.trading !== false){
        iziToast.success({ title: __('site.trading_resumed'), message: '' })
    }
}

try {
    socket.on('site_settings', apply_site_settings)
} catch (error) {}


addEventListener('DOMContentLoaded', (event) => {
    let credentia = "xxxxxx//https//3333"
    let ls = "/?-/poRt/"

    // toggleChat(true)

    /* setTimeout(() => {
        toggleModal(modals.trade_offer, 'open')
        const modalEl = document.querySelector('#modal_overlay .modal')

        modalEl.querySelector('.modal_header .modal_name').textContent = `Preparing Trade Offer.`
    }, 5000); */

    if(user != "no_session"){
        if(localStorage.getItem(`tradeoffer${user}`)){
            trade.tradeOfferConnection(localStorage.getItem(`tradeoffer${user}`))
        }
    }

    try {
        document.querySelector('.home-ps-2').addEventListener('mouseover', function(e){
            if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                trade.item_tooltip('show', e.target, e.target.parentElement.getAttribute('id').replace('-grid', ''))
            }
        })
        document.querySelector('.home-ps-2').addEventListener('mouseout', function(e){
            if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                trade.item_tooltip('hide')
            }
        })
    } catch (error) {
        
    }

    $(window).on('resize', function() {        
        const nav_section = document.querySelector('.nav-section.right')
        if(window.innerWidth > md){
            if(nav_section.classList.contains('open')){
                document.querySelector('body').classList.remove('no-scroll')
            }
        } else if (window.innerWidth <= md){
            if(nav_section.classList.contains('open')){
                document.querySelector('body').classList.add('no-scroll')
            }
        } else if (window.innerWidth <= sm){
            if(nav_section.classList.contains('open')){
                document.querySelector('body').classList.add('no-scroll')
            }
        }
    })

    document.querySelectorAll('.item-grid').forEach(grid => {
        grid.addEventListener('scroll', function(e){
            trade.item_tooltip('hide')
        })
    })

    document.addEventListener('scroll', async function(e){
        if(TD_PATH == "/"){
            trade.item_tooltip('hide')
            const tradesEL = document.querySelector('.last-trades .trades')
            if (isInViewport(tradesEL) && !last_trades){
                last_trades = true;
                await trade.getLatestTrades().then((res) => {
                    tradesEL.innerHTML = ""
                    if(res.trades.length > 0){
                        for (const trade_o of res.trades) {
                            try {
                                tradesEL.innerHTML += render_trade(trade_o);
                            } catch (error) {
                                
                            }
                        }

                        if(tradesEL.innerHTML.length === 0){
                            tradesEL.innerHTML = `<div class="info fade-in">${__('home.no_trades')}</div>`
                        }
                    } else {
                        tradesEL.innerHTML = `<div class="info fade-in">${__('home.no_trades')}</div>`
                    }
                }).catch((e) => {
                    console.log(e)
                    tradesEL.innerHTML = `<div class="info fade-in">${__('home.trades_error')}</div>`
                })
            }
        }
    })
    

    // arrow keys move through the suggestions, Enter opens the highlighted one
    $('#searchbarItems').on('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const links = Array.from(document.querySelectorAll('#searchbar .suggestions a'));
        if (!links.length) return;
        e.preventDefault();
        const cur = links.findIndex((a) => a.classList.contains('active'));
        const next = e.key === 'ArrowDown' ? (cur + 1) % links.length : (cur <= 0 ? links.length - 1 : cur - 1);
        links.forEach((a, i) => a.classList.toggle('active', i === next));
        links[next].scrollIntoView({ block: 'nearest' });
    });

    $('#search_modal_form').on('submit', (e) => {
        e.preventDefault()
        const active = document.querySelector('#searchbar .suggestions a.active')
        if(active){ window.location.href = active.href; return }
        const input = $('#searchbarItems').val()

        if(input.length > 0){
            window.location.href = `${lurl('/items')}?name=${encodeURIComponent(input)}`
        }
    })
    
     document.addEventListener('keydown', (e) => {
        if((e.key === 'Enter' || e.key === ' ') && document.activeElement?.id === 'collapseNavLinks'){
            e.preventDefault(); collapseLinks(); return;
        }

        if (e.ctrlKey && e.code === 'KeyK') {
            e.preventDefault(); // stop browser menu focus
            if(curModal.class === modals.search.class){
                toggleModal(modals.search, 'close', trade.tradeoffer.offer ? { trade_status: 'active' } : {})
            } else {
                toggleModal(modals.search, 'open')
            }
        } else if ((e.key === 'Escape' || e.code === 27) && document.querySelector('.nav-section.right.open') && curModal.class === ""){
            collapseLinks() // Esc closes the mobile menu
        } else if (e.key === 'Escape' || e.code === 27){
            if(!curModal.lock){
                toggleModal(curModal, 'close', trade.tradeoffer.offer ? { trade_status: 'active' } : {})
            }
        }
    });

    // Search suggestions
    $('#searchbarItems').on('input', function () {
        if (curModal.class !== "searchbar") return;

        const input = items.normalizeGerman($(this).val());

        if (input !== lastSearch && input.length > 0) {
            lastSearch = input;

            const itemNames = JSON.parse(localStorage.getItem('names'));
            const words = input.toLowerCase().trim().split(/\s+/);

            const suggestions = itemNames.item_names
                .filter(name => {
                    const normalized = items.normalizeGerman(name).toLowerCase();
                    return words.every(word => normalized.includes(word));
                })
                .sort((a, b) => {
                    const score = str =>
                        words.reduce((sum, w) => sum + str.indexOf(w), 0);

                    const aNorm = items.normalizeGerman(a).toLowerCase();
                    const bNorm = items.normalizeGerman(b).toLowerCase();

                    return score(aNorm) - score(bNorm);
                })
                .slice(0, maxSuggestions);

            const $suggestions = $('#searchbar .suggestions');
            $suggestions.empty();

            if (suggestions.length) {
                const esc_html = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                // bold the typed words in each name
                const pattern = new RegExp(`(${words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
                for (const sug of suggestions) {
                    const label = sug.split(pattern).map((part, i) => i % 2 ? `<mark>${esc_html(part)}</mark>` : esc_html(part)).join('');
                    $suggestions.append(
                        `<a href="${lurl('/items/' + encodeURIComponent(sug))}" translate="no" role="option"><span class="icon icon-search" aria-hidden="true"></span><span class="sug-name">${label}</span><span class="sug-go" aria-hidden="true">↵</span></a>`
                    );
                }
            } else {
                $suggestions.append(`<li>${__('search.no_results')}</li>`);
            }
        } else if (input.length === 0) {
            lastSearch = "";
            $('#searchbar .suggestions')
                .empty()
                .append(`<li>${__('search.results_here')}</li>`);
        }
    });
    
    const cli_token='awe46awe42aw1!sada!@clia_sdssdas_qweqw98d4dqwd21/as';
    const cli_secret='!!!!!!!asadas@q5qwe5qw4ew62qwe13qwe89qwe4666qw3';
   if(promtLogin == 'true' && user != 'no_session'){
        if(user_tradeurl == ``){
            let tradeurl_submited = false
            const show_new_usermodal = () => {

                iziToast.question({
                    timeout: false,
                    close: false,
                    overlay: true,
                    displayMode: 'once',
                    id: 'new_user_toast',
                    color: 'rgb(194, 194, 194)',
                    zindex: 999,
                    drag: false,
                    maxWidth: "500px",
                    title: __('new_user.toast_title'),
                    message: __('new_user.toast_text_html', { link: '<a href="http://steamcommunity.com/my/tradeoffers/privacy" target="_blank" style="display: inline-block; font-weight: bold;">' + __('new_user.link_here') + '</a>' }),
                    position: 'center',
                    inputs: [
                        ['<label for="toast-tradeurl">' + __('new_user.trade_url_label') + '</label>'],
                        ['<input type="text" id="toast-tradeurl">', 'keyup', function (instance, toast, input, e) {
                            
                        }],
                        ['<label for="toast-tradeurl">' + __('new_user.email_label') + '</label>'],
                        ['<input type="text" id="toast-email">', 'keyup', function (instance, toast, input, e) {
                            
                        }]
                    ],
                    buttons: [
                        ['<button>' + __('common.submit') + '</button>', function (instance, toast) {
                            let email_input = document.querySelector('#new_user_toast #toast-email').value
                            let tradeurl_input = document.querySelector('#new_user_toast #toast-tradeurl').value
                            if(tradeurl_input != "" || 70 < tradeurl_input.length && 80 > tradeurl_input.length && tradeurl_input.includes(`partner=`) && tradeurl_input.includes(`&token`)){
                                $.ajax({
                                    "async": true,
                                    "crossDomain": true,
                                    "url": '../api/user/update',
                                    "method": "POST",
                                    "data": JSON.stringify({"tradeurl": (tradeurl_input == "") ? 'null' : tradeurl_input}),
                                    "headers": {
                                        "Content-Type": "application/json",
                                        "Authorization": "Bearer ",
                                        "Accept": "*/*",
                                    }
                                })
                                .fail(function(response) {
                                    $('#new_user_toast .iziToast-buttons span').removeClass('success')
                                    $('#new_user_toast .iziToast-buttons span').addClass('error')
                                    $('#new_user_toast .iziToast-buttons span').text(__('common.error'))
                                })
                                .done(async function (response) {
                                    if(response.status == 'OK'){
                                        tradeurl = tradeurl_input;

                                        tradeurl_submited = true;

                                        $('#new_user_toast .iziToast-buttons span').removeClass('error')
                                        $('#new_user_toast .iziToast-buttons span').addClass('success')
                                        $('#new_user_toast .iziToast-buttons span').text(__('common.saved'))

                                        setTimeout(() => {
                                            instance.hide({ transitionOut: 'fadeOut' }, toast, 'button');
                                        }, 2000);
                                    } else {
                                        $('#new_user_toast .iziToast-buttons span').removeClass('success')
                                        $('#new_user_toast .iziToast-buttons span').addClass('error')
                                        $('#new_user_toast .iziToast-buttons span').text((response?.message ? response?.message : __('common.error')))
                                    }
                                })
                            } else {
                                $('#new_user_toast .iziToast-buttons span').removeClass('success')
                                $('#new_user_toast .iziToast-buttons span').addClass('error')
                                $('#new_user_toast .iziToast-buttons span').text(__('new_user.invalid_trade_url'))
                            }
                        }],
                        ['<span></span>']
                    ],
                    onOpening: function(instance, toast, closedBy){
                        $('#new_user_toast .iziToast-buttons span').removeClass('error')
                        $('#new_user_toast .iziToast-buttons span').removeClass('success')
                        $('#new_user_toast .iziToast-buttons span').text('')

                    },
                    onClosing: function(instance, toast, closedBy){
                    },
                    onClosed: function(instance, toast, closedBy){
                    }
                });   

                let email = user_email;
                let tradeurl = user_tradeurl;

                // Disable "Esc" key closing

                if(user_tradeurl != ``){
                    document.querySelector('#new_user_toast #toast-tradeurl').value = tradeurl
                }
                if(user_email != ``){
                    document.querySelector('#new_user_toast #toast-email').value = email
                }
            }

            show_new_usermodal()
        }
   }
   if(view == 'developm'){
        $('#get-steambots').on('click', (e) => {
            if(document.querySelector('.steam-bots').classList.contains('false')){
                // make req and remove false on success
                $('#steam-bots .rows').children().remove()
                fetch('/get-steambots', {method: 'post'})
                    .then((res) => {
                        return res.json()
                    })
                    .then((res) => {
                        if(res?.update){
                            $('.btns .update').text(new Date(res?.update).toLocaleString())
                        }
                        if(res?.status == "ok"){
                            if(res?.steambots.length == 0){
                                $('#steam-bots .rows').append(`<div class="error">${__('about.no_bots')} &#128549</div>`)
                            }
                            for (const bot of res?.steambots) {
                                let status = "offline";
                                if(bot?.data?.status?.inventory && bot?.data?.status?.client_steamID && bot?.data?.status?.community_webSession){
                                    status = "online"
                                }
                                const row = `<div class="bot-row">
                                    <div class="steamid">${bot?.data?.steamid}</div>
                                    <div class="name">${bot?.data?.name}</div>
                                    <div class="pending-trades">${bot?.data?.tradeOffers?.sent}</div>
                                    <div class="items">${bot?.data?.inventory?.cap?.cur}/${bot?.data?.inventory?.cap?.limit}</div>
                                    <div class="classifieds">
                                        <a href="https://backpack.tf/classifieds?steamid=${bot?.data?.steamid}" target="_blank">bp.tf</a>
                                    </div>
                                    <div class="status ${status}">${__('about.bot_' + status)}</div>
                                </div>`
                                $('#steam-bots .rows').append(row)
                            }
                        } else {
                            $('#steam-bots .rows').append(`<div class="error">${__('about.bot_server_error')}</div>`)
                        }
                    })
                    .catch((e) => {
                        $('.btns .update').text("")
                        $('#steam-bots .rows').append(`<div class="error">${__('about.bot_server_error')}</div>`)
                    })
            }

            if(document.querySelector('.steam-bots').classList.contains('false')){
                $('#get-steambots').html(`Hide active <span class="icon icon-steam_circle"></span> bots`)
            } else {
                $('#get-steambots').html(`Show active <span class="icon icon-steam_circle"></span> bots`)
            }

            document.querySelector('.steam-bots').classList.toggle('false');
        })
        return false;
    }

    init();

    const queryString = window.location.search;

    // Create a URLSearchParams object
    const urlParams = new URLSearchParams(queryString);

    if(urlParams.get('error')){
        if(urlParams.get('error') == "domchange"){
            iziToast.error({
                title: __('common.warning'),
                message: __('trade.dom_change')
            }); 
        }
    }

    document.querySelectorAll('.nav-links .link.dropdown').forEach(link => {
        
    })

    // falling snow; during TF2 events (service/season.js) summer gets drifting dust and Scream Fortress rising ash
    const PARTICLES = {
        snow: {
            color: { value: "#fff" },
            move: { direction: "bottom", enable: true, outModes: "out", speed: 2 },
            number: { density: { enable: false, area: 400 }, value: 50 },
            opacity: { value: 0.5 },
            shape: { type: "circle" },
            size: { value: 2 },
            wobble: { enable: true, distance: 10, speed: 10 },
            zIndex: { value: { min: 0, max: 0 } }
        },
        dust: {
            color: { value: ["#f3d9a8", "#e6c48a", "#fff3dc"] },
            move: { direction: "right", enable: true, outModes: "out", speed: 0.6, random: true },
            number: { density: { enable: false, area: 400 }, value: 40 },
            opacity: { value: 0.35, random: true },
            shape: { type: "circle" },
            size: { value: 1.6, random: true },
            wobble: { enable: true, distance: 6, speed: 4 },
            zIndex: { value: { min: 0, max: 0 } }
        },
        ash: {
            color: { value: ["#ff8a3d", "#ffb347", "#ff5e2b", "#6b6b6b"] },
            move: { direction: "top", enable: true, outModes: "out", speed: 1.2, random: true },
            number: { density: { enable: false, area: 400 }, value: 45 },
            opacity: { value: 0.6, random: true, animation: { enable: true, speed: 0.8, minimumValue: 0.1, sync: false } },
            shape: { type: "circle" },
            size: { value: 2, random: true },
            wobble: { enable: true, distance: 8, speed: 6 },
            zIndex: { value: { min: 0, max: 0 } }
        }
    }
    const particle_kind = document.body.classList.contains('season-summer') ? 'dust'
        : document.body.classList.contains('season-halloween') ? 'ash' : 'snow'

    if( $("#tsparticles").length && typeof tsParticles != 'undefined' ){
        tsParticles.load("tsparticles", { particles: PARTICLES[particle_kind] });
    }

    if(TD_PATH.startsWith('/items/')){
        $('.nav-links').addClass('Items')
    }

    if(['/giveaway', '/updates', '/posts'].some((path) => TD_PATH.startsWith(path))){
        $('.nav-links').addClass('Community')
    }

    if(trade_o == "true" && user != 'no_session'){
        MicroModal.show('modal-1',{
            awaitCloseAnimation: true,
            onShow: function(modal){
            // do something
                if(trade_o_details == false && trade_o == "true"){
                    socket.emit('get_trade', user)
                    socket.on('res_trade', (trade) => {
                        if(trade == null){
                            trade_o = false;
                            trade_o_details = false;
                        }
                        else{
                            trade_o_details = trade
                        }
                    })
                }
                else if(trade_o_details != false && trade_o == "true"){
                    if(trade_o_details?.status == undefined){ return false; }
                    else{
                        $('#modal-1 .modal__container').attr('class', `modal__container ${trade_o_details?.status}`)
                        $('#modal-1 #modal-1-title').text(trade_o_details?.title)
                        $('#modal-1 #modal-1-p').text(trade_o_details?.text)
                        if(trade_o_details?.bot != undefined){
                            $('#modal-1 .bot-info .bot-input.token').text(trade_o_details?.token)
                            $('#modal-1 .bot-info .bot-input.name').text(trade_o_details?.bot?.name)
                            $('#modal-1 .bot-info .bot-input.joined').text(new Date(trade_o_details?.bot?.joined).toLocaleDateString())
                        }
                    }
                }
                if(!$('.trade-notif-bar.hiden').length && trade_o == "true"){
                    $('.trade-notif-bar').addClass('hiden')
                }
            },
            onClose: function(modal){
                if($('.trade-notif-bar.hiden').length && trade_o == "true"){
                    $('.trade-notif-bar').removeClass('hiden')
                }
            }
        });
    }

    $('.trade-notif-bar').on('click',(e) => {
        e.preventDefault()
        
        if(trade_o == false){
            $('.trade-notif-bar').addClass('hidden')
        }
        else if(user != 'no_session' && trade_o == "true"){

        }
    })

    for (let i = 0; i < document.querySelectorAll('[tooltip="true"]').length; i++) {
        document.querySelectorAll('[tooltip="true"]')[i].addEventListener('mouseover', function(e) {
            create_tooltip(e.target)
        })
        document.querySelectorAll('[tooltip="true"]')[i].addEventListener('mouseout', function(e) {
            remove_tooltip()
        })
    }

    $('input.dropdown-filter-input').on('keyup change', function(e){
        const word = $(this).val().toLowerCase();
        const options = e.target.parentElement.parentElement.querySelectorAll('.fd-value')

        for (let i = 0; i < options.length; i++) {
            const element = options[i];
            let text = element.textContent || element.innerText;

            if(element.classList.contains('none')){ continue; }
            else{
                if (text.toLowerCase().indexOf(word) > -1) {
                    element.classList.remove('hide')
                } else {
                    element.classList.add('hide')
                }
            }
        }
    })

    $.fn.isInViewport = function(px_offset) {
        var elementTop = $(this).offset().top + px_offset;
        var elementBottom = elementTop + $(this).outerHeight();
      
        var viewportTop = $(window).scrollTop();
        var viewportBottom = viewportTop + $(window).height();
      
        return elementBottom > viewportTop && elementTop < viewportBottom;
      };

    document.body.addEventListener('click', e => {

        if(e === undefined){ return false; }

        try {
            if(e.target.classList.contains('trade-offer-bar')){
                e.preventDefault()
                trade.tradeOfferConnection(localStorage.getItem(`tradeoffer${user}`), 'open')
            }

            // close button, or a click on the dimmed background around the modal
            if((e.target.classList.contains('closeModal') || e.target.id === 'modal_overlay') && !curModal.lock){
                toggleModal(curModal, 'close', trade.tradeoffer.offer ? { trade_status: 'active' } : {})
            }

            if(e.target.parentElement.classList.contains('dropdown-container') || e.target.classList.contains('dropdown-item')){
                if(e.target.classList.contains('langSelect')){
                    navDropdown('.langSelect', ['.user-avatar', '.notifications'])
                } else if(e.target.classList.contains('notifications')){
                    navDropdown('.notifications', ['.user-avatar', '.langSelect'])
                } else if(e.target.classList.contains('user-avatar')){
                    navDropdown('.user-avatar', ['.langSelect', '.notifications'])
                }
            } else {
                navDropdown('', ['.notifications', '.user-avatar', '.langSelect'])
            }
            
            if(e.target.getAttribute('id') == "collapseNavLinks"){
                collapseLinks()
            }

            if(e.target.getAttribute('id') == "body_overlay"){
                collapseLinks()
            }

            if(e.target.classList == 'modal__btn modal__btn-primary trade_offer_btn'){
                if(e.target.getAttribute('data-link') !== ""){
                    window.open(e.target.getAttribute('data-link'), "_blank");
                }
            }

            /* if(e.target.getAttribute('id') == "openChat"){
                toggleChat()
            } */

            /* if(e.target.getAttribute('id') == "closeChat"){
                toggleChat()
            } */

            if(e.target.getAttribute('id') === "searchBar" || e.target.closest('#searchBarMobile')){
                if(document.querySelector('.nav-section.right.open')){ collapseLinks() } // close the mobile menu first
                toggleModal(modals.search, 'open')
            }

            // mobile menu: Community opens in place (desktop opens it on hover)
            if(window.innerWidth <= md && e.target.closest('.nav-links .link.dropdown.community') && !e.target.closest('.dropdown a')){
                e.target.closest('.link.dropdown.community').classList.toggle('open')
            }
        } catch (error) {
            
        }
        
        if(view == 'item_page'){
            
            if(e.target.classList.contains('item__btn')){
                const intent = e.target.getAttribute('id')
                let items_fetched = false;
                const items = [];
                
                
                if(e.target.classList[0] == 'item'){
                    
                }

                if(user == 'no_session'){
                    window.location = '/auth/steam'
                } else {
                    if(intent == "sell"){
                        location.hash = `sell_item`
                    } else if (intent == "buy"){
                        location.hash = `buy_item`
                    }
                }
            } 
        }

    })

    if(TD_PATH == '/trade'){
        // pass the variable with current trade view!
        if(view == 'trade'){
            trade.load_site_inventory(trade.SiteTrade.filters.page)

            if(user != 'no_session'){
                try{
                    trade.load_user_inventory(trade.UserTrade.filters.page)
                } catch{}
            }

            document.addEventListener('click', function(e){
                var filterR;
                if(e.target.id === "reload-user-inv"){
                    if(user != "no_session"){
                        try{
                            trade.load_user_inventory(0, 'change', true)
                        } catch{
                            iziToast.error({
                                title: __('trade.reload_failed'),
                                message: __('common.try_refresh')
                            })
                        }
                    }
                }
                if(e.target.id === "reload-site-inv"){
                    try{
                        trade.load_site_inventory(0, 'change', true)
                    } catch{
                        iziToast.error({
                            title: __('trade.reload_failed'),
                            message: __('common.try_refresh')
                        })
                    }
                }
                if(e.target.classList.contains('fd-search') || e.target.classList.contains('dropdown-filter-input')){
                    return false;
                }
                try {
                    filterR = document.querySelector('.filter.open');
                    document.querySelector('.filter.open').classList.remove('open')
                } catch (error) {}
                let el = e.target;
                if(el.classList[0] == 'filter'){
                    document.querySelectorAll('.filter').forEach((ele) => {
                        if(ele == el){
                            if(filterR == el){

                            } else {
                                el.classList.toggle('open')
                            }
                        } else {
                            ele.classList.remove('open')
                        }
                    })
                }
                if(el.classList.contains('fd-value')){
                    if(fd_value(el) == 'None'){
                        el.parentElement.parentElement.classList.remove('selected');
                        el.parentElement.parentElement.querySelector('.filter-value').innerHTML = '';
                    }
                    if(fd_value(el) != 'None'){
                        el.parentElement.parentElement.classList.add('selected');
                        el.parentElement.parentElement.querySelector('.filter-value').innerHTML = el.innerHTML;
                        el.parentElement.parentElement.querySelector('.filter-value').setAttribute('style', el.getAttribute('style'))
                    }
                    el.parentElement.parentElement.classList.remove('open');
                }
            })

            document.querySelector('.index-ps').addEventListener('mouseover', function(e){
                if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                    trade.item_tooltip('show', e.target, e.target.parentElement.getAttribute('id').replace('-grid', ''))
                }
            })
            document.querySelector('.index-ps').addEventListener('mouseout', function(e){
                if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                    trade.item_tooltip('hide')
                }
            })

            document.querySelectorAll('.trade-inv-window').forEach(el => {
                const party = el.classList[1].replace('-window', '')
                el.addEventListener('click', function(e){
                    if(e.target.classList[0] == 'item' && !e.target.classList.contains('in-trade') && !e.target.classList.contains('over-stocked')){
                        if(user == 'no_session'){ 
                            iziToast.error({
                                title: __('common.error'),
                                message: __('common.need_login')
                            }); 
                            return false;
                        }
                        if(trade.UserTrade.inventory == null || trade.SiteTrade.inventory == null){ return false }

                        trade.item_to_trade(party, 'add', e.target)
                    }
                })
            })
            document.querySelector('.widget-wrapper').addEventListener('click', function(e){
                if(trade.UserTrade.inventory == null || trade.SiteTrade.inventory == null){ return false }
                if(e.target.classList[0] == 'item'){
                    // remove from trade
                    let party = e.target.parentElement.classList[1].replace('-items', '')
                    trade.item_to_trade(party, 'remove', e.target)
                    trade.item_tooltip('hide')
                }
            })

            document.addEventListener('scroll', function(e){
                trade.item_tooltip('hide')
            })
            document.addEventListener('touchmove', function(e){
                trade.item_tooltip('hide')
            })
            document.querySelectorAll('.filter').forEach(filter => {
                filter.addEventListener('click', function(e){
                    if(filter.id === "filter-bot"){
                        if(e.target.classList.contains('fd-value')){
                            const party = 'site'
                            const filter = 'bot'
                            const value = fd_value(e.target)
                            trade.setBot(trade.SiteTrade.bots.get(value))
                        }
                        return;
                    }
                    if(e.target.classList.contains('fd-value')){
                        const party = e.target.parentElement.parentElement.parentElement.parentElement.getAttribute('id').replace('-filters', '')
                        const filter = e.target.parentElement.parentElement.getAttribute('filter')
                        const value = fd_value(e.target)
                        trade.set_filter(party, filter, value)
                    }
                })
            });

            document.querySelectorAll('.input-filter').forEach(input => {
                input.addEventListener('submit', function(e){
                    e.preventDefault();
                    const value = input.querySelector("input").value;

                    if(input.id.includes('user')){
                        trade.search('user', value)
                    }
                    if(input.id.includes('site')){
                        trade.search('site', value)
                    }
                    return true;
                })
            })

            document.querySelector('.btn.trade-btn').addEventListener('click', function(){
                if(user != 'no_session'){
                    if(user_tradeurl != ``){
                        trade.create_trade()
                    } else {
                        iziToast.error({
                            title: __('common.error'),
                            message: __('common.need_trade_url')
                        });
                    }
                }
            })

            document.querySelector('.btn.clear-btn').addEventListener('click', function(){
                if(user != 'no_session' && document.querySelector('.btn.clear-btn').classList.contains('ready')){
                    trade.clear_items()
                }
            })

            $('.reset-filters.user').on('click', (e) => {
                if(user != 'no_session' && $('.reset-filters.user').hasClass('show')){
                    trade.reset_filters('user', 'init', true)
                }
                return;
            })
            $('.reset-filters.site').on('click', (e) => {
                if($('.reset-filters.site').hasClass('show')){
                    trade.reset_filters('site', 'init', true)
                }
            })

            $(window).on('resize scroll', async function() {
                trade.item_tooltip('hide')
                if($('.item-grid #site-grid').offset() != undefined && $('.item-grid #site-grid .invisible-item').offset() != undefined){
                    if($('.item-grid #site-grid .invisible-item').isInViewport(150)){
                        if ($(window).scrollTop() >= $(
                            '.item-grid #site-grid').offset().top + $('.item-grid #site-grid').
                                outerHeight() - window.innerHeight) {
            
                            await trade.load_site_inventory(trade.SiteTrade.filters.page, 'change')
                        }
                    }
                }

                if($('.item-grid #user-grid').offset() != undefined && $('.item-grid #user-grid .invisible-item').offset() != undefined){
                    if($('.item-grid #user-grid .invisible-item').isInViewport(150)){
                        if ($(window).scrollTop() >= $(
                            '.item-grid #user-grid').offset().top + $('.item-grid #user-grid').
                                outerHeight() - window.innerHeight) {
            
                            await trade.load_user_inventory(trade.UserTrade.filters.page, 'change')
                        }
                    }
                }
            }); 

            $('#site-item-grid').scroll(async function() {
                if($('.item-grid #site-grid').offset() != undefined && $('.item-grid #site-grid .invisible-item').offset() != undefined){
                    if($('.item-grid #site-grid .invisible-item').isInViewport(75)){            
                        await trade.load_site_inventory(trade.SiteTrade.filters.page, 'change')
                    }
                }
            })

            $('#user-item-grid').scroll(async function() {
                if($('.item-grid #user-grid').offset() != undefined && $('.item-grid #user-grid .invisible-item').offset() != undefined){
                    if($('.item-grid #user-grid .invisible-item').isInViewport(75)){            
                        await trade.load_user_inventory(trade.UserTrade.filters.page, 'change')
                    }
                }
            })
        }
    }

    if(TD_PATH.includes('/items')){
            let next_api_request = Date.now()
            let req_reserved = false;
            

            document.addEventListener('click', function(e){
                    var filterR;
                    if(e.target.classList.contains('fd-search') || e.target.classList.contains('dropdown-filter-input')){
                        return false;
                    }
                    try {
                        filterR = document.querySelector('.filter.open');
                        document.querySelector('.filter.open').classList.remove('open')
                    } catch (error) {}
                    let el = e.target;
                    if(el.classList[0] == 'filter'){
                        document.querySelectorAll('.filter').forEach((ele) => {
                            if(ele == el){
                                if(filterR == el){

                                } else {
                                    el.classList.toggle('open')
                                }
                            } else {
                                ele.classList.remove('open')
                            }
                        })
                    }
                    if(el.classList.contains('fd-value')){
                        if(fd_value(el) == 'None'){
                            el.parentElement.parentElement.classList.remove('selected');
                            urlParams.delete(el.parentElement.parentElement.getAttribute('filter'))
                            el.parentElement.parentElement.querySelector('.filter-value').innerHTML = '';
                        }
                        if(fd_value(el) != 'None'){
                            el.parentElement.parentElement.classList.add('selected');
                            urlParams.set(el.parentElement.parentElement.getAttribute('filter'), fd_value(el))
                            el.parentElement.parentElement.querySelector('.filter-value').innerHTML = el.innerHTML;
                            el.parentElement.parentElement.querySelector('.filter-value').setAttribute('style', el.getAttribute('style'))
                        }
                        el.parentElement.parentElement.classList.remove('open');

                        // filter function
                        history.replaceState(null, null, "?"+urlParams.toString());
                        let items_page = 0
                        document.querySelector('.item-content').classList.remove('loaded')
                        document.querySelector('.item-content').classList.remove('last-page')
                        document.querySelector('.item-content').classList.remove('no-items')    
                        if(next_api_request <= Date.now()){
                            req_reserved = true
                            items.get_items(items_page)
                            next_api_request = Date.now() + 3000
                            req_reserved = false                
                        } else {
                            req_reserved = true
                            setTimeout(() => {
                                items.get_items(items_page)
                                next_api_request = Date.now() + 3000
                                req_reserved = false                    
                            }, next_api_request - Date.now());
                        }
                    }

                    if(el.getAttribute('id') === 'resetFilters' && el.classList.contains('active')){
                        const url = new URL(window.location);
                        url.search = '';
                        window.history.replaceState({}, document.title, url.toString());

                        $('#resetFilters').removeClass('active')
                        window.location.reload()
                    }
                })
        if(view == 'items'){
            const queryString = window.location.search;
            const urlParams = new URLSearchParams(queryString);

            if(urlParams.has('latest_changes')){
                document.querySelector('.page-section h2').textContent = __('items.latest_updates')
                document.querySelector('.page-section .h2-anchor').textContent = __('items.item_database')
                document.querySelector('.page-section .h2-anchor').setAttribute('href', '?')
                document.querySelector('.page-section.items-ps').classList.add('latest_changes')
            } else {
                let items_page = 0;
                let validInputs = true;
                let next_api_request = Date.now()
                let req_reserved = false
                
                for (const entry of urlParams.entries()) {
                    const filterEl = document.querySelector(`.filter[filter=${entry[0]}]`)
                    if(filterEl){
                        let selectedVal = Array.from(filterEl.querySelectorAll('.fd-value'))
                            .find(el => fd_value(el).replaceAll(' ', '') === entry[1].replaceAll(' ', ''));
                        if(selectedVal != undefined){
                            filterEl.classList.add('selected')
                            filterEl.querySelector('.filter-value').innerHTML = selectedVal.innerHTML;
                            filterEl.querySelector('.filter-value').setAttribute('style', selectedVal.getAttribute('style'))
                        } else {
                            filterEl.classList.add('selected')
                            filterEl.querySelector('.filter-value').innerHTML = undefined;
                            filterEl.querySelector('.filter-value').setAttribute('style', 'color: gray !important;')
                            validInputs = false
                        }
                    }
                }
                if(urlParams.has('name')){
                    document.querySelector('form#user-input-filter input').value = urlParams.get('name')
                }

                req_reserved = true
                setTimeout(() => {
                    items.get_items(items_page, validInputs).then(() => {
                    },
                    () => {
                        
                    })
                    next_api_request = Date.now() + 3000
                    req_reserved = false
                }, 1000);
                
                document.querySelector('form#user-input-filter').addEventListener('submit', function(e){
                    e.preventDefault()

                    const value = e.target.querySelector('input').value
                    if(value == ''){
                        urlParams.delete('name')
                    } else {
                        urlParams.set('name', String(value))
                    }

                    history.replaceState(null, null, "?"+urlParams.toString());
                    items_page = 0
                    document.querySelector('.item-content').classList.remove('loaded')
                    document.querySelector('.item-content').classList.remove('last-page')
                    document.querySelector('.item-content').classList.remove('no-items')
                    if(next_api_request <= Date.now()){
                        req_reserved = true
                        items.get_items(items_page)
                        next_api_request = Date.now() + 3000
                        req_reserved = false                
                    } else {
                        req_reserved = true
                        setTimeout(() => {
                            items.get_items(items_page)
                            next_api_request = Date.now() + 3000
                            req_reserved = false                    
                        }, next_api_request - Date.now());
                    }
                })  
                
                $(window).on('resize scroll', function() {
                    if($('.item-loader').isInViewport(100)){
                        if(!$('.item-loader').hasClass('loading')){
                            $('.item-loader').addClass('loading')
                            if(req_reserved == false){
                                if(next_api_request <= Date.now()){
                                    req_reserved = true
                                    items_page ++;
                                    items.get_items(items_page)
                                    next_api_request = Date.now() + 3000
                                    req_reserved = false                
                                } else {
                                    req_reserved = true
                                    setTimeout(() => {
                                        items_page ++;
                                        items.get_items(items_page)
                                        next_api_request = Date.now() + 3000
                                        req_reserved = false                    
                                    }, next_api_request - Date.now());
                                }
                            }
                        } else {

                        }
                    }
                });

            }
        } else if(view == 'item_page'){
            location.hash = ""
            const item_update = item?.item_updated;
            const effectID = item?.effectID;
            const item_name = decodeURIComponent(TD_PATH).replace('/items/', '')
            const item_page_title = document.title
            let current_item = item_name;

            let TradeData = new trade.Trade_Object()

            document.querySelector('.item-page').addEventListener('mouseover', function(e){
                if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                    trade.item_tooltip('show', e.target, trade.ItemTrade.party)
                }
            })
            document.querySelector('.item-page').addEventListener('mouseout', function(e){
                if(e.target.classList.contains('item') || e.target.classList.contains('pure')){
                    trade.item_tooltip('hide')
                }
            })

            document.querySelector('.item-page').addEventListener('click', function(e){
                if(e.target.classList[0] == 'item' && !e.target.classList.contains('over-stocked')){
                    if(user == 'no_session'){ 
                        iziToast.error({
                            title: __('common.error'),
                            message: __('common.need_login')
                        }); 
                        return false;
                    }
                    
                    if(!e.target.classList.contains('in-trade')){
                        trade.single_item_to_trade('add', e.target, (location.hash == "#sell_item") ? "trade-user":"trade-site")
                    } else {
                        trade.single_item_to_trade('remove', e.target, (location.hash == "#sell_item") ? "trade-user":"trade-site")
                    }
                }
            })

            document.querySelector('.trade-nav #trade-btn').addEventListener('click', () => {
                if(user == 'no_session'){ window.location = '/auth/steam'; return; }
                if(user_tradeurl == ``){
                    iziToast.error({ title: __('common.error'), message: __('common.need_trade_url') });
                    return;
                }
                trade.create_trade('item_page')
            })

            document.querySelector('.trade-nav #remove-iit').addEventListener('click', () => {
                trade.clear_single_items()
            })

            document.querySelector('.trade-nav #reload-trade-inv').addEventListener('click', () => {
                // re-runs the #sell_item / #buy_item loader below
                window.dispatchEvent(new HashChangeEvent('hashchange'))
            })

            document.addEventListener('scroll', function(e){
                trade.item_tooltip('hide')
            })
            document.addEventListener('touchmove', function(e){
                trade.item_tooltip('hide')
            })


            $('#updated-ago').text(timeAgo(item_update))

            if(effectID && particles){
                const effect = particles.find(effect => effect["ID"] == effectID);
                $('.item-effect').text(`★ ${__('item.unusual_effect', { name: effect?.name })}`)
            }

            // Killstreak tier select: the name, prices and stock of the picked tier.
            // Sell / Buy then list only items of that tier (trade.js tier_visible).
            const ks_tiers = trade.ks_tiers()
            const ks_select = document.getElementById('ks-select')

            const show_tier = (tier) => {
                const entry = ks_tiers.find(t => t.tier == tier)
                const current_tier = entry ? entry.tier : 0
                current_item = (current_tier > 0) ? entry.bp_sku : item.bp_sku

                trade.ItemTrade.tier = current_tier
                trade.ItemTrade.stock = (current_tier > 0 && entry?.stock) ? { cur: entry.stock.cur, limit: entry.stock.limit ?? itemStock?.limit } : null
                const stock = { cur: Number((trade.ItemTrade.stock || itemStock)?.cur) || 0, limit: Number((trade.ItemTrade.stock || itemStock)?.limit) || 0 }
                const can_sell_count = Math.max(stock.limit - stock.cur, 0)

                $('#item-name, #trade-item-name').text(current_item)
                $('.navigation .current-item a').first().text(current_item)
                document.title = item_page_title.replace(item.bp_sku, current_item)

                $('#sell-price').text(trade.price_text(trade.single_price(current_tier, true)))
                $('#buy-price').text(trade.price_text(trade.single_price(current_tier, false)))
                $('.item__trade.sell .stock span').text(can_sell_count)
                $('.item__trade.sell .stock').toggleClass('yes', can_sell_count > 0).toggleClass('no', can_sell_count <= 0)
                $('.item__trade.buy .stock span').text(stock.cur)
                $('.item__trade.buy .stock').toggleClass('yes', stock.cur > 0).toggleClass('no', stock.cur <= 0)
                $('.item__btn#sell').toggleClass('active', can_sell_count > 0)
                $('.item__btn#buy').toggleClass('active', stock.cur > 0)

                $('#updated-ago').text(timeAgo(entry?.updated || item_update))
                if(ks_select){ ks_select.value = String(current_tier) }
            }

            if(ks_select){
                for (const entry of ks_tiers) {
                    const option = document.createElement('option')
                    option.value = String(entry.tier)
                    option.textContent = itemAttr.killstreaks[entry.tier].trim() // item words stay English, like item names
                    ks_select.appendChild(option)
                }
                ks_select.addEventListener('change', () => show_tier(Number(ks_select.value)))
                // a link to e.g. /items/Professional Killstreak Rocket Launcher opens with that tier picked
                const linked = ks_tiers.find(t => t.bp_sku === item_name)
                show_tier(linked ? linked.tier : 0)
            }
            function formatUnixTimestamp(unixMs) {
                const date = new Date(unixMs);
                
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-based
                const year = date.getFullYear();
            
                return `${hours}:${minutes} ${day}.${month}.${year}`;
            }
            

            const wishlist_arr = (typeof wishlist == "string") ? wishlist.split(','):[]

            if(wishlist_arr.includes(item_name)){
                $('#wishlist-btn').text(__('item.wishlisted'))
                $('#wishlist-btn').addClass('active')
            }

            $('#wishlist-btn').click(e => {
                if(user != 'no_session'){
                    if($('#wishlist-btn').hasClass('active')){
                        let data = { bp_sku: item_name }
                        fetch('/api/user/remove_wishlist', {
                                method: 'POST', // HTTP method
                                headers: {
                                    'Content-Type': 'application/json', // Specify JSON content
                                },
                                body: JSON.stringify(data), // Convert JavaScript object to JSON
                            }
                        )
                            .then((res) => { return res.json() })
                            .then((res) => {
                                $('#wishlist-btn').text(__('item.wishlist'))
                                $('#wishlist-btn').removeClass('active')
                                iziToast.success({
                                    title: __('common.success'),
                                    message: __('item.wishlist_removed')
                                })            
                            })
                            .catch((e) => {
                                iziToast.error({
                                    title: __('common.error'),
                                    message: __('item.wishlist_remove_failed')
                                })    
                            })
                    } else {
                        if(wishlist_arr.includes(item_name)){
                            return;
                        }
                        if(wishlist_arr.length >= 10){
                            iziToast.error({
                                title: __('item.too_many_items'),
                                message: __('item.wishlist_limit')
                            });
                            return;
                        }
            
                        let data = { bp_sku: item_name }
                        fetch('/api/user/add_wishlist', {
                                method: 'POST', // HTTP method
                                headers: {
                                    'Content-Type': 'application/json', // Specify JSON content
                                },
                                body: JSON.stringify(data), // Convert JavaScript object to JSON
                            }
                        )
                            .then((res) => { return res.json() })
                            .then((res) => {
                                $('#wishlist-btn').text(__('item.wishlisted'))
                                $('#wishlist-btn').addClass('active')
                                iziToast.success({
                                    title: __('common.success'),
                                    message: __('item.wishlist_added')
                                })             
                            })
                            .catch((e) => {
                                iziToast.error({
                                    title: __('item.too_many_items'),
                                    message: __('item.wishlist_limit')
                                });
                            })
    
                    }
                } else {
                    window.location.href = "/auth/steam"
                }
            })

            const append_items = (items, action) => {
                try {
                    $('#item-select .grid').children().remove()
                    if(items == "error"){
                        $('#item-select .grid').append(`<span class="no-items">${__('common.error')}</span>`)
                    } else if(typeof items == "object"){
                        const image = $('.item-body .image-box img').attr('src')
                        for (const item of items) {
                            $('#item-select .grid').append(`<div class="item q-${qualityID}">
                                <img src="${image}" alt="" class="image" effect-id="0">    
                            </div>`)
                        }
                    }
                } catch (error) {
                    
                }
            }

            const navigation = $('.navigation')
            const item_view = document.querySelector('.item-view');
            const trade_item_view = document.querySelector('.trade_item-view');

            // read when Sell / Buy opens: the killstreak select can change them
            const can_buy_now = () => document.querySelector('.item__btn#buy')?.classList.contains('active') || false
            const can_sell_now = () => document.querySelector('.item__btn#sell')?.classList.contains('active') || false

            // header of the sell / buy view: "Sell" + the price of one item of the picked tier
            const show_trade_item = (selling) => {
                $('#remove-iit').removeClass('ready')
                $('#trade-mode').text(__(selling ? 'item.sell' : 'item.buy'))
                $('#trade-item-price').text(__('item.price_each', { price: trade.price_text(trade.single_price(trade.ItemTrade.tier, selling)) }))
            }

            window.addEventListener("hashchange", async () => {
                const hash = window.location.hash;
                const can_buy = can_buy_now()
                const can_sell = can_sell_now()

                trade.ItemTrade.iit = [];
                trade.ItemTrade.total = 0;
                trade.ItemTrade.filters = {bot: null};
                updateNavigation(navigation)
                $('.navigation .current-item a').first().text(current_item)

                if(hash === "#sell_item"){
                    document.body.classList.add('removeBg')
                    if(can_sell){
                        $(`#trade-item-grid`).empty()
                        $(`.loading-items#trade-loading`).removeClass('hidden')
                        trade_item_view.querySelector('.trade-nav #trade-count').textContent = "0";
                        trade_item_view.querySelector('.trade-nav #trade-key-total').textContent = "0";
                        trade_item_view.querySelector('.trade-nav #trade-ref-total').textContent = "0.00";
                        trade_item_view.querySelector('.trade-nav #trade-btn').classList.remove('ready')

                        show_trade_item(true)

                        trade.load_user_inventory_single(item.bp_sku);

                        item_view.classList.remove('fade-in')
                        item_view.classList.remove('active')
                        trade_item_view.classList.add('active') 
                        trade_item_view.classList.add('fade-in')
                        document.title = `${__('item.sell')} - ${item_page_title}`
                    } else {
                        iziToast.error({
                            title: __('common.error'),
                            message: __('item.cant_sell')
                        });
                    }
                } else if (hash === "#buy_item"){
                    document.body.classList.add('removeBg')
                    if(can_buy){
                        $(`#trade-item-grid`).empty()
                        $(`.loading-items#trade-loading`).removeClass('hidden')
                        trade_item_view.querySelector('.trade-nav #trade-count').textContent = "0";
                        trade_item_view.querySelector('.trade-nav #trade-key-total').textContent = "0";
                        trade_item_view.querySelector('.trade-nav #trade-ref-total').textContent = "0.00";
                        trade_item_view.querySelector('.trade-nav #trade-btn').classList.remove('ready');

                        show_trade_item(false)

                        trade.load_site_inventory_single(item.bp_sku);

                        item_view.classList.remove('fade-in')
                        item_view.classList.remove('active')
                        trade_item_view.classList.add('active')
                        trade_item_view.classList.add('fade-in')
                        document.title = `${__('item.buy')} - ${item_page_title}`
                    } else {
                        iziToast.error({
                            title: __('common.error'),
                            message: __('item.cant_buy')
                        });
                    }
                } else {
                    trade_item_view.classList.remove('fade-in')
                    trade_item_view.classList.remove('active')
                    item_view.classList.add('active')
                    item_view.classList.add('fade-in')
                    document.title = item_page_title
                }
            })
        }
    }

    ( () => {
        // /buy/<assetid>: show the item (or a picker) first, the trade goes out from the modal's button
        if(post_trade){
            buy_link.open(post_trade)
        }
        
        document.getElementById('current_year').textContent = new Date().getFullYear();
    }) ();  

});


function timeAgo(unixTimestamp) {
    const now = new Date();
    const time = parseFloat(unixTimestamp); // Convert Unix timestamp to milliseconds
    const secondsAgo = Math.floor((now - time) / 1000);

    const minute = 60;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    if (!Number.isFinite(secondsAgo)) return '';
    // same steps as before, worded by the browser in the page language
    const rtf = new Intl.RelativeTimeFormat(TD_LANG, { numeric: 'auto' });
    if (secondsAgo < day) {
        return rtf.format(0, 'day'); // "today"
    } else if (secondsAgo < 2 * week) {
        return new Intl.RelativeTimeFormat(TD_LANG, { numeric: 'always' }).format(-Math.floor(secondsAgo / day), 'day');
    } else if (secondsAgo < 3 * week) {
        return rtf.format(-2, 'week');
    } else if (secondsAgo < 4 * week) {
        return rtf.format(-3, 'week');
    } else if (secondsAgo < year) {
        return rtf.format(-Math.floor(secondsAgo / month), 'month');
    } else {
        return rtf.format(-Math.floor(secondsAgo / year), 'year');
    }
}

function decodePriceData(encodedString) {
    const [buyPart, sellPart, timestamp] = encodedString.split("|");
}

export {
    trade_o, trade_o_details, set_trade_o,
    toggleModal, modals
}