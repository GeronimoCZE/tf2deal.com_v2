var DB_status = false; // checks if send data to db or save locally
var userData = false; // checks if got data
var tradeOffer = localStorage.getItem('td-tradeOffer')
var tradePopState = "hidden";

window.post = function(url, data) {
    return fetch(url, {method: "POST", headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
}