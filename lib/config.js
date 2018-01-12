/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * SAPI configuration library.
 *
 * Sapi configuration must not be dependent on config-agent synchronization
 * (since config-agent itself depends on SAPI). Therefore, this library loads
 * some of the configuration details from sapi VMs metadata values.
 * Information about sapi master is stored into a separate file when required
 * and loaded by this library.
 * Note that this library expects the existence of 'dns_domain' metadata
 * variable being set into sapi VM, either by the initial headnode setup
 * (see HEAD-2378 and HEAD-2387), or during VM initial setup, extracting
 * it from usbkey_config metadata value.
 */

var cp = require('child_process');
var fs = require('fs');
var net = require('net');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var bunyan = require('bunyan');
var vasync = require('vasync');

var NEEDED_SERVICES = [
    'cnapi',
    'imgapi',
    'moray',
    'napi',
    'papi',
    'vmapi'
];



function loadConfig(config, callback) {
    assert.object(config, 'config');
    assert.object(config.log, 'config.log');
    var log = config.log;

    var context = {
        cfg: {
            log: log
        }
    };
    vasync.pipeline({
        arg: context,
        funcs: [
            function getDnsDomain(ctx, next) {
                cp.exec('/usr/sbin/mdata-get sdc:dns_domain',
                    function cpCb(err, stdout) {
                        if (err && err.code === 1) {
                            next();
                            return;
                        }
                        if (err) {
                            next(err);
                            return;
                        }
                        var dnsDomain = stdout.trim();
                        if (dnsDomain !== 'local') {
                            ctx.dnsDomain = dnsDomain;
                        }
                        next();
                    });
            },
            function getDnsDomainFallback(ctx, next) {
                if (ctx.dnsDomain) {
                    next();
                    return;
                }
                cp.exec('/usr/sbin/mdata-get dns_domain',
                    function cpCb(err, stdout) {
                        if (err && err.code === 1) {
                            next();
                            return;
                        }
                        if (err) {
                            next(err);
                            return;
                        }
                        ctx.dnsDomain = stdout.trim();
                        next();
                    });

            },
            // If SAPI_PROTO_MODE is set, it means we're on
            // first boot, and we need to rely into IPs instead
            // of domain names
            function getMdataSapiMode(ctx, next) {
                cp.exec('/usr/sbin/mdata-get SAPI_PROTO_MODE',
                    function cpCb(err, stdout) {
                        // No metadata found:
                        if (err && err.code === 1) {
                            ctx.protoMode = false;
                            next();
                            return;
                        }
                        if (err) {
                            next(err);
                            return;
                        }

                        if (stdout.trim() !== 'true') {
                            next(new Error(util.format(
                                'Unexpected value for SAPI proto_mode: %s',
                                stdout.trim())));
                            return;
                        }
                        ctx.protoMode = (stdout.trim() === 'true');
                        next();
                    });
            },
            // If usbkey_config exists, we're at the initial bootstrap
            // and on this case we need to grab IP addresses
            // to configure our services, instead of using domain names.
            function getUsbkeyConfig(ctx, next) {
                if (!ctx.protoMode) {
                    next();
                    return;
                }
                cp.exec('/usr/sbin/mdata-get usbkey_config',
                    function cpCb(err, stdout) {
                        if (err && err.code === 1) {
                            next();
                            return;
                        }
                        if (err) {
                            next(err);
                            return;
                        }
                        NEEDED_SERVICES.forEach(function (k) {
                            var re = new RegExp(
                                '^' + k + '_admin_ips=(.+)', 'm');
                            var res = stdout.match(re);
                            if (res !== null && res.length && res[1]) {
                                var ips = res[1].split(',');
                                if (ips.length && net.isIP(ips[0])) {
                                    ctx[k] = ips[0];
                                }
                            }
                        });
                        next();
                    });

            },
            function getDcName(ctx, next) {
                cp.exec('/usr/sbin/mdata-get sdc:datacenter_name',
                    function cpCb(err, stdout, _) {
                        if (err) {
                            next(err);
                            return;
                        }
                        ctx.datacenterName = stdout.trim();
                        if (!ctx.datacenterName) {
                            next(new Error('Missing required ' +
                                '"datacenter_name" metadata value'));
                            return;
                        }
                        next();
                    });
            },
            function populateConfig(ctx, next) {
                ctx.cfg.datacenter_name = ctx.datacenterName;

                if (ctx.dnsDomain) {
                    NEEDED_SERVICES.forEach(function (c) {
                        if (c === 'moray') {
                            ctx.cfg.moray = {
                                srvDomain: util.format('%s.%s.%s', c,
                                    ctx.datacenterName, ctx.dnsDomain),
                                cueballOptions: {
                                    resolvers: [util.format('binder.%s.%s',
                                    ctx.datacenterName, ctx.dnsDomain)]
                                }
                            };
                        } else {
                            ctx.cfg[c] = {
                                url: util.format('http://%s.%s.%s', c,
                                    ctx.datacenterName, ctx.dnsDomain)
                            };
                        }
                    });
                } else if (ctx.protoMode) {
                    var missingIps = [];
                    NEEDED_SERVICES.forEach(function (c) {
                        if (!ctx[c]) {
                            missingIps.push(c);
                        } else {
                            if (c === 'moray') {
                                ctx.cfg.moray = {
                                    host: ctx[c],
                                    port: 2020
                                };
                            } else {
                                ctx.cfg[c] = {
                                    url: 'http://' + ctx[c]
                                };
                            }
                        }
                    });

                    if (missingIps.length) {
                        next(new Error(util.format(
                            'Missing required admin IPs for the services: "%s"',
                            missingIps.join('","'))));
                        return;
                    }
                } else {
                    next(new Error(
                        'Missing required "dns_domain" metadata value'));
                    return;
                }

                next();
            },
            function loadMasterCfg(ctx, next) {
                // Try to load sapi-master.config.json if exists:
                var masterCfg = path.resolve(__dirname,
                            '../etc/sapi-master.config.json');
                log.debug('Trying to read file: ' + masterCfg);
                fs.readFile(masterCfg, {
                    encoding: 'utf8'
                }, function readFileCb(err, data) {
                    if (err && err.code !== 'ENOENT') {
                        next(err);
                        return;
                    }
                    if (!err) {
                        var mConfig;
                        try {
                            mConfig = JSON.parse(data);
                            if (mConfig.moray &&
                                mConfig.moray.master_host &&
                                mConfig.moray.master_port) {
                                ctx.cfg.moray.master_host =
                                    mConfig.moray.master_host;
                                ctx.cfg.moray.master_port =
                                    mConfig.moray.master_port;
                            } else {
                                ctx.cfg.moray.master_host = null;
                            }
                        } catch (e) {
                            next(e);
                            return;
                        }
                    }
                    next();
                });
            }
        ]
    }, function pipeCb(pipeErr) {
        if (pipeErr) {
            log.error({err: pipeErr}, 'loadConfig error');
            callback(pipeErr);
            return;
        }

        // If we're in proto mode, we want log level set to debug:
        if (context.protoMode) {
            log.level(bunyan.DEBUG);
        }


        callback(null, context.cfg);
    });
}

module.exports = {
    loadConfig: loadConfig
};
