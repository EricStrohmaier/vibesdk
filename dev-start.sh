#!/bin/bash

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

# AI Gateway proxy — workerd's TLS stack can't verify Cloudflare's cert in Replit,
# so we proxy http://localhost:8889 → https://gateway.ai.cloudflare.com over Node.js
# which has a proper CA bundle. workerd connects via plain HTTP to localhost.
node -e "
const http = require('http');
const https = require('https');
const TARGET = 'gateway.ai.cloudflare.com';
const PORT = 8889;
http.createServer((req, res) => {
  const opts = {
    hostname: TARGET,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: TARGET },
  };
  const upstream = https.request(opts, (uRes) => {
    res.writeHead(uRes.statusCode, uRes.headers);
    uRes.pipe(res, { end: true });
  });
  upstream.on('error', (err) => {
    process.stderr.write('[ai-proxy] error: ' + err.message + '\n');
    res.writeHead(502);
    res.end('Bad Gateway');
  });
  req.pipe(upstream, { end: true });
}).listen(PORT, '127.0.0.1', () => {
  process.stderr.write('[ai-proxy] localhost:' + PORT + ' -> https://' + TARGET + '\n');
});
" &

# Export Cloudflare credentials to shell so the Vite plugin can use remoteBindings
# Values come from .dev.vars which holds production tokens
if [ -f .dev.vars ]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    value="${value%\"}"
    value="${value#\"}"
    export "$key=$value"
  done < .dev.vars
fi

export DEV_MODE=true
exec node_modules/.bin/vite --port 5000 --host 0.0.0.0
