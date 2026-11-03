// The site socket (trade updates, notifications, live settings). Loaded with defer, so it runs before main.js and
// the page modules that use it.
const socket = io(user != 'no_session' ? { auth: { steamid: user } } : {})

// An open socket stops the browser from keeping the page for the back/forward buttons,
// so close it when the visitor leaves and open it again if they come back to the same page.
window.addEventListener('pagehide', () => socket.disconnect())
window.addEventListener('pageshow', (e) => { if(e.persisted){ socket.connect() } })
// the server sends its site version on every connection; kept here so js/connection.js still sees it when the
// socket connected before that script ran
socket.on('site_version', (version) => { socket.site_version = version })
