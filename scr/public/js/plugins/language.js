const setLanguage = (newLang) => {
    const langOptions = document.getElementById('langSelect').parentElement.querySelector('.dropdown').children
    const currentLang = document.getElementById('currentLang')

    function changeLanguage(languageCode) {
        Array.from(document.getElementsByClassName('lang')).forEach(function (elem) {
            if (elem.classList.contains('lang-' + languageCode)) {
                 elem.style.display = 'initial';
            } else {
                 elem.style.display = 'none';
            }
        });
        document.querySelector('html').setAttribute('lang', languageCode)
    }
    
    if(newLang == undefined){
        if(localStorage.getItem('tf2deal-lang')){
            const startLang = localStorage.getItem('tf2deal-lang');

            changeLanguage(startLang);
        
            // updating select with start value
            for (let i = 0; i < langOptions.length; i++) {
                langOptions[i].classList.remove('active')
                if(langOptions[i].classList.contains(startLang)){
                    langOptions[i].classList.add('active')
                    currentLang.querySelector('img').setAttribute('src', `/img/flags/${startLang}_96x96.png`)
                }
            }
        } else {
            // detect initial browser language
            const lang = navigator.userLanguage || navigator.language || 'en-EN';
            const startLang = Array.from(langOptions).map(opt => opt.classList[1]).find(val => lang.includes(val)) || 'en';
        
            changeLanguage(startLang);
        
            // updating select with start value
            for (let i = 0; i < langOptions.length; i++) {
                langOptions[i].classList.remove('active')
                if(langOptions[i].classList.contains(startLang)){
                    langOptions[i].classList.add('active')
                    currentLang.querySelector('img').setAttribute('src', `/img/flags/${startLang}_96x96.png`)
                }
            }
        }
    }
    if(newLang != undefined){
        for (let i = 0; i < langOptions.length; i++) {
            langOptions[i].classList.remove('active')
            if(langOptions[i].classList.contains(newLang)){
                langOptions[i].classList.add('active')
                currentLang.querySelector('img').setAttribute('src', `/img/flags/${newLang}_96x96.png`)
            }
        }

        changeLanguage(newLang)
        localStorage.setItem('tf2deal-lang', newLang)
    }
}

export {setLanguage}