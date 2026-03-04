# Caddy reverse proxy (Docker)

HTTPS for **api.movieshaker.com** is provided by the `caddy` service in docker-compose. Caddy proxies to the `engine` service and obtains/renews the Let's Encrypt certificate automatically.

## Requirements

- DNS: A record **api.movieshaker.com** → your Droplet IP.
- Ports **80** and **443** open on the host and not used by another service.

## Usage

Start the stack (including Caddy) on the Droplet:

```bash
docker compose up -d
```

Set your frontend env: **NEXT_PUBLIC_API_URL=https://api.movieshaker.com**

## Files

- **Caddyfile** – Proxies api.movieshaker.com to `engine:8000` (Docker network). Caddy handles TLS.
