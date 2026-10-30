# Trade offer status while the offer is being created

While a trade offer is open, the site asks the bot server for its status every 15 seconds (`getTradeOffer`, and again
when the page reconnects or comes back to the front). bot_manager answers `canceled` whenever it has no sent offer and
no trade waiting for approval for that user. It does the same while the trade still waits in `trades.queue`, or while
`processTrades` loads the inventories and makes the offer. The site then said "Your trade offer was canceled", and the
offer arrived a while later.

While its window says the offer is being created, the site now treats a `canceled` answer without an offer as "not
made yet" for 5 minutes after the trade was requested (`WAIT_FOR_OFFER` in `src/public/js/plugins/trade.js`), and it
shows a `failed_to_send` from `offer_status` as an error.

With the change below the bot server also gives the right answer, so a trade that really disappears (a bot server
restart, for example) shows as canceled at once instead of after those 5 minutes.

## What the bot server needs (bot_manager)

1. `src/controllers/tradeController.js`: add a set of the users whose trade is being made, next to `queue`:

```js
export const trades = {
    itemsInTrade: new Set(),
    waitingForApproval: new Map(),
    pendingConfirmations: new Map(),
    queue: [],
    processing: new Set()   // users whose trade processTrades is working on (inventories loading, offer being made)
};
```

2. `src/utils/bots.js`, `processTrades`: keep the user in it while their trade is worked on:

```js
        const partner = trade.partner_steamid;
        const lockKey = tradeLockKey(partner);
        trades.processing.add(partner);

        try {
            // ... as it is
        } catch (e) {
            // ... as it is
        } finally {
            trades.processing.delete(partner);
        }
```

3. `src/services/socket.js`, the `getTradeOffer` handler: answer `creating` for a trade that is queued or being made:

```js
web_socket.socket.on('getTradeOffer', (steamid) => {
    const creating = trades.queue.some(t => t.partner_steamid === steamid) || trades.processing?.has(steamid)
    const offer = bot.sentTradeOffers.has(steamid) ? bot.sentTradeOffers.get(steamid)
        : trades.waitingForApproval.has(steamid) ? {partner: steamid, priceChanges: trades.waitingForApproval.get(steamid)?.priceChanges, offer: null, status: 'waitingApproval'}
        : creating ? {partner: steamid, offer: null, status: 'creating'}
        : {partner: steamid, offer: null, status: 'canceled'}

    web_socket.socket.emit('TradeOffer', offer)
})
```

4. Restart the bot server.
