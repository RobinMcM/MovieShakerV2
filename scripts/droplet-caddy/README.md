# Caddy reverse proxy for api.movieshaker.com

Automatic HTTPS (Let's Encrypt) and reverse proxy from `api.movieshaker.com` to your API on `http://127.0.0.1:8000`.

## Prerequisites

- Droplet (Ubuntu or Debian) with your API listening on port 8000 (e.g. Docker engine).
- DNS: **A record** `api.movieshaker.com` → your Droplet IP (e.g. `167.172.51.68`).
- Ports **80** and **443** open on the Droplet (firewall/security group).

## Install on the Droplet

1. Copy this folder to the Droplet (from your machine):

   ```bash
   scp -r scripts/droplet-caddy root@167.172.51.68:~/
   ```

2. SSH in and run the installer:

   ```bash
   ssh root@167.172.51.68
   cd ~/droplet-caddy
   chmod +x install-caddy-reverse-proxy.sh
   sudo ./install-caddy-reverse-proxy.sh
   ```

3. Set your frontend env: `NEXT_PUBLIC_API_URL=https://api.movieshaker.com`

## Files

- **Caddyfile** – Caddy config (api.movieshaker.com → localhost:8000).
- **install-caddy-reverse-proxy.sh** – Installs Caddy (Debian/Ubuntu), deploys Caddyfile, restarts Caddy.

## Notes

- Caddy obtains and renews the TLS certificate automatically (Let's Encrypt).
- If your API runs in Docker on the same host, ensure it listens on `0.0.0.0:8000` or `127.0.0.1:8000` so Caddy can reach it.
