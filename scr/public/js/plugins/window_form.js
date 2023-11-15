const new_user = (state) => {
    if(state == 'show'){
        // valid Trade URL = min 72, max 78 characters (75 exactly), 
        // must start with 'https://steamcommunity.com/tradeoffer/new/?partner=',
        // must include word 'token='
        // partner must == user's accountid
        const overlay = `<div class="html_overlay" id="html_overlay"></div>`
        const form = 
        `<div class="new-user_popUp" id="new-user_popUp">
            <div class="popUp-content">
            
            </div>
            <div class="popUp-image">
                <img src="/img/sfm/sfm1.jpg">
            </div>
        </div>`;
        $('html').append([overlay, form]);
    }
    else if(state == 'hide'){
        const overlay = $('#html_overlay')
        const form = $('#new-user_popUp')
        overlay.addClass('hide')
        form.addClass('hide')
    }
}


export {new_user}