// Smissmas only (view/partials/head.ejs loads it when service/season.js puts season-smissmas on <body>):
// a light blizzard drifting across the whole site. One fixed canvas on top of the page that never takes clicks.
// Kept calm on purpose: few flakes, small and see-through, the wind gusts slowly instead of shaking.
// Nothing runs for people who ask for less motion, and it stops while the tab is hidden.
(() => {
    if (!document.body || !document.body.classList.contains('season-smissmas')) { return }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return }

    const canvas = document.createElement('canvas')
    canvas.className = 'blizzard'
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    if (!ctx) { return }

    let width = 0, height = 0, flakes = [], last = 0, clock = 0, frame = null

    // about one flake per 20,000 px² of screen: ~65 on a laptop, ~25 on a phone
    const flake_count = () => Math.max(20, Math.min(90, Math.round(width * height / 20000)))

    const new_flake = (anywhere) => {
        const near = Math.random() < 0.25 // a few bigger, faster flakes "close to the camera" read as a storm
        const from_top = Math.random() < 0.5 // new ones blow in over the top or the left edge, so no corner stays empty
        return {
            x: anywhere ? Math.random() * width : from_top ? Math.random() * width : -10 - Math.random() * 40,
            y: anywhere ? Math.random() * height : from_top ? -10 - Math.random() * 40 : Math.random() * height,
            near,
            r: near ? 1.1 + Math.random() * 0.8 : 0.6 + Math.random() * 0.9,
            speed: near ? 1.6 + Math.random() * 0.8 : 0.7 + Math.random() * 0.7,
            alpha: near ? 0.35 + Math.random() * 0.2 : 0.2 + Math.random() * 0.3,
            phase: Math.random() * Math.PI * 2
        }
    }

    const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        const want = flake_count()
        while (flakes.length < want) { flakes.push(new_flake(true)) }
        flakes.length = want
    }

    const draw = (now) => {
        const dt = Math.min((now - (last || now)) / 16.67, 3) // in 60 fps frames, so speed is the same on 120 Hz screens
        last = now
        clock += dt
        // the wind blows left to right and swells every ~10 s
        const wind = 1.6 + Math.sin(clock / 160) * 0.9 + Math.sin(clock / 47) * 0.35
        ctx.clearRect(0, 0, width, height)
        ctx.lineCap = 'round'
        for (const f of flakes) {
            const vx = wind * f.speed
            const vy = f.speed * 0.9 + Math.sin(clock / 30 + f.phase) * 0.25
            f.x += vx * dt
            f.y += vy * dt
            if (f.x > width + 20 || f.y > height + 20) { Object.assign(f, new_flake(false)) }
            // a short streak in the direction it flies, so the fast ones look wind-driven rather than falling dots
            const tail = f.near ? Math.min(10, 2.4 * f.speed * wind) : Math.min(3, 0.8 * f.speed * wind)
            ctx.strokeStyle = `rgba(255, 255, 255, ${f.alpha})`
            ctx.lineWidth = f.r * 1.7
            ctx.beginPath()
            ctx.moveTo(f.x, f.y)
            ctx.lineTo(f.x - vx / Math.hypot(vx, vy) * tail, f.y - vy / Math.hypot(vx, vy) * tail)
            ctx.stroke()
        }
        frame = requestAnimationFrame(draw)
    }

    const start = () => { if (!frame) { last = 0; frame = requestAnimationFrame(draw) } }
    const stop = () => { if (frame) { cancelAnimationFrame(frame); frame = null } }

    resize()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start() })
    start()
})()
