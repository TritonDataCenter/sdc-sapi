#!/usr/bin/bash
#
# Copyright (c) 2013 Joyent Inc., All rights reserved.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/sdc-boot/lib/util.sh
sdc_common_setup

role=${zone_role}
app_name=$role

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/sapi

# Install SAPI
mkdir -p /opt/smartdc/sapi
chown -R nobody:nobody /opt/smartdc/sapi

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/sapi/build/node/bin:/opt/smartdc/sapi/node_modules/.bin" >>/root/.profile

# bootstrap the config file once only.

# During setup/bootstrapping, we do not expect binder to be available, and
# reply on the pre-allocated IPs.  We grab all the config from the usbkey_config
# key in metadata which is assumed to have a copy of /usbkey/config for us.

/usr/sbin/mdata-get usbkey_config > /var/tmp/usbkey.config
if [[ $? -ne 0 ]]; then
    echo "Unable to find usbkey/config in SAPI zone." >&2
    exit 1
fi

eval $(
. /var/tmp/usbkey.config
cat <<EOF
DATACENTER_NAME=${datacenter_name}
IMGAPI_ADMIN_IPS=${imgapi_admin_ips}
MORAY_ADMIN_IPS=${moray_admin_ips}
NAPI_ADMIN_IPS=${napi_admin_ips}
UFDS_ADMIN_IPS=${ufds_admin_ips}
VMAPI_ADMIN_IPS=${vmapi_admin_ips}
CNAPI_ADMIN_IPS=${cnapi_admin_ips}
WORKFLOW_ADMIN_IPS=${workflow_admin_ips}
UFDS_ADMIN_UUID=${ufds_admin_uuid}
UFDS_LDAP_ROOT_DN=${ufds_ldap_root_dn}
UFDS_LDAP_ROOT_PW=${ufds_ldap_root_pw}
WFAPI_HTTP_ADMIN_USER=${workflow_http_admin_user}
WFAPI_HTTP_ADMIN_PW=${workflow_http_admin_pw}
EOF
)

IMGAPI_URL=http://$(echo "${IMGAPI_ADMIN_IPS}" | cut -d',' -f1)
MORAY_HOST=$(echo "${MORAY_ADMIN_IPS}" | cut -d ',' -f1)
NAPI_URL=http://$(echo "${NAPI_ADMIN_IPS}" | cut -d',' -f1)
UFDS_URL=ldaps://$(echo "${UFDS_ADMIN_IPS}" | cut -d ',' -f1)
CNAPI_URL=http://$(echo "${CNAPI_ADMIN_IPS}" | cut -d',' -f1)
VMAPI_URL=http://$(echo "${VMAPI_ADMIN_IPS}" | cut -d',' -f1)
WFAPI_URL=http://$(echo "${WORKFLOW_ADMIN_IPS}" | cut -d',' -f1)

echo "Creating SAPI config file"
mkdir -p /opt/smartdc/sapi/etc

# This config file is used during setup to bootstrap SAPI. With the exception
# that it requires IP addresses instead of DNS names (as binder is not expected
# to be setup yet), it should be kept broadly in sync with the template at:
# $USB_HEADNODE_ROOT/config/sapi/manifests/services/sapi/sapi/template
cat > /opt/smartdc/sapi/etc/config.json <<HERE
{
  "log_options": {
    "name": "sapi",
    "level": "debug"
  },
  "mode": "proto",
  "datacenter_name": "$DATACENTER_NAME",
  "adminUuid": "$UFDS_ADMIN_UUID",
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
  },
  "remote_imgapi": {
    "url": "https://updates.joyent.com"
  },
  "ufds": {
    "url": "$UFDS_URL",
    "bindDN": "$UFDS_LDAP_ROOT_DN",
    "bindPassword": "$UFDS_LDAP_ROOT_PW",
    "cache": {
      "size": 1000,
      "expiry": 300
    }
  }
}
HERE

echo "Adding log rotation"
logadm -w sapi -C 48 -s 100m -p 1h \
    /var/svc/log/smartdc-site-sapi:default.log

# All done, run boilerplate end-of-setup
sdc_setup_complete


exit 0
