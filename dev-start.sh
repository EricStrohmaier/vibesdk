#!/bin/bash

# Kill anything already holding port 9229 or 5000 so restarts are clean
fuser -k 9229/tcp 2>/dev/null || true
fuser -k 5000/tcp 2>/dev/null || true
sleep 0.5

# Start a TCP-level proxy on port 9229 → 5000.
# The .replit has both 9229 and 5000 mapped to externalPort=80; Replit routes to the
# last entry (9229). This proxy transparently forwards all traffic (HTTP + WebSockets)
# to the real Vite server on 5000.
node -e "
const net = require('net');
net.createServer(src => {
  const dst = net.createConnection(5000, '127.0.0.1');
  src.pipe(dst);
  dst.pipe(src);
  src.on('error', () => dst.destroy());
  dst.on('error', () => src.destroy());
}).listen(9229, '0.0.0.0', () => {
  process.stderr.write('[proxy] 9229 -> 5000 ready\n');
});
" &

# Vite dev server — all /api/* requests are proxied to the live CF worker at
# app.alpen.digital (see vite.config.ts server.proxy). No local wrangler needed.
exec node_modules/.bin/vite --port 5000 --host 0.0.0.0
