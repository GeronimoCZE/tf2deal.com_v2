// PM2 settings for the site (docs/UBUNTU.md): pm2 start ecosystem.config.cjs
//
// Left alone, Node lets its memory grow towards 2 GB before it cleans up properly, so the site showed 800 MB in PM2
// while it used far less. With the cap it cleans up sooner and stays around 200-300 MB. 256 MB is well above what the
// site keeps (about 100 MB with 45,000 items in the database); raise it if the logs ever say "heap out of memory".
module.exports = {
  apps: [{
    name: 'tf2deal',
    script: 'src/app.js',
    cwd: __dirname,
    node_args: '--max-old-space-size=256',
    env: {
      MALLOC_ARENA_MAX: '2' // fewer memory pools outside the heap, less memory left unused between them
    },
    // a safety net only: a restart signs everyone out (sign-ins are kept in memory)
    max_memory_restart: '600M'
  }]
}
