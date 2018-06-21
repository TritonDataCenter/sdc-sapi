#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * SAPI config loading.
 *
 * SAPI must be able to come online without depending on config-agent to
 * create its config file, because that creates a circular dependency which
 * breaks (re)-creating a lone SAPI instance in the datacenter.
 *
 * The solution is to have a rule that all config required for base SAPI
 * server functionality can be gathered from VM metadata (i.e. from
 * `mdata-get`). Config data for any "non-base" functionality *may* use
 * config-agent, but SAPI server startup does not depend on it existing.
 *
 * Note: Getting `dns_domain` is the most complex. The intent is that SAPI
 * VMs have `<vm>.dns_domain` set such that `mdata-get sdc:dns_domain` is
 * available (per https://eng.joyent.com/mdata/datadict.html). However,
 * initially this was not the case (see TRITON-92). For some releases,
 * `<vm>.customer_metadata.dns_domain` was set (HEAD-2387, HEAD-2378).
 * As a last resort for earlier setups, the `dns_domain` can be pulled out
 * of the `usbkey_config` metadatum that is added to the sapi0 instance
 * on headnode setup to bootstrap the "sdc" application metadata. This module
 * expects zone setup (boot/setup.sh) to handle this "last resort" and write
 * that value to `<vm>.customer_metadata.dns_domain`.
 *
 * Module usage:
 *      var mod_config = require('./config');
 *      mod_config.loadConfig({log: log}, function (err, config) {
 *          // ...
 *      });
 *
 * CLI usage:
 *      $ node lib/config.js
 *      ... emits the config ...
 *      $ node lib/config.js KEY
 *      ... emits the value of KEY (in json-y form, i.e. quotes removed from a
 *      string) ...
 */

var cp = require('child_process');
var fs = require('fs');
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


/*
 * lookup the property "str" (given in dot-notation) in the object "obj".
 * "c" is optional and may be set to any delimiter (defaults to dot: ".")
 *
 * Note: lifted from node-tabula.
 */
function dottedLookup(obj, str, c) {
    if (c === undefined)
        c = '.';
    var o = obj;
    var dots = str.split(c);
    var s = [];
    for (var i = 0; i < dots.length; i++) {
        var dot = dots[i];
        s.push(dot);
        if (!o.hasOwnProperty(dot))
            throw new Error('no property ' + s.join(c) + ' found');
        o = o[dot];
    }
    return o;
}

function loadConfig(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    var log = opts.log;

    var context = {
        cfg: {
            log: log
        }
    };
    vasync.pipeline({
        arg: context,
        funcs: [
            function getVmDnsDomain(ctx, next) {
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
            function getMetadataDnsDomain(ctx, next) {
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
            function getInstanceUuid(ctx, next) {
                cp.exec('zonename',
                    function cpCb(err, stdout, _) {
                        if (err) {
                            next(err);
                            return;
                        }
                        ctx.instanceUuid = stdout.trim();
                        if (!ctx.instanceUuid) {
                            next(new Error('Missing required ' +
                                '"sdc:zonename" metadata value'));
                            return;
                        }
                        next();
                    });
            },
            function getServerUuid(ctx, next) {
                cp.exec('/usr/sbin/mdata-get sdc:server_uuid',
                    function cpCb(err, stdout, _) {
                        if (err) {
                            next(err);
                            return;
                        }
                        ctx.serverUuid = stdout.trim();
                        if (!ctx.serverUuid) {
                            next(new Error('Missing required ' +
                                '"server_uuid" metadata value'));
                            return;
                        }
                        next();
                    });
            },
            function getAdminIp(ctx, next) {
                var cmd = '/usr/sbin/mdata-get sdc:nics';
                cp.exec(cmd, function cpCb(err, stdout, _) {
                    if (err) {
                        next(err);
                        return;
                    }

                    var nics = JSON.parse(stdout.trim());
                    ctx.adminIp = nics.filter(function (nic) {
                        return (nic.nic_tag === 'admin');
                    })[0].ip;

                    if (!ctx.adminIp) {
                        next(new Error('Missing required ' +
                            '"adminIp" metadata value'));
                        return;
                    }
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
                ctx.cfg.instanceUuid = ctx.instanceUuid;
                ctx.cfg.serverUuid = ctx.serverUuid;
                ctx.cfg.adminIp = ctx.adminIp;

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
                } else {
                    next(new Error(
                        'Missing required "dns_domain" metadata value'));
                    return;
                }

                next();
            },

            // Load additional config from config-agent, *if available*. This
            // is non-fatal.
            function loadMasterCfg(ctx, next) {
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


// ---- mainline

function main(argv) {
    assert.arrayOfString(argv, 'argv');

    var key = null;
    if (argv.length === 3) {
        key = argv[2];
    } else if (argv.length > 3) {
        console.error('lib/config.js: error: too many args: %s',
            argv.slice(2).join(' '));
        process.exit(1);
    }

    var log = bunyan.createLogger({
        name: 'sapi-config',
        level: 'warn'
    });

    loadConfig({log: log}, function (err, config) {
        if (err) {
            console.error('lib/config.js: error: %s', err.stack);
            process.exit(1);
        }

        delete config.log;

        if (key) {
            var val = dottedLookup(config, key);
            if (typeof (val) === 'string') {
                console.log(val);
            } else {
                console.log(JSON.stringify(val, null, 4));
            }
        } else {
            console.log(JSON.stringify(config, null, 4));
        }
    });
}

if (require.main === module) {
    main(process.argv);
}


// ---- exports

module.exports = {
    loadConfig: loadConfig
};
