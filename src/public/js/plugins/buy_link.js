// Direct buy links: tf2deal.com/buy/<assetid> (server: service/buy_link.js, styles: scss/partials/_modals.scss -> .buy-link)
//
// The page comes with every bot copy that carries the assetid (head.ejs -> post_trade.copies):
//   none     -> "no longer in stock" and a link to the items
//   one      -> the item, its price and a "Request trade" button
//   several  -> the visitor picks one first (they differ by item, bot, paint, spells, ...)
// The trade request only goes out when the button is pressed (trade.create_trade('single_item')).
import * as main from '../main.js'
import * as trade from './trade.js'

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const bot_label = (copy) => {
    if(copy.bot_name){ return __('buy_link.from_bot', { name: copy.bot_name }) }
    if(copy.bot){ return __('buy_link.from_bot', { name: `${__('item_filters.bot')} …${copy.bot.slice(-4)}` }) }
    return ''
}

const copy_html = (copy, i, several) => {
    const tag = several ? 'button' : 'div'
    const attrs = several ? 'type="button" role="radio" aria-checked="false"' : ''
    const effect = copy.effectID > 0 ? ` style="background-image: url('https://api.backpack.tf/images/440/particles/${Number(copy.effectID)}_94x94.png')"` : ''
    const bot = bot_label(copy)
    return `
        <${tag} class="bl-item" data-i="${i}" ${attrs}>
            <span class="bl-thumb q-${esc(copy.qualityID)}"${effect}><img src="${esc(copy.image)}" alt=""></span>
            <span class="bl-text">
                <strong translate="no">${esc(copy.name)}</strong>
                ${bot ? `<span class="bl-meta">${esc(bot)}</span>` : ''}
                ${copy.details?.length ? `<span class="bl-tags" translate="no">${copy.details.map((d) => `<span>${esc(d)}</span>`).join('')}</span>` : ''}
            </span>
            ${copy.price ? `<span class="bl-price">${esc(copy.price)}</span>` : ''}
        </${tag}>`
}

const open = (link) => {
    const modal = document.querySelector('.modal_overlay .modal')
    if(!modal || !link){ return }

    const copies = Array.isArray(link.copies) ? link.copies : []
    const several = copies.length > 1
    const signed_in = typeof user != 'undefined' && user != 'no_session'

    let title, body
    if(copies.length == 0){
        title = __('buy_link.gone_title')
        body = `
            <p class="bl-lead">${esc(__('buy_link.gone'))}</p>
            <div class="bl-actions">
                <button type="button" class="bl-cancel">${esc(__('buy_link.close'))}</button>
                <a class="bl-confirm" href="${esc(lurl('/items'))}">${esc(__('buy_link.browse'))}</a>
            </div>`
    } else {
        title = several ? __('buy_link.pick_title') : __('buy_link.buy_title')
        const action = signed_in
            ? `<button type="button" class="bl-confirm" ${several ? 'disabled' : ''}>${esc(__('buy_link.request'))}</button>`
            : `<a class="bl-confirm" href="/auth/steam">${esc(__('buy_link.sign_in'))}</a>`
        body = `
            ${several ? `<p class="bl-lead">${esc(__('buy_link.pick', { count: copies.length }))}</p>` : ''}
            <div class="bl-list" ${several ? `role="radiogroup" aria-label="${esc(__('buy_link.pick_title'))}"` : ''}>
                ${copies.map((copy, i) => copy_html(copy, i, several)).join('')}
            </div>
            <p class="bl-note">${esc(signed_in ? __('buy_link.note') : __('buy_link.sign_in_note'))}</p>
            <div class="bl-actions">
                <button type="button" class="bl-cancel">${esc(__('trade.cancel'))}</button>
                ${action}
            </div>`
    }

    modal.querySelector('.modal_header .modal_name').textContent = title
    modal.querySelector('.modal_content').innerHTML = `<div class="buy-link">${body}</div>`

    let picked = several ? null : copies[0]
    const confirm = modal.querySelector('button.bl-confirm')

    modal.querySelectorAll('button.bl-item').forEach((el) => el.addEventListener('click', () => {
        picked = copies[Number(el.dataset.i)]
        modal.querySelectorAll('button.bl-item').forEach((other) => {
            other.classList.toggle('picked', other == el)
            other.setAttribute('aria-checked', other == el ? 'true' : 'false')
        })
        if(confirm){ confirm.disabled = false }
    }))

    modal.querySelector('.bl-cancel')?.addEventListener('click', () => main.toggleModal(main.modals.buy_link, 'close'))

    const reset = () => {
        confirm.disabled = false
        confirm.classList.remove('sending')
        confirm.textContent = __('buy_link.request')
    }
    confirm?.addEventListener('click', async () => {
        if(!picked || confirm.disabled){ return }
        confirm.disabled = true
        confirm.classList.add('sending')
        confirm.textContent = __('buy_link.sending')

        const sent = await trade.create_trade('single_item', { assetid: picked.assetid, bot: picked.bot, bp_sku: picked.bp_sku }, (ok) => {
            if(!ok){ return reset() }
            // the trade offer modal takes over from here (trade.js -> tradeOfferConnection);
            // a reload shouldn't offer the same item again
            try { history.replaceState(null, '', lurl('/')) } catch (e) {}
        })
        if(sent === false){ reset() }
    })

    main.toggleModal(main.modals.buy_link, 'open')
}

export { open }
