// The language is part of the URL (/de/..., see src/i18n.js). On the first visit the server picks it from the
// browser's language; after that the visitor decides:
//   - picking a language in the menu or in the suggestion bar saves it (td_lang cookie, 1 year)
//   - closing the suggestion bar keeps the current language and saves that
// The server then opens the site in the saved language on the next visit.
const save_language = (lang) => {
    if(!lang){ return }
    document.cookie = `td_lang=${encodeURIComponent(lang)}; Max-Age=${365 * 24 * 60 * 60}; Path=/; SameSite=Lax` + (location.protocol == 'https:' ? '; Secure' : '')
}

// language menu + "Switch to ..." link (data-lang on the link). Registered when this file loads, on every page.
document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a[data-lang]')
    if(link){ save_language(link.dataset.lang) }
})

const lang_suggest = () => {
    const bar = document.getElementById('lang-suggest')
    if(!bar){ return }
    bar.classList.remove('hidden')
    bar.querySelector('.lang-suggest-close').addEventListener('click', () => {
        save_language(window.TD_LANG) // "no thanks": stay in this language
        bar.remove()
    })
}

export {lang_suggest, save_language}
