#!/usr/bin/env bash
# Updates tf2deal.com on the server: the newest code from GitHub, its packages, the stylesheet built again from the
# SCSS, a restart, and a check that the site answers afterwards. Run it from anywhere:
#
#   bash ~/tf2deal/scripts/update.sh
#
# The same steps as "Get updates later" in docs/UBUNTU.md. Your src/config/.env is never touched.
set -euo pipefail

APP=tf2deal                  # the PM2 app name (ecosystem.config.cjs)
cd "$(dirname "$0")/.."      # the site folder

step() { printf '\n== %s\n' "$*"; }

step "1/5 Newest code from GitHub"
# Files the server writes itself would block the pull: style.css (step 3 builds it again anyway) and old sitemap
# files (the sitemaps are built on request now). They go back to the committed version first.
git checkout -- src/public/css/style.css 2>/dev/null || true
git checkout -- src/public/sitemap.xml src/public/sitemaps 2>/dev/null || true
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "These files were changed on the server, and git pull would overwrite them:"
  git status --short --untracked-files=no
  echo "Keep the changes with 'git stash' or drop them with 'git checkout -- <file>', then run this again."
  exit 1
fi
before=$(git rev-parse --short HEAD)
git pull --ff-only
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
  echo "Already up to date ($after)."
else
  echo "Updated $before -> $after:"
  git log --oneline "$before..$after" | sed 's/^/  /'
fi

step "2/5 Packages"
npm install --no-audit --no-fund

step "3/5 Stylesheet"
# src/public/scss -> src/public/css/style.css (package.json build:css)
npm run --silent build:css
echo "Built src/public/css/style.css."

step "4/5 Restart"
if pm2 describe "$APP" >/dev/null 2>&1; then
  pm2 restart "$APP"
else
  echo "PM2 doesn't run '$APP' yet, starting it from ecosystem.config.cjs."
  pm2 start ecosystem.config.cjs
  pm2 save
fi

step "5/5 Check that the site answers"
# PORT from src/config/.env if it is set there, else the site's own default
port=$(grep -E '^[[:space:]]*PORT=' src/config/.env 2>/dev/null | tail -n 1 | cut -d= -f2 | tr -d "\"' \r" || true)
port=${port:-8080}
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$port/about" || true)
  if [ "$code" = "200" ]; then
    echo "The site answers on port $port. Done ($after)."
    exit 0
  fi
  sleep 2
done
echo "The site didn't answer on port $port within a minute (last answer: ${code:-none}). Its last log lines:"
pm2 logs "$APP" --lines 40 --nostream || true
exit 1
