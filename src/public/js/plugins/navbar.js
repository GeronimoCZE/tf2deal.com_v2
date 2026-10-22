const navDropdown = (elOpen, elsClose) => {
    if(elOpen != ''){
        document.querySelector(`nav ${elOpen}`).classList.toggle('open')
    }
    elsClose.forEach(elClose => {
        try{
            document.querySelector(`nav ${elClose}`).classList.remove('open')
        } catch{}
    });
}

const collapseLinks = () => {
    let links = document.querySelector('.nav-section.right')
    let hamburger = document.getElementById('collapseNavLinks').querySelector('.hamburger')
    links.classList.toggle('open')
    hamburger.classList.toggle('is-active')
    document.getElementById('collapseNavLinks').setAttribute('aria-expanded', links.classList.contains('open'))
    // close any open dropdowns inside the menu
    document.querySelectorAll('nav .langSelect.open, nav .themeSelect.open, nav .user-avatar.open, nav .link.dropdown.community.open').forEach((el) => el.classList.remove('open'))

    $('#body_overlay').remove();
    $('body').removeClass('no-scroll')

    if(document.querySelector('.nav-section.right.open')){
        $('body').append(`<div class="overlay" id="body_overlay"></div>`)
        $('body').addClass('no-scroll')
    }
}

// Wide screens: the cog in the menu bar opens language and theme in one dialog (#siteSettings in views/partials/nav.ejs).
// <dialog> keeps the focus inside and closes with Esc; the close button or a click on the dimmed page closes it too.
const settings_dialog = document.getElementById('siteSettings')
if(settings_dialog && typeof settings_dialog.showModal == 'function'){
    document.getElementById('navSettings')?.addEventListener('click', () => {
        navDropdown('', ['.notifications', '.user-avatar', '.langSelect', '.themeSelect'])
        settings_dialog.showModal()
    })
    settings_dialog.addEventListener('click', (e) => {
        const box = settings_dialog.getBoundingClientRect()
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
        if(e.target.closest('[data-ss-close]') || (e.target === settings_dialog && outside)){ settings_dialog.close() }
    })
}

export { navDropdown , collapseLinks }