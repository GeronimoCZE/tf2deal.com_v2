import {init} from "./plugins/initialize.js";
import {navDropdown, collapseLinks} from "./plugins/navbar.js";
import {create_tooltip, remove_tooltip} from "./plugins/tooltip.js";
import * as popUp from "./plugins/window_form.js";
import * as trade from "./plugins/trade.js";
import {setLanguage} from "./plugins/language.js";

addEventListener('DOMContentLoaded', (event) => {
    init();

    for (let i = 0; i < document.querySelectorAll('[tooltip="true"]').length; i++) {
        document.querySelectorAll('[tooltip="true"]')[i].addEventListener('mouseover', function(e) {
            create_tooltip(e.target)
        })
        document.querySelectorAll('[tooltip="true"]')[i].addEventListener('mouseout', function(e) {
            remove_tooltip()
        })
    }

    document.body.addEventListener('click', e => {

        /* handle nav dropdowns */
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
        
        if(e.target.classList.contains('lang-option')){
            setLanguage(e.target.classList[1])
        }

        if(e.target.getAttribute('id') == "collapseNavLinks"){
            collapseLinks()
        }

        if(e.target.getAttribute('id') == "body_overlay"){
            collapseLinks()
        }
    })

    if(window.location.pathname == '/trade'){
        // pass the variable with current trade view!
        if(view == 'trade'){
            trade.load_site_inventory()

            if(user != 'no_session'){
                if(localStorage.getItem('user_inventory') == null){
                    trade.load_user_inventory()
                } else {
                    try{
                        const inv = JSON.parse(localStorage.getItem('user_inventory'))
                        if(inv.nextRefresh <= Date.now() || inv.steamid != user){
                            trade.load_user_inventory()
                        } else {
                            trade.UserTrade.inventory = inv.inventory.items;
                            trade.UserTrade.pure = inv.inventory.pure;
                            trade.render_items('user', inv.inventory)
                        }
                    } catch{
                        trade.load_user_inventory()
                    }
                }
            }

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
                    if(e.target.classList[0] == 'item' && !e.target.classList.contains('in-trade')){
                        if(user == 'no_session'){ 
                            iziToast.error({
                                title: 'Error!',
                                message: 'You need to login!'
                            }); 
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
                if(e.target.classList[1] == 'keys'){
                    let party = e.target.parentElement.classList[1].replace('-items', '')
                    const partyPIT = (party == 'user') ? trade.UserTrade.iit.pure.key : trade.SiteTrade.iit.pure.key
                    trade.pure_to_trade(party, 'remove', 'keys', partyPIT)
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
                    if(e.target.classList.contains('fd-value')){
                        const party = e.target.parentElement.parentElement.parentElement.getAttribute('id').replace('-filters', '')
                        const filter = e.target.parentElement.parentElement.getAttribute('filter')
                        const value = e.target.textContent.trim()
                        trade.set_filter(party, filter, value)
                    }
                })
            });
            document.querySelector('#user-filters > div.reset-filters').addEventListener('click', (e) => {
                const party = e.target.parentElement.getAttribute('id').replace('-filters', '')
                if(e.target.classList.contains('show')){
                    trade.reset_filters(party)
                }
            })
            document.querySelector('#site-filters > div.reset-filters').addEventListener('click', (e) => {
                const party = e.target.parentElement.getAttribute('id').replace('-filters', '')
                if(e.target.classList.contains('show')){
                    trade.reset_filters(party)
                }
            })
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
                    trade.create_trade()
                }
                /* animate in trade */
                /* $('.page-section').load('./particles/tradeCreated', {'ss':'ss'}) */
            })
        }
    }

    if(view == 'trade_created'){
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

        document.addEventListener('scroll', function(e){
            trade.item_tooltip('hide')
        })
        document.addEventListener('touchmove', function(e){
            trade.item_tooltip('hide')
        })
    }

    ( () => {
        document.getElementById('current_year').textContent = new Date().getFullYear();
    }) ();  

});

export {}