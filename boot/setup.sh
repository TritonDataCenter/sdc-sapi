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

# Include common utility functions, we run "sdc_common_" functions below.
source /opt/smartdc/boot/lib/util.sh


# ---- support functions

# Get a SAPI url with a few retries.
function sapi_get
{
    local url=$1
    local retry=3
    local curlOpts="-sS -H 'Accept:application/json' -H 'Accept-Version:~1'"

    while (( retry-- > 0 )); do
        if ! curl $curlOpts "$url"; then
            echo "could not get $url: retrying ..." >&2
            sleep 3
            continue
        fi
        break
    done

    return 0
}


# ---- mainline

SAPI_ROOT=/sapi
ZONE_UUID=$(zonename)
ZONE_DATASET=zones/$ZONE_UUID/data
PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin
role=sapi

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/sapi

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/sapi/build/node/bin" >>/root/.profile


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

# Add metadata for cmon-agent discovery
mdata-put metricPorts 8881


#
# The SAPI SMF service requires 'dns_domain' to configure itself. The intent
# is that `mdata-get sdc:dns_domain` is set (which TRITON-92 will provide).
# However it accepts `mdata-get dns_domain` as a fallback.
#
# Here is where we ensure that one of those exists for all known cases of
# old and new sdcadm, old and new SAPI images, proto and full mode.
#
DNS_DOMAIN=

_VM_DNS_DOMAIN=$(mdata-get sdc:dns_domain)
_METADATA_DNS_DOMAIN=$(mdata-get dns_domain)

if [[ -n "$_VM_DNS_DOMAIN" && "$_VM_DNS_DOMAIN" != "local" ]]; then
    echo "dns_domain: using value set on VM: $_VM_DNS_DOMAIN"
    DNS_DOMAIN=$_VM_DNS_DOMAIN

    # Remove the dns_domain in metadata to avoid potential confusion.
    if mdata-get dns_domain 2>/dev/null >/dev/null; then
        echo "dns_domain: remove value set on metadata"
        mdata-delete dns_domain
    fi
fi

if [[ -z "$DNS_DOMAIN" && -n "$_METADATA_DNS_DOMAIN" ]]; then
    echo "dns_domain: using value set on metadata: $_METADATA_DNS_DOMAIN"
    DNS_DOMAIN="$_METADATA_DNS_DOMAIN"
fi

# Try extracting from 'usbkey_config' metadata added for bootstrapping
# the "sdc" SAPI app.
if [[ -z "$DNS_DOMAIN" ]]; then
    _USBKEY_CONFIG=$(mdata-get usbkey_config)
    if [[ -n "$_USBKEY_CONFIG" ]]; then
        DNS_DOMAIN=$(echo "$_USBKEY_CONFIG" | grep '^dns_domain=' | cut -d'=' -f2)
        if [[ -n "$DNS_DOMAIN" ]]; then
            echo "dns_domain: using value from usbkey_config metadata: $DNS_DOMAIN"
            mdata-put dns_domain "$DNS_DOMAIN"
        else
            echo "warning: have 'usbkey_config' metadata but unexpectedly 'dns_domain' was not in it"
        fi
    fi
fi

# Before TOOLS-1896, 'sdcadm up sapi' would provision a 'sapi0tmp' instance
# to upgrade 'sapi0' to ensure there was always a running SAPI to use for
# setting up the SAPI zone. It explicitly passed the DNS name to that running
# SAPI via the 'sapi-url' metadata. Attempt that if our alias ends in "tmp"
# (per https://github.com/joyent/sdcadm/blob/09a6a8757/lib/procedures/update-single-hn-sapi-v1.js#L77)
if [[ -z "$DNS_DOMAIN" ]]; then
    _VM_ALIAS=$(mdata-get sdc:alias)
    _SAPI_URL=$(mdata-get sapi-url)
    if [[ "${_VM_ALIAS: -3}" == "tmp" && -n "$_SAPI_URL" ]]; then
        DNS_DOMAIN=$(sapi_get "$_SAPI_URL/applications?name=sdc" \
            | json 0.metadata.dns_domain)
        if [[ -n "$DNS_DOMAIN" ]]; then
            echo "dns_domain: using value from given sapi-url for sapiNtmp zone: $DNS_DOMAIN"
            mdata-put dns_domain "$DNS_DOMAIN"
        else
            echo "warning: looks like a sapiNtmp zone and have sapi-url, but could not get 'dns_domain' from $_SAPI_URL"
        fi
    fi
fi

if [[ -z "$DNS_DOMAIN" ]]; then
    fatal "could not determine 'dns_domain'"
fi


echo "Starting sapi SMF service."
/usr/sbin/svccfg import /opt/smartdc/sapi/smf/manifests/sapi.xml


#
# Now that the SAPI server is running (or should be soon), we can run
# 'sdc_common_setup', which calls SAPI.
#
# It uses 'sapi-url' in metadata for the SAPI to talk to, so we set that
# to *this* SAPI's admin ip to (a) ensure it finds it, it isn't yet in
# DNS; and (b) to not have dependencies between SAPI instances.
#
# (Note that sdc_common_setup behavior differs when SAPI is in proto mode for
# initial headnode setup.)
#
# TODO: make RANish
ADMIN_IP=$(mdata-get sdc:nics | json -a -c 'this.nic_tag === "admin"' | json ip)
mdata-put sapi-url http://$ADMIN_IP

CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/sapi
SAPI_PROTO_MODE=$(mdata-get SAPI_PROTO_MODE || true)

# We rely on the "download_metadata" function internally called here to perform
# retries on the SAPI server still starting up.
sdc_common_setup

echo "Adding log rotation"
sdc_log_rotation_add amon-agent /var/svc/log/*amon-agent*.log 1g
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add $role /var/svc/log/*$role*.log 1g
sdc_log_rotation_setup_end

# All done, run boilerplate end-of-setup
sdc_setup_complete


exit 0
# vim: set shiftwidth=4 tabstop=4 expandtab:
