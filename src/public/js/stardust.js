// Nebula theme only (view/partials/head.ejs loads it when service/season.js puts theme-nebula on <body>):
// stardust over the nebula sky (scss/partials/_themes.scss). One fixed canvas behind the page content that never
// takes clicks. The stars drift slowly along the nebula (from the violet upper left towards the teal lower right),
// the nearer, bigger ones a little faster than the far ones, and each fades in and out at its own pace; a few bright
// ones have a soft glow. A star that drifts off one edge comes back in at the other. The page content sits on solid
// sheets, so the stars show only on the open sky, never under text. People who ask for less motion get the same
// stars, still. Nothing is drawn while the tab is hidden.
(() => {
    const body = document.body
    if (!body || !body.classList.contains('theme-nebula') || body.classList.contains('admin-app')) { return } // not in the admin panel
    const still = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

    const canvas = document.createElement('canvas')
    canvas.className = 'stardust'
    canvas.setAttribute('aria-hidden', 'true')
    body.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    if (!ctx) { canvas.remove(); return }

    // star colours: mostly white, some cold blue, some lavender, a rare warm pink (as in pictures of nebulae)
    const TINTS = [[255, 255, 255], [255, 255, 255], [214, 232, 255], [200, 222, 255], [226, 212, 255], [255, 214, 240]]
    const FRAME_MS = 1000 / 30 // a slow drift and fade need no more than 30 frames a second
    // the drift: px per second for the farthest and the nearest stars, along the nebula (a shallow slope down to the right)
    const SPEED_FAR = 2.5
    const SPEED_NEAR = 11
    const HEADING = 0.38 // radians below the horizontal
    const EDGE = 24 // px off screen before a star comes back at the other side (so its glow never pops)

    let width = 0, height = 0, ratio = 1, stars = [], frame = null, last = 0
    const glows = new Map() // a soft glow per tint, drawn once

    // about one star per 8,000 px² of screen: ~160 on a laptop, ~45 on a phone
    const star_count = () => Math.max(36, Math.min(240, Math.round(width * height / 8000)))

    const new_star = () => {
        const size = Math.random()
        const bright = size > 0.93 // a few bright ones with a glow
        // how near the star is (0 far .. 1 near): bigger and brighter stars are nearer, so they drift faster
        const near = bright ? 0.75 + Math.random() * 0.25 : size * size * 0.8
        const heading = HEADING + (Math.random() - 0.5) * 0.3 // not all exactly parallel
        const speed = SPEED_FAR + (SPEED_NEAR - SPEED_FAR) * near
        return {
            x: Math.random(), // 0..1 of the screen, so a resize keeps them spread out
            y: Math.random(),
            vx: Math.cos(heading) * speed, // px per second
            vy: Math.sin(heading) * speed,
            r: bright ? 1.1 + Math.random() * 0.7 : 0.35 + size * size * 0.9,
            alpha: bright ? 0.75 + Math.random() * 0.25 : 0.22 + Math.random() * 0.5,
            tint: TINTS[Math.floor(Math.random() * TINTS.length)],
            bright,
            period: 3500 + Math.random() * 6500, // ms for one fade out and back
            phase: Math.random() * Math.PI * 2,
            depth: 0.35 + Math.random() * 0.6 // how far it fades: some barely, some almost out
        }
    }

    const glow_of = (tint) => {
        const key = tint.join(',')
        if (glows.has(key)) { return glows.get(key) }
        const size = 64
        const sprite = document.createElement('canvas')
        sprite.width = sprite.height = size
        const g = sprite.getContext('2d')
        const fill = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        fill.addColorStop(0, `rgba(${key}, 0.55)`)
        fill.addColorStop(0.18, `rgba(${key}, 0.18)`)
        fill.addColorStop(1, `rgba(${key}, 0)`)
        g.fillStyle = fill
        g.fillRect(0, 0, size, size)
        glows.set(key, sprite)
        return sprite
    }

    // the canvas is as tall as the screen with the phone's address bar hidden (100lvh in the CSS), so the bar coming and
    // going doesn't move the stars
    const resize = () => {
        const w = canvas.clientWidth || window.innerWidth
        const h = canvas.clientHeight || window.innerHeight
        const r = Math.min(window.devicePixelRatio || 1, 2)
        if (w === width && h === height && r === ratio) { return }
        ratio = r
        width = w
        height = h
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        const want = star_count()
        while (stars.length < want) { stars.push(new_star()) }
        stars.length = want
        if (still || !frame) { draw(performance.now(), 0, true) }
    }

    // moves a star by its drift over `dt` seconds; off one edge (with its glow), back in at the other
    const drift = (s, dt) => {
        const pad_x = EDGE / width, pad_y = EDGE / height
        s.x += s.vx * dt / width
        s.y += s.vy * dt / height
        if (s.x > 1 + pad_x) { s.x -= 1 + 2 * pad_x } else if (s.x < -pad_x) { s.x += 1 + 2 * pad_x }
        if (s.y > 1 + pad_y) { s.y -= 1 + 2 * pad_y } else if (s.y < -pad_y) { s.y += 1 + 2 * pad_y }
    }

    const draw = (now, dt, once) => {
        ctx.clearRect(0, 0, width, height)
        for (const s of stars) {
            if (dt) { drift(s, dt) }
            // a slow breath between (1 - depth) and full brightness
            const wave = still ? 1 : 0.5 + 0.5 * Math.sin(now / s.period * Math.PI * 2 + s.phase)
            const alpha = s.alpha * (1 - s.depth * (1 - wave * wave))
            const x = s.x * width, y = s.y * height
            if (s.bright) {
                const glow = s.r * 9
                ctx.globalAlpha = alpha
                ctx.drawImage(glow_of(s.tint), x - glow, y - glow, glow * 2, glow * 2)
            }
            ctx.globalAlpha = alpha
            ctx.fillStyle = `rgb(${s.tint.join(',')})`
            ctx.beginPath()
            ctx.arc(x, y, s.r, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalAlpha = 1
        if (!once) { frame = requestAnimationFrame(tick) }
    }

    const tick = (now) => {
        if (!last) { last = now }
        if (now - last < FRAME_MS) { frame = requestAnimationFrame(tick); return }
        // at most a tenth of a second of drift per frame, so a slow or busy page never makes the stars jump
        const dt = Math.min(now - last, 100) / 1000
        last = now
        draw(now, dt)
    }

    const start = () => { if (!still && !frame) { last = 0; frame = requestAnimationFrame(tick) } }
    const stop = () => { if (frame) { cancelAnimationFrame(frame); frame = null } }

    let resizing = null
    window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(resize, 120) })
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start() })
    resize()
    start()
})()
