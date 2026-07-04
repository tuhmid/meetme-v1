#!/usr/bin/env bash
# Launch Expo pointed at THIS Mac's current LAN IP, so it works on any network
# (home wifi, a café, your phone's hotspot in the car). Phone + Mac must be on the
# same network. The backend (db:start / api:dev / worker:dev) runs from the repo root.
set -e

# find the IP of whatever interface has the default route, with en0/en1 fallbacks
IFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)
[ -z "$IP" ] && IP=$(ipconfig getifaddr en0 2>/dev/null || true)
[ -z "$IP" ] && IP=$(ipconfig getifaddr en1 2>/dev/null || true)

if [ -z "$IP" ]; then
  echo "✗ No LAN IP found. Connect to wifi or your phone's hotspot, then retry."
  exit 1
fi

echo "→ Mac IP: $IP  (make sure your phone is on the SAME network)"
echo "  API:      http://$IP:8787"
echo "  Supabase: http://$IP:54321"
echo

EXPO_PUBLIC_API_URL="http://$IP:8787" \
EXPO_PUBLIC_SUPABASE_URL="http://$IP:54321" \
  npx expo start --go
