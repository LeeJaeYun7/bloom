#!/bin/zsh
cd "${0:A:h}"
(sleep 1; open http://localhost:${PORT:-4174}) &
node --env-file-if-exists=.env server.mjs
