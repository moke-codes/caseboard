# CaseBoard

CaseBoard is a Nuxt 3 application for investigating Bluesky posts on a draggable caseboard with links, post-its, and shared boards.

## Production Installation

### 1. Prerequisites

- Node.js 20 LTS (recommended)
- npm 10+

Check versions:

```bash
node -v
npm -v
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Build for Production

```bash
npm run build
```

This generates the server output in `.output/`.

## Run in Production

### Option A: Use Nuxt Preview (simple)

```bash
npm run preview -- --host 0.0.0.0 --port 3000
```

### Option B: Run Nitro Server directly

```bash
node .output/server/index.mjs
```

You can set host/port with environment variables:

```bash
NITRO_HOST=0.0.0.0 NITRO_PORT=3000 node .output/server/index.mjs
```

## Data Persistence

Shared board data is stored on disk using Nitro storage at:

- `.data/storage`

For production, make sure this path is persistent (for example, mounted volume in Docker/VM).

## Suggested Deployment Setup

- Put the app behind a reverse proxy (Nginx/Caddy/Traefik).
- Enable HTTPS at the proxy layer.
- Keep `.data/storage` backed up if shared boards are important.

## NGINX Setup (Reverse Proxy)

Example assumes:

- CaseBoard is running locally on `127.0.0.1:3000`
- Public domain is `caseboard.example.com`

Create NGINX site config:

```nginx
server {
    listen 80;
    server_name caseboard.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Optional for websocket/long-lived connections
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/caseboard /etc/nginx/sites-enabled/caseboard
sudo nginx -t
sudo systemctl reload nginx
```

If you use UFW:

```bash
sudo ufw allow 'Nginx Full'
```

For HTTPS, issue a certificate (example with Certbot):

```bash
sudo certbot --nginx -d caseboard.example.com
```

## Run Automatically on Server Boot (systemd)

Create a service file:

```bash
sudo nano /etc/systemd/system/caseboard.service
```

Use:

```ini
[Unit]
Description=CaseBoard (Nuxt/Nitro)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/caseboard
Environment=NODE_ENV=production
Environment=NITRO_HOST=127.0.0.1
Environment=NITRO_PORT=3000
ExecStart=/usr/bin/node /opt/caseboard/.output/server/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable caseboard
sudo systemctl start caseboard
```

Check status/logs:

```bash
sudo systemctl status caseboard
sudo journalctl -u caseboard -f
```

Notes:

- Adjust `User`, `WorkingDirectory`, and `ExecStart` to your server paths.
- Ensure your app is built (`npm run build`) before starting the service.

## Operational Commands

- Type check:

```bash
npm run typecheck
```

- Tests:

```bash
npm test
```
