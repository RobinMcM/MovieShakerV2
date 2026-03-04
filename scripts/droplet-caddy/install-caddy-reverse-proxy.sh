#!/usr/bin/env bash
# Install Caddy reverse proxy with automatic HTTPS for api.movieshaker.com
# Run this script on the Droplet (Ubuntu/Debian) as root or with sudo.
# Prerequisites: A record api.movieshaker.com -> Droplet IP (167.172.51.68)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE_SRC="${SCRIPT_DIR}/Caddyfile"
CADDYFILE_DEST="/etc/caddy/Caddyfile"

echo "=== MovieShaker API – Caddy reverse proxy installer ==="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
else
    OS_ID="unknown"
fi

# Install Caddy on Debian/Ubuntu
if [[ "$OS_ID" == "debian" || "$OS_ID" == "ubuntu" ]]; then
    if ! command -v caddy &>/dev/null; then
        echo "Installing Caddy..."
        apt-get update -qq
        apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
        chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        chmod o+r /etc/apt/sources.list.d/caddy-stable.list
        apt-get update -qq
        apt-get install -y caddy
        echo "Caddy installed."
    else
        echo "Caddy is already installed."
    fi
else
    echo "This script supports Debian/Ubuntu only. Install Caddy manually and copy Caddyfile to ${CADDYFILE_DEST}"
    exit 1
fi

# Deploy Caddyfile
if [ ! -f "$CADDYFILE_SRC" ]; then
    echo "Error: Caddyfile not found at $CADDYFILE_SRC"
    exit 1
fi

if [ -f "$CADDYFILE_DEST" ]; then
    cp "$CADDYFILE_DEST" "${CADDYFILE_DEST}.bak.$(date +%Y%m%d%H%M%S)"
    echo "Backed up existing Caddyfile."
fi

cp "$CADDYFILE_SRC" "$CADDYFILE_DEST"
echo "Caddyfile installed to $CADDYFILE_DEST"

# Ensure Caddy user can read it
chown root:caddy "$CADDYFILE_DEST" 2>/dev/null || true
chmod 644 "$CADDYFILE_DEST"

# Restart Caddy to apply config and obtain certificate
systemctl restart caddy
systemctl enable caddy 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Caddy is configured for https://api.movieshaker.com -> http://127.0.0.1:8000"
echo "The first request may take a few seconds while Caddy obtains the TLS certificate."
echo ""
echo "Check status:  systemctl status caddy"
echo "View logs:     journalctl -u caddy -f"
echo ""
echo "Set NEXT_PUBLIC_API_URL=https://api.movieshaker.com in your frontend (e.g. DO App Platform)."
