#!/bin/bash
# Runs as root, before the server starts. Two jobs, both of which the RM
# deployment needs and neither of which the app can do for itself.
set -e

# 1. Point the deployment's own hostnames at the docker gateway. Product APIs are
#    addressed as mtls.<product>.<domain>, and inside this container that name
#    either does not resolve or resolves to 127.0.0.1, which is us. miniwerk
#    writes the script listing every FQDN in the deployment; rmapi does the same.
test -x /pvarki/hosts_script.sh && . /pvarki/hosts_script.sh

# 2. Get ourselves an RM-issued client certificate. It is what authenticates us
#    to the TAK CoT stream and to sibling products' interop endpoints. Guarded on
#    the cert rather than a marker file, so a wiped volume re-enrols itself.
mkdir -p /data/persistent
if [ -f /data/persistent/public/mtlsclient.pem ]; then
  echo "container-init: client certificate exists, skipping enrolment"
elif [ -f /pvarki/kraftwerk-init.json ]; then
  /kw_product_init init /pvarki/kraftwerk-init.json
else
  echo "container-init: no /pvarki/kraftwerk-init.json, skipping enrolment (TAK and Matrix ingest will stay off)"
fi

# The server runs unprivileged, so it has to own what it writes.
chown -R node:node /data/persistent /usr/src/app/server/uploads
