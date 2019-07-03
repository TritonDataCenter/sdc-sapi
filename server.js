/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * server.js: Main entry point for the Services API
 */


var bunyan = require('bunyan');
var tritonTracer = require('triton-tracer');

var SAPI = require('./lib/server/sapi');
var mod_config = require('./lib/config');

var log = bunyan.createLogger({
    name: 'sapi',
    level: 'info',
    serializers: bunyan.stdSerializers
});

tritonTracer.init({log: log});

mod_config.loadConfig({ log: log }, function (configErr, config) {

    if (configErr) {
        log.fatal({err: configErr}, 'Load config error');
        process.exit(1);
    }

    log.info({ config: config }, 'loadConfig');

    var sapi = new SAPI(config);

    sapi.start(function initCb(err) {
        if (err) {
            log.fatal(err, 'failure to start SAPI');
            process.exit(1);
        }
    });
});
