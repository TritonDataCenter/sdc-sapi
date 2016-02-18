#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2016, Joyent, Inc.
#

# Remove resources created when running SAPI's tests suites in a running SDC.
#
# Run `./cleanup-test-resources -h` for usage info.

TOP=$(cd $(dirname $0)/../; pwd)
. ${TOP}/tools/common.sh

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail

function usage
{
    echo "Usage:"
    echo "  ./cleanup-test-resources coal    # from a developer's machine"
    echo ""
    echo "Options:"
    echo "  -h          Print this help and exit."
}

NODE=root@$1

while getopts "h" opt
do
    case "$opt" in
        h)
            usage
            exit 0
            ;;
        *)
            usage
            exit 1
            ;;
    esac
done

ssh -t ${NODE} <<\EOF
echo "Cleaning up test resources..."
export PATH=/opt/smartdc/bin/:${PATH}
sdc-login -l sapi /opt/smartdc/sapi/build/node/bin/node /opt/smartdc/sapi/tools/cleanup-test-resources.js
EOF
