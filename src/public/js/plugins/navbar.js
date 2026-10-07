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
    document.querySelectorAll('nav .langSelect.open, nav .user-avatar.open, nav .link.dropdown.community.open').forEach((el) => el.classList.remove('open'))

    $('#body_overlay').remove();
    $('body').removeClass('no-scroll')

    if(document.querySelector('.nav-section.right.open')){
        $('body').append(`<div class="overlay" id="body_overlay"></div>`)
        $('body').addClass('no-scroll')
    }
}

export { navDropdown , collapseLinks }