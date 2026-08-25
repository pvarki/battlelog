#!/bin/bash
# shellcheck disable=SC1091
. /container-init.sh

set -e
# Init needed root; the server does not. setpriv rather than su/gosu: it is in
# util-linux, so there is nothing to install. HOME has to come along or pnpm
# looks for its config under root's home and cannot read it.
DROP=(setpriv --reuid=node --regid=node --init-groups env HOME=/home/node)
if [ "$#" -eq 0 ]; then
  exec "${DROP[@]}" pnpm run start
else
  exec "${DROP[@]}" "$@"
fi
