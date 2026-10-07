/* Cookie consent (banner + "Cookie settings").
 *
 * Choice is saved in the td_consent cookie for 12 months: "v1:p0:a<0|1>:<timestamp>"
 *   a = analytics (not used yet). p is kept for choices saved by the first version (it was the language cookie,
 *   which is now saved only when the visitor picks a language, see public/js/plugins/language.js).
 * Necessary cookies (sign-in, security, the picked language, this choice) are always on.
 * With no optional cookies the banner is a notice with "OK" (see view/partials/cookie_banner.ejs).
 *
 * Adding analytics later: put the script in the page as
 *     <script type="text/plain" data-consent="analytics" src="..."></script>
 * set app.locals.analytics_enabled = true (shows the switch), and it only runs after the visitor allows analytics.
 * Other scripts can check window.tdConsent.has('analytics') or listen for the 'td:consent' event.
 */
(function () {
    var COOKIE = 'td_consent';
    var MAX_AGE = 365 * 24 * 60 * 60; // 12 months, then we ask again

    function read() {
        var m = document.cookie.match(/(?:^|;\s*)td_consent=([^;]*)/);
        if (!m) return null;
        var p = /^v1:p([01]):a([01]):(\d+)$/.exec(decodeURIComponent(m[1]));
        return p ? { preferences: p[1] == '1', analytics: p[2] == '1', time: Number(p[3]) } : null;
    }

    function set_cookie(name, value, max_age) {
        document.cookie = name + '=' + encodeURIComponent(value) + '; Max-Age=' + max_age + '; Path=/; SameSite=Lax' + (location.protocol == 'https:' ? '; Secure' : '');
    }

    function cleanup(choice) {
        try { localStorage.removeItem('tf2deal-lang'); } catch (e) {} // old language switcher
    }

    // <script type="text/plain" data-consent="analytics"> -> real script once allowed
    function activate(choice) {
        var waiting = document.querySelectorAll('script[type="text/plain"][data-consent]');
        for (var i = 0; i < waiting.length; i++) {
            var el = waiting[i];
            if (!choice[el.getAttribute('data-consent')]) continue;
            var s = document.createElement('script');
            for (var a = 0; a < el.attributes.length; a++) {
                var attr = el.attributes[a];
                if (attr.name != 'type' && attr.name != 'data-consent') s.setAttribute(attr.name, attr.value);
            }
            s.text = el.text;
            el.parentNode.replaceChild(s, el);
        }
    }

    function hide(id) { var el = document.getElementById(id); if (el) el.classList.add('cookie-hidden'); }
    function show(id) { var el = document.getElementById(id); if (el) el.classList.remove('cookie-hidden'); }

    function save(choice) {
        set_cookie(COOKIE, 'v1:p' + (choice.preferences ? 1 : 0) + ':a' + (choice.analytics ? 1 : 0) + ':' + Date.now(), MAX_AGE);
        cleanup(choice);
        activate(choice);
        hide('cookie-banner');
        hide('cookie-settings');
        try { window.dispatchEvent(new CustomEvent('td:consent', { detail: choice })); } catch (e) {}
    }

    function open_settings() {
        var c = read() || { preferences: false, analytics: false };
        var anal = document.getElementById('consent-analytics');
        if (anal) anal.checked = c.analytics;
        show('cookie-settings');
        var first = document.querySelector('#cookie-settings input:not([disabled]), #cookie-settings button');
        if (first) first.focus();
    }

    window.tdConsent = {
        get: read,
        has: function (category) { var c = read(); return category == 'necessary' || Boolean(c && c[category]); },
        open: open_settings
    };

    document.addEventListener('click', function (e) {
        var link = e.target.closest && e.target.closest('[data-cookie-settings]');
        if (link) { e.preventDefault(); open_settings(); return; }

        var btn = e.target.closest && e.target.closest('[data-consent-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-consent-action');
        if (action == 'accept') save({ preferences: false, analytics: true });
        if (action == 'reject' || action == 'ok') save({ preferences: false, analytics: false });
        if (action == 'settings') open_settings();
        if (action == 'save') {
            var anal = document.getElementById('consent-analytics');
            save({ preferences: false, analytics: Boolean(anal && anal.checked) });
        }
        if (action == 'close') hide('cookie-settings');
    });

    document.addEventListener('keydown', function (e) {
        if (e.key == 'Escape') hide('cookie-settings');
    });

    var current = read();
    if (current) { activate(current); hide('cookie-banner'); }
    else { show('cookie-banner'); }
    if (location.hash == '#cookie-settings') open_settings();
})();
