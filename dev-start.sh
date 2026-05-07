#!/bin/bash
set -a
source <(grep -v '^#' .dev.vars | grep -v '^$' | sed 's/^[[:space:]]*//' | grep '=')
set +a

export DEV_MODE=true
exec node_modules/.bin/vite --port 5000 --host 0.0.0.0
