#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# Copyright (c) 2013 Joyent Inc., All rights reserved.
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
sdc_common_setup

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

if [[ "${SAPI_PROTO_MODE}" == "true" ]]; then
    # During setup/bootstrapping, we do not expect binder to be available, and
    # rely on the pre-allocated IPs. We grab all the config from the
    # usbkey_config key in metadata which is assumed to have a copy of
    # /usbkey/config for us.

    /usr/sbin/mdata-get usbkey_config > /var/tmp/usbkey.config
    if [[ $? -ne 0 ]]; then
        echo "error: Unable to find usbkey/config in SAPI zone." >&2
        exit 1
    fi

    eval $(
    . /var/tmp/usbkey.config
    cat <<EOF
DATACENTER_NAME=${datacenter_name}
IMGAPI_ADMIN_IPS=${imgapi_admin_ips}
MORAY_ADMIN_IPS=${moray_admin_ips}
NAPI_ADMIN_IPS=${napi_admin_ips}
VMAPI_ADMIN_IPS=${vmapi_admin_ips}
CNAPI_ADMIN_IPS=${cnapi_admin_ips}
EOF
    )

    IMGAPI_URL=http://$(echo "${IMGAPI_ADMIN_IPS}" | cut -d',' -f1)
    MORAY_HOST=$(echo "${MORAY_ADMIN_IPS}" | cut -d ',' -f1)
    NAPI_URL=http://$(echo "${NAPI_ADMIN_IPS}" | cut -d',' -f1)
    CNAPI_URL=http://$(echo "${CNAPI_ADMIN_IPS}" | cut -d',' -f1)
    VMAPI_URL=http://$(echo "${VMAPI_ADMIN_IPS}" | cut -d',' -f1)

    # This config file is used during setup to bootstrap SAPI. With the
    # exception that it requires IP addresses instead of DNS names (as binder is
    # not expected to be setup yet), it should be kept broadly in sync with the
    # template at:
    #   sapi.git/sapi_manifests/sapi/template
    mkdir -p /opt/smartdc/sapi/etc
    cat > /opt/smartdc/sapi/etc/config.json <<HERE
{
  "log_options": {
    "name": "sapi",
    "level": "debug"
  },
  "datacenter_name": "$DATACENTER_NAME",
  "moray": {
    "host": "$MORAY_HOST",
    "port": 2020
  },
  "cnapi": {
    "url": "$CNAPI_URL"
  },
  "vmapi": {
    "url": "$VMAPI_URL"
  },
  "napi": {
    "url": "$NAPI_URL"
  },
  "imgapi": {
    "url": "$IMGAPI_URL"
  }
}
HERE

fi

echo "Adding log rotation"
sdc_log_rotation_add amon-agent /var/svc/log/*amon-agent*.log 1g
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add $role /var/svc/log/*$role*.log 1g
sdc_log_rotation_setup_end

# All done, run boilerplate end-of-setup
sdc_setup_complete


exit 0
