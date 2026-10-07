/* Subtle page motion (styles: scss/partials/_motion.scss)
   - the page content fades in on load; on browsers that support it, moving between pages cross-fades (View Transitions)
   - blocks further down the page fade/slide up a little when they scroll into view
   - nothing moves for people who ask for less motion (prefers-reduced-motion)
   Add data-reveal to any element to give it the scroll effect, or data-no-reveal to keep a block still. */
(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;

    const ready = () => {
        const page_view = (typeof view != 'undefined') ? view : ''; // set in partials/head.ejs
        // busy, tool-like pages stay still
        if (['trade', 'admin'].includes(page_view) || document.querySelector('.admin-shell')) return;

        const targets = new Set(document.querySelectorAll('main [data-reveal]'));
        document.querySelectorAll('main .page-section').forEach((section) => {
            if (section.hasAttribute('data-no-reveal')) return;
            const kids = Array.from(section.children).filter((el) => !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName) && !el.hasAttribute('data-no-reveal'));
            (kids.length >= 2 ? kids : [section]).forEach((el) => targets.add(el));
        });

        const fold = window.innerHeight * 0.92;
        const pending = [];
        targets.forEach((el) => {
            // what's already on screen is covered by the page fade-in; position:fixed/sticky blocks are left alone
            const pos = getComputedStyle(el).position;
            if (el.getBoundingClientRect().top < fold || pos == 'fixed' || pos == 'sticky' || el.offsetParent === null) return;
            el.classList.add('reveal');
            pending.push(el);
        });
        if (!pending.length) return;

        const observer = new IntersectionObserver((entries) => {
            // blocks that come into view together appear one after another (max 5 steps)
            entries.filter((e) => e.isIntersecting).forEach((entry, i) => {
                const el = entry.target;
                el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
                el.classList.add('is-visible');
                observer.unobserve(el);
                // drop the transform afterwards so it can't affect tooltips/fixed children
                el.addEventListener('transitionend', () => { el.classList.remove('reveal', 'is-visible'); el.style.removeProperty('--reveal-delay'); }, { once: true });
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        pending.forEach((el) => observer.observe(el));
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
})();
