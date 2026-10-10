# tf2deal.com on Ubuntu, straight from GitHub

Run these on the Ubuntu server, one block at a time. Lines starting with `#` after a command are notes.

## 1. Install Git, Node.js 20 and PM2 (keeps the site running)

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Let the server read your GitHub repo

If the repo is private, give the server its own read-only key:

```bash
ssh-keygen -t ed25519 -C "tf2deal-server" -f ~/.ssh/tf2deal -N ""
cat ~/.ssh/tf2deal.pub
```

Copy the line it prints. On GitHub open **tf2deal.com_v2 → Settings → Deploy keys → Add deploy key**,
paste it and leave "Allow write access" off. Then tell SSH to use it:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/tf2deal
EOF
```

(Public repo? Skip this step and clone with `https://github.com/GeronimoCZE/tf2deal.com_v2.git` instead.)

## 3. Download the site

```bash
cd ~
git clone git@github.com:GeronimoCZE/tf2deal.com_v2.git tf2deal
cd tf2deal
npm install
```

## 4. Add your settings (never in Git)

```bash
mkdir -p src/config
cp .env.example src/config/.env
nano src/config/.env
```

Fill in every value. Set `SITE_URL=https://tf2deal.com` and a `SESSION_SECRET` of 32+ random
characters (`openssl rand -hex 32` makes one). With Nginx in front (see the end of this page) also set
`TRUST_PROXY=1`, or `TRUST_PROXY=2` if Cloudflare sits in front of Nginx. Without it every visitor
shares one rate limit and people get blocked.

## 5. Start it and keep it running after reboots

```bash
pm2 start src/app.js --name tf2deal
pm2 save
pm2 startup     # run the command it prints
```

The site listens on port 8080. Check it with `pm2 logs tf2deal`.

## 6. Get updates later

After a change is merged on GitHub:

```bash
cd ~/tf2deal && git pull && npm install && pm2 restart tf2deal
```

Your `src/config/.env` stays untouched by `git pull`.

## Optional: domain and HTTPS

Put Nginx in front of port 8080 and get a free certificate:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/tf2deal >/dev/null <<'EOF'
server {
  server_name tf2deal.com www.tf2deal.com;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo ln -s /etc/nginx/sites-available/tf2deal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tf2deal.com -d www.tf2deal.com
```

The `Upgrade` lines are needed for the live socket (trades, notifications, live settings).
