/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Backfill sapi_services bucket after adding index type field
 */

var path = require('path');
var fs = require('fs');
var util = require('util');
var moray = require('moray');
var async = require('async');

var config_file = path.resolve(__dirname, '..', 'etc/config.json');
var bunyan = require('bunyan');

var SERVICES_BUCKET = 'sapi_services';

var config;
try {
    config = JSON.parse(fs.readFileSync(config_file, 'utf8'));
} catch (e) {
    console.error('Error parsing config file JSON:');
    console.dir(e);
    process.exit(1);
}

var log = new bunyan({
    name: 'sapi-backfill',
    streams: [ {
        level: config.logLevel || 'info',
        stream: process.stdout
    }]
});

var morayClient = moray.createClient({
    log: log,
    host: config.moray.host,
    port: config.moray.port,
    retry: (config.retry === false ? false : {
        retries: Infinity,
        minTimeout: 1000,
        maxTimeout: 60000
    })
});

function onConnect() {
    morayClient.removeListener('error', onError);
    log.info('moray: connected %s', morayClient.toString());
    updateBucket(onBucket);
}

function onConnectAttempt(number, delay) {
    var level;
    if (number === 0) {
        level = 'info';
    } else if (number < 5) {
        level = 'warn';
    } else {
        level = 'error';
    }

    log[level]({
        attempt: number,
        delay: delay
    }, 'moray: connection attempted');
}

function onError(err) {
    log.error(err, 'moray: connection failed');
}

morayClient.once('connect', onConnect);
morayClient.once('error', onError);
morayClient.on('connectAttempt', onConnectAttempt);



/*
 * Work is done here
 */

function updateBucket(cb) {
    morayClient.getBucket(SERVICES_BUCKET, function (err, bucket) {
        if (err) {
            cb(err);
            return;
        }

        if (bucket.index.type !== undefined) {
            log.info('"type" index is already added');
            cb();
            return;
        }

        var cfg = {
            index: {
                uuid: { type: 'string', unique: true },
                name: { type: 'string' },
                application_uuid: { type: 'string' },
                type: { type: "string" }
            }
        };
        morayClient.updateBucket(SERVICES_BUCKET, cfg, cb);
    });
}

function listServices(cb) {
    var services = [];
    var req = morayClient.findObjects(SERVICES_BUCKET, '(uuid=*)');

    req.once('error', cb);

    req.on('record', function (object) {
        services.push(object.value);
    });

    return req.once('end', function () {
        cb(null, services);
    });
}

function updateServices(services, cb) {
    async.forEach(services, updateService, cb);
}

function updateService(service, cb) {
    var uuid = service.uuid;

    if (service.type === undefined) {
        service.type = 'vm';
        morayClient.putObject(SERVICES_BUCKET, uuid, service, function (err) {
            if (err) {
                log.error(err, 'Could not update service %s', uuid);
                cb(err);
                return;
            }

            log.info('Service %s has ben updated', uuid);
            cb();
        });
    } else {
        log.info('Service %s already has a type %s', uuid, service.type);
        process.nextTick(cb);
    }
}

function onBucket(bucketErr) {
    if (bucketErr) {
        log.error(bucketErr, 'Could not update bucket');
        process.exit(1);
    }

    listServices(function (err, services) {
        if (err) {
            log.error(err, 'Could not list services');
            process.exit(1);
        }

        updateServices(services, function (updateErr) {
            if (updateErr) {
                log.error(updateErr, 'Could not update services');
                process.exit(1);
            }
            log.info('Services have been updated');
            process.exit(0);
        });
    });
}