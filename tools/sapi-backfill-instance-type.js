/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Backfill sapi_instances bucket after adding index type field
 */

var path = require('path');
var fs = require('fs');
var util = require('util');
var moray = require('moray');
var async = require('async');

var config_file = path.resolve(__dirname, '..', 'etc/config.json');
var bunyan = require('bunyan');

var SERVICES_BUCKET = 'sapi_services';
var INSTANCES_BUCKET = 'sapi_instances';

var services = {};

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
    verifyServicesBucket(onVerifyBucket);
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

function verifyServicesBucket(cb) {
    morayClient.getBucket(SERVICES_BUCKET, function (err, bucket) {
        if (err) {
            cb(err);
            return;
        }

        if (bucket.index.type === undefined) {
            cb(new Error('"type" index does not exist for the sapi_services ' +
                'bucket, cannot continue with this migration.'));
            return;
        }

        updateInstancesBucket(cb);
    });
}

function updateInstancesBucket(cb) {
    morayClient.getBucket(INSTANCES_BUCKET, function (err, bucket) {
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
                service_uuid: { type: 'string' },
                type: { type: "string" }
            }
        };
        morayClient.updateBucket(INSTANCES_BUCKET, cfg, cb);
    });
}

// We just need the services types. When type is undefined (newly migrated
// database) then we default to make all its instances type=vm
function loadServices(cb) {
    var req = morayClient.findObjects(SERVICES_BUCKET, '(uuid=*)');

    req.once('error', cb);

    req.on('record', function (object) {
        services[object.value.uuid] = object.value.type;
    });

    return req.once('end', function () {
        cb(null);
    });
}

function listInstances(cb) {
    var instances = [];
    var req = morayClient.findObjects(INSTANCES_BUCKET, '(uuid=*)');

    req.once('error', cb);

    req.on('record', function (object) {
        instances.push(object.value);
    });

    return req.once('end', function () {
        cb(null, instances);
    });
}

function updateInstances(instances, cb) {
    async.forEach(instances, updateInstance, cb);
}

function updateInstance(instance, cb) {
    var uuid = instance.uuid;

    if (instance.type === undefined) {
        instance.type = services[instance.service_uuid] || 'vm';
        morayClient.putObject(INSTANCES_BUCKET, uuid, instance, function (err) {
            if (err) {
                log.error(err, 'Could not update instance %s', uuid);
                cb(err);
                return;
            }

            log.info('Instance %s has ben updated', uuid);
            cb();
        });
    } else {
        log.info('Instance %s already has a type %s', uuid, instance.type);
        process.nextTick(cb);
    }
}

function onVerifyBucket(bucketErr) {
    if (bucketErr) {
        log.error(bucketErr, 'Could not update bucket');
        process.exit(1);
    }

    loadServices(function (loadErr) {
        if (loadErr) {
            log.error(loadErr, 'Could not load list of services');
            process.exit(1);
        }

        listInstances(function (err, instances) {
            if (err) {
                log.error(err, 'Could not list instances');
                process.exit(1);
            }

            updateInstances(instances, function (updateErr) {
                if (updateErr) {
                    log.error(updateErr, 'Could not update instances');
                    process.exit(1);
                }
                log.info('Instances have been updated');
                process.exit(0);
            });
        });
    });
}