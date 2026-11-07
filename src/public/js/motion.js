/* Page motion (styles: scss/partials/_motion.scss). Everything fades, nothing slides or grows.
   - page intro: partials/head.ejs keeps the page content hidden (html.intro-wait) until the page is ready: its HTML, the
     fonts and the pictures on the first screen, waiting at most INTRO_WAIT ms for them. Then the blocks on the first
     screen fade in one after another; on the first page of a visit the menu fades in first. Lists marked
     data-intro-list (the /items cards, blog posts) fade in card by card.
   - pictures fade in as they finish loading (head.ejs), so nothing pops in half drawn
   - blocks further down fade in when they scroll into view; moving between pages cross-fades (View Transitions)
   - nothing moves for people who ask for less motion (prefers-reduced-motion)
   Add data-reveal to any element to give it the scroll effect, or data-no-reveal to keep a block still. */
(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
        root.classList.remove('intro-wait', 'intro-first');
        return;
    }

    const INTRO_WAIT = 500;   // ms: the longest the intro waits for fonts and first-screen pictures
    const STEP = 60;          // ms between blocks
    const MAX_STEPS = 5;
    const CARD_STEP = 28;     // ms between cards of a data-intro-list
    const MAX_CARDS = 20;
    const SKIP = ['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'];

    const usable = (el) => !SKIP.includes(el.tagName) && !el.hasAttribute('data-no-reveal');
    // fixed/sticky blocks and hidden ones are left alone
    const placed = (el) => {
        const pos = getComputedStyle(el).position;
        return pos != 'fixed' && pos != 'sticky' && el.offsetParent !== null;
    };
    const on_screen = (el, bottom = window.innerHeight) => {
        const rect = el.getBoundingClientRect();
        return rect.top < bottom && rect.bottom > 0 && rect.width > 0;
    };

    // the page's blocks in reading order: the parts of each .page-section (or the section itself if it has one part)
    const blocks = () => {
        const main = document.querySelector('main');
        if (!main) return [];
        const list = [];
        for (const child of main.children) {
            if (!usable(child)) continue;
            if (child.classList.contains('page-section')) {
                const kids = Array.from(child.children).filter(usable);
                list.push(...(kids.length >= 2 ? kids : [child]));
            } else list.push(child);
        }
        return list;
    };

    // ---- page intro -------------------------------------------------------------------------------------------------
    const intro_done = new Set();

    const fade = (el, delay, keep) => {
        // inline, so it also wins over an element's own fade (the cards' fadeInCard). Removed again when it is over,
        // except on cards (keep): their own fade would then start over.
        el.style.animation = `motionIntro 450ms cubic-bezier(.2, .7, .2, 1) ${delay}ms backwards`;
        intro_done.add(el);
        if (keep) return;
        const end = (event) => {
            if (event.target !== el) return;
            el.removeEventListener('animationend', end);
            el.style.removeProperty('animation');
        };
        el.addEventListener('animationend', end);
    };

    const play = () => {
        if (!root.classList.contains('intro-wait')) return;
        const fold = window.innerHeight * 0.92;
        let step = 0;
        // measure everything first, then start: the browser lays the page out once
        const plan = [];
        if (root.classList.contains('intro-first')) {
            const nav = document.querySelector('nav.nav-main');
            if (nav) {
                plan.push([nav, 0]);
                step++;
            }
        }
        for (const el of blocks()) {
            if (!placed(el) || !on_screen(el, fold)) continue;
            const delay = Math.min(step, MAX_STEPS) * STEP;
            const list = el.matches('[data-intro-list]') ? el : el.querySelector('[data-intro-list]');
            if (list) {
                // the cards one after another; whatever else the block holds simply shows
                Array.from(list.children).filter((card) => usable(card) && on_screen(card, fold))
                    .forEach((card, i) => plan.push([card, delay + Math.min(i, MAX_CARDS) * CARD_STEP, true]));
            } else if (getComputedStyle(el).animationName == 'none' && !el.querySelector('.fade-in, .fade-in-absolute')) {
                // blocks with a fade of their own (the home page hero text) keep it: it waits for the intro (_motion.scss)
                plan.push([el, delay]);
            }
            step++;
        }
        // on a short page the footer comes last
        const footer = document.querySelector('footer');
        if (footer && on_screen(footer, fold)) plan.push([footer, Math.min(step, MAX_STEPS) * STEP]);
        plan.forEach(([el, delay, keep]) => fade(el, delay, keep));
        root.classList.remove('intro-wait', 'intro-first');
        reveal_below();
    };

    const start = () => {
        const pictures = Array.from(document.querySelectorAll('nav img, main img'))
            .filter((img) => !img.complete && on_screen(img))
            .map((img) => new Promise((done) => {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
            }));
        const ready = Promise.all([document.fonts ? document.fonts.ready : null, ...pictures]);
        Promise.race([ready, new Promise((done) => setTimeout(done, INTRO_WAIT))]).then(() => requestAnimationFrame(play));
    };

    // ---- blocks further down: fade in when scrolled to ------------------------------------------------------------
    const reveal_below = () => {
        const page_view = (typeof view != 'undefined') ? view : ''; // set in partials/head.ejs
        // busy, tool-like pages stay still
        if (['trade', 'admin'].includes(page_view) || document.querySelector('.admin-shell')) return;

        const targets = new Set(document.querySelectorAll('main [data-reveal]'));
        blocks().forEach((el) => targets.add(el));

        const fold = window.innerHeight * 0.92;
        // what's already on screen came in with the intro
        const pending = Array.from(targets).filter((el) => !intro_done.has(el) && placed(el) && el.getBoundingClientRect().top >= fold);
        if (!pending.length) return;
        pending.forEach((el) => el.classList.add('reveal'));

        const observer = new IntersectionObserver((entries) => {
            // blocks that come into view together appear one after another (max 5 steps)
            entries.filter((e) => e.isIntersecting).forEach((entry, i) => {
                const el = entry.target;
                el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
                el.classList.add('is-visible');
                observer.unobserve(el);
                el.addEventListener('transitionend', () => { el.classList.remove('reveal', 'is-visible'); el.style.removeProperty('--reveal-delay'); }, { once: true });
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        pending.forEach((el) => observer.observe(el));
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
