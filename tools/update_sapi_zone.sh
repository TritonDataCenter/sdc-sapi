#!/bin/bash
#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
# update_sapi_zone.sh: This script updates the SAPI zone on a server.
#


set -o xtrace
set -o errexit

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <machine>"
    exit 1
fi

NODE=$1

# Allow callers to pass additional flags to ssh and scp
[[ -n ${SSH} ]] || SSH=ssh
[[ -n ${SCP} ]] || SCP=scp

UUID=$(${SSH} ${NODE} "vmadm lookup alias=~sapi0")

rsync -avz \
    build \
    lib \
    node_modules \
    sapi_manifests \
    server.js \
    smf \
    test \
    ${NODE}:/zones/${UUID}/root/opt/smartdc/sapi
