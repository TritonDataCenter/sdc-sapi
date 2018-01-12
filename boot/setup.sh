#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2018, Joyent, Inc.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

SAPI_ROOT=/sapi
ZONE_UUID=$(zonename)
ZONE_DATASET=zones/$ZONE_UUID/data
PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin
role=sapi

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/sapi

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/sapi/build/node/bin:/opt/smartdc/sapi/node_modules/.bin" >>/root/.profile

# Include common utility functions (then run the boilerplate).
source /opt/smartdc/boot/lib/util.sh
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/sapi
SAPI_PROTO_MODE=$(mdata-get SAPI_PROTO_MODE || true)

# If there's a zfs dataset, make the mount point /sapi
zfs list $ZONE_DATASET && rc=$? || rc=$?
if [[ $rc == 0 ]]; then
    mkdir -p $SAPI_ROOT

    mountpoint=$(zfs get -H -o value mountpoint $ZONE_DATASET)
    if [[ $mountpoint != $SAPI_ROOT ]]; then
        zfs set mountpoint=$SAPI_ROOT $ZONE_DATASET || \
            fatal "failed to set mountpoint"
    fi
fi

# We need to set the current sapi instance's admin IP as the url for the SAPI
# service because we don't want to have dependencies between SAPI instances.
# This way, can always create a new functional SAPI instance, even if there
# aren't any more instances functional at that moment.

# Ensure we always have the current VM admin ip as sapi-url:
ADMIN_IP=$(mdata-get sdc:nics | json -a -c 'this.nic_tag === "admin"' | json ip)
mdata-put sapi-url http://$ADMIN_IP

# Since 'dns_domain' usage from sapi's config library has been introduced by
# SAPI-294, we need to make sure that, for instances running on systems created
# before such change, we'll properly populate 'dns_domain' metadata variable.
# Given that variable is used by the SAPI service, this variable must be set
# before we import the manifest.

# Set dns_domain if already not set:
DNS_DOMAIN=$(mdata-get sdc:dns_domain)
if [[ -z "${DNS_DOMAIN}"  || "${DNS_DOMAIN}" == "local" ]]; then
    DNS_DOMAIN=$(mdata-get dns_domain)
    USBKEY_CONFIG=$(mdata-get usbkey_config)
    if [[ -z "${DNS_DOMAIN}" && ! -z "${USBKEY_CONFIG}" ]]; then
        DNS_DOMAIN=$(mdata-get usbkey_config | grep '^dns_domain' | tr '=' '\n' | tail -n 1)
        if [[ -z "${DNS_DOMAIN}" ]]; then
            echo "error: Unable to determine 'dns_domain' from VM metadata." >&2
            exit 1
        else
            mdata-put dns_domain $DNS_DOMAIN
        fi
    fi
fi
echo "Updating SMF manifest"
$(/opt/local/bin/gsed -i"" -e "s/@@PREFIX@@/\/opt\/smartdc\/sapi/g" /opt/smartdc/sapi/smf/manifests/sapi.xml)

# As soon as we import the manifest, SAPI service will be available for this
# instance, and all the 'sdc_common_setup' requests to 'http://$ADMIN_IP' will
# have a reply.
echo "Importing sapi.xml"
/usr/sbin/svccfg import /opt/smartdc/sapi/smf/manifests/sapi.xml

# Wait until we have SAPI manifest imported before we attempt to setup
# registrar and config-agent. In case the SAPI service takes some time to
# be up and running, we rely into 'download_metadata' ability to perform
# retries in order to have a successful setup.
sdc_common_setup

echo "Adding log rotation"
sdc_log_rotation_add amon-agent /var/svc/log/*amon-agent*.log 1g
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add $role /var/svc/log/*$role*.log 1g
sdc_log_rotation_setup_end


# If we aren't in proto mode, we can update setups previous to SAPI-294 and add
# 'dns_domain' metadata variable to SAPI service now, taking advantage of
# 'pass_vmapi_metadata_keys' SAPI functionality. (Note we do several attempts
# here b/c the config-agent will restart the SAPI service if the configuration
# file changes):
if [[ ! ${SAPI_PROTO_MODE} ]]; then
    i=0
    while (( i++ < 30 )); do
        CURL_OPTS='-4 --connect-timeout 45 -sSf -i -H accept:application/json -H content-type:application/json'
        SAPI_SVC=$(/usr/bin/curl ${CURL_OPTS} "http://${ADMIN_IP}/services?name=sapi"|json -H 0)
        if [[ -z "${SAPI_SVC}" ]]; then
            echo "error: Unable to find SAPI service (retrying)." >&2
            sleep 2
            continue
        fi

        SAPI_SVC_UUID=$(echo ${SAPI_SVC}|json uuid)
        SAPI_SVC_DNS_DOMAIN=$(echo ${SAPI_SVC}|json params.dns_domain)
        if [[ -z "${SAPI_SVC_DNS_DOMAIN}" ]]; then
            echo "Updating sapi service params"
            UPDATE_SVC=$(/usr/bin/curl ${CURL_OPTS} "http://${ADMIN_IP}/services/${SAPI_SVC_UUID}" -X PUT -d "{
                \"action\": \"update\",
                \"params\": {
                    \"dns_domain\": \"${DNS_DOMAIN}\"
                }
            }"|json -H)
            if [[ -z "${UPDATE_SVC}" ]]; then
                echo "error: Unable to update SAPI service (retrying)." >&2
                sleep 2
                continue
            fi
            break;
        else
            break;
        fi
    done

    if [[ -z "${SAPI_SVC_DNS_DOMAIN}" && -z "${UPDATE_SVC}" ]]; then
        echo "error: Unable to update SAPI service after 30 attempts." >&2
        exit 1
    fi
fi

# All done, run boilerplate end-of-setup
sdc_setup_complete


exit 0
# vim: set shiftwidth=4 tabstop=4 expandtab:
