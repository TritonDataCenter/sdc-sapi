/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/server/stor/moray.js: moray interface
 */

var mod_net = require('net');

var async = require('async');
var assert = require('assert-plus');
var jsprim = require('jsprim');
var ldapjs = require('ldapjs');
var LRU = require('lru-cache');
var moray = require('moray');
var once = require('once');
var vasync = require('vasync');
var verror = require('verror');

var mod_errors = require('../errors');

var sprintf = require('util').format;


module.exports = MorayStorage;

function MorayStorage(config) {
    assert.object(config, 'config');
    assert.object(config.moray, 'config.moray');
    assert.object(config.log, 'config.log');
    assert.object(config.buckets, 'config.buckets');

    this.config = config.moray;
    this.log = config.log;
    this.buckets = config.buckets;
}

MorayStorage.prototype.init = function init(cb) {
    var self = this;
    var log = this.log;
    var config = this.config;

    assert.func(cb, 'callback');

    var HEARTBEAT;
    var INTERVAL;
    var TIMER;

    cb = once(cb);

    // Set a hard timeout for init so that sapi can still start up if
    // moray is down.
    setTimeout(function initTimeout() {
        if (!cb.called) {
            log.error('MorayStorage init timeout.');
            cb();
            return;
        }
    }, 10000);

    var init_barrier = vasync.barrier();
    init_barrier.start('sync');
    init_barrier.on('drain', function () {
        log.info('all moray connections ready');
        cb();
    });

    var localMorayCfg;

    if (config.srvDomain) {
        localMorayCfg = {
            srvDomain: config.srvDomain,
            log: log
        };

        if (config.cueballOptions) {
            localMorayCfg.cueballOptions = config.cueballOptions;
        }
    } else {
        config.port = config.port ? parseInt(config.port, 10) : 2020;
        localMorayCfg = {
            port: config.port,
            host: config.host,
            log: log
        };
    }

    this.local = moray.createClient(localMorayCfg);

    init_barrier.start('local_moray');

    /*
     * If specified, create a second connect to the master moray instance.
     */
    if (config.master_host && config.master_port) {

        config.master_port = parseInt(config.master_port, 10);

        if (mod_net.isIP(config.master_host)) {
           this.master = moray.createClient({
                connectTimeout: config.connectTimeout,
                log: log,
                host: config.master_host,
                port: config.master_port
            });
        } else {
           this.master = moray.createClient({
                connectTimeout: config.connectTimeout,
                log: log,
                srvDomain: config.master_host,
                cueballOptions: {
                    defaultPort: config.master_port
                }
            });
        }

        log.info('initializing master moray client');

        init_barrier.start('master_moray');
    }

    if (this.object_caches) {
        Object.keys(this.object_caches).forEach(function (key) {
            if (this.object_caches && this.object_caches[key]) {
                this.object_caches[key].reset();
            }
        });
    }

    function setup(tag, client) {
        log.info({ tag: tag, client: client.toString() },
            'moray: setting up');

        initBuckets.call(self, client, function (err) {
            if (err) {
                cb(err);
                return;
            }

            log.info({ tag: tag, client: client.toString() },
                'moray: all buckets created');
            init_barrier.done(tag);
            cb();
        });
    }

    function onConnect(tag, client) {
        log.info({ tag: tag, client: client.toString() },
            'moray: connected');

        client.on('close', function () {
            log.error('moray: closed: stopping heartbeats');
            clearInterval(TIMER);
        });

        client.on('connect', function () {
            log.info('moray: connect: starting heartbeats');
            TIMER = setInterval(HEARTBEAT, INTERVAL);
        });

        client.on('error', function (err) {
            log.warn(err, 'moray: error (reconnecting)');
        });

        setup(tag, client);
    }

    this.local.once('connect',
        onConnect.bind(this, 'local_moray', this.local));

    if (this.master) {
        this.master.once('connect',
            onConnect.bind(this, 'master_moray', this.master));
    }

    init_barrier.done('sync');
};


// -- Bucket operations

function initBuckets(client, cb) {
    var self = this;
    var buckets = self.buckets;

    assert.object(client, 'client');
    assert.func(cb, 'cb');

    var basecfg = {
        index: {
            uuid: {
                type: 'string',
                unique: true
            }
        }
    };

    async.waterfall([
        function (subcb) {
            var cfg = jsprim.deepCopy(basecfg);
            cfg.index.started = {
                type: 'number'
            };
            cfg.index.finished = {
                type: 'number'
            };

            createBucket.call(self, client,
                buckets.history, cfg, subcb);
        },
        function (subcb) {
            var cfg = jsprim.deepCopy(basecfg);
            cfg.index.name = {
                type: 'string'
            };
            cfg.index.owner_uuid = {
                type: 'string'
            };

            createBucket.call(self, client,
                buckets.applications, basecfg, subcb);
        },
        function (subcb) {
            var cfg = jsprim.deepCopy(basecfg);
            cfg.index.name = {
                type: 'string'
            };
            cfg.index.application_uuid = {
                type: 'string'
            };
            cfg.index.type = {
                type: 'string'
            };

            createBucket.call(self, client,
                buckets.services, cfg, subcb);
        },
        function (subcb) {
            var cfg = jsprim.deepCopy(basecfg);
            cfg.index.service_uuid = {
                type: 'string'
            };
            cfg.index.type = {
                type: 'string'
            };

            createBucket.call(self, client,
                buckets.instances, cfg, subcb);
        },
        function (subcb) {
            createBucket.call(self, client,
                buckets.manifests, basecfg, subcb);
        }
    ], function (err) {
        if (err) {
            self.log.error({
                err: err
            }, 'Error creating buckets.  Next try in 5 seconds.');
            return (setTimeout(initBuckets.bind(self, client, cb),
                    5000));
        }
        return (cb());
    });
}

function createBucket(client, name, cfg, cb) {
    var self = this;
    var log = self.log;

    assert.object(client, 'client');
    assert.string(name, 'name');
    assert.object(cfg, 'cfg');
    assert.func(cb, 'cb');

    client.getBucket(name, function (err) {
        if (!err) {
            log.info({ client: client.toString() },
                'moray: bucket %s already exists', name);
            cb(null);
            return;
        }

        if (err && !verror.hasCauseWithName(err, 'BucketNotFoundError')) {
            log.error(err, 'failed to get bucket %s', name);
            cb(err);
            return;
        }

        client.createBucket(name, cfg, function (suberr) {
            if (suberr) {
                log.error(suberr,
                    'failed to create bucket %s', name);
                cb(new Error('failed to create bucket'));
                return;
            }

            log.info({ client: client.toString() },
                'moray: create bucket %s', name);

            if (!self.object_caches)
                self.object_caches = {};

            self.object_caches[name] = LRU({
                max: 1000,
                maxAge: 15 * 1000,  /* 15 seconds */
                length: function () { return (1); }
            });

            cb();
        });
    });
}


// -- Object operations

MorayStorage.prototype.putObject = putObject;

function putObject(bucket, uuid, obj, opts, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.object(obj, 'obj');

    cb = once(cb);

    if (arguments.length === 4) {
        cb = opts;
        opts = {};
    }

    log.debug('putting object %s into bucket %s', uuid, bucket);

    var client = this.local;

    /*
     * If a connection to the master moray instance exists and the object
     * contiains .master = true, then put that object into the master moray
     * instance.
     */
    if (obj.master && this.master) {
        log.debug('using master client to put %s', uuid);
        client = this.master;
    }

    client.putObject(bucket, uuid, obj, opts, function (err, res) {
        if (err) {
            log.error(err, 'failed to put object %s', uuid);
            cb(err);
        }

        var record = {};
        record.value = obj;
        record.etag = res.etag;

        if (self.object_caches && self.object_caches[bucket]) {
            log.debug('adding object %s to cache', uuid);
            self.object_caches[bucket].set(uuid, record);
        }

        cb(null);
    });
}

MorayStorage.prototype.getObject = function getObject(bucket, uuid, cb) {
    var log = this.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.func(cb, 'cb');

    if (this.object_caches && this.object_caches[bucket]) {
        var obj = this.object_caches[bucket].peek(uuid);
        if (obj) {
            log.debug('serving object %s from cache', uuid);
            return (cb(null, obj));
        }
    }

    var filter = sprintf('(uuid=%s)', uuid);

    /*
     * A object should never exist in both the local and master moray
     * instances, so it's safe to search both here when looking for a
     * particular object.
     */
    var opts = {};
    opts.include_master = true;

    findObjects.call(this, bucket, filter, opts, function (err, objs) {
        if (err) {
            log.error(err, 'failed to get object %s', uuid);
            cb(err);
        } else {
            cb(null, objs.length > 0 ? objs[0] : null);
        }
    });

    return (null);
};

MorayStorage.prototype.delObject = function delObject(bucket, uuid, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.func(cb, 'cb');

    var onFinish = function () {
        if (self.object_caches && self.object_caches[bucket]) {
            log.debug('deleting object %s from cache', uuid);
            self.object_caches[bucket].del(uuid);
        }
        cb();
    };

    this.local.delObject(bucket, uuid, function (err) {
        if (err && verror.hasCauseWithName(err, 'ObjectNotFoundError')) {
            cb(err);
            return;
        }

        if (!err) {
            onFinish();
            return;
        }

        assert.ok(err && verror.hasCauseWithName(err, 'ObjectNotFoundError'));

        if (!self.master) {
            cb(new mod_errors.ObjectNotFoundError(err.message));
            return;
        }

        log.debug('deleting object %s from master', uuid);

        /*
         * When the object isn't present in the local datacenter's
         * moray, try to delete it from the master datacenter's moray.
         */
        self.master.delObject(bucket, uuid, function (suberr) {
            if (suberr &&
                verror.hasCauseWithName(suberr, 'ObjectNotFoundError')) {
                cb(suberr);
                return;
            }

            if (!suberr) {
                onFinish();
                return;
            }

            cb(new mod_errors.ObjectNotFoundError(err.message));
        });
    });
};

MorayStorage.prototype.listObjectValues = listObjectValues;

function listObjectValues(bucket, filters, opts, cb) {
    var log = this.log;

    assert.string(bucket, 'bucket');
    assert.object(filters, 'filters');
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var ldap_filters = [ ldapjs.parseFilter('(uuid=*)') ];
    Object.keys(filters).forEach(function (key) {
        if (key === 'since') {
            ldap_filters.push(new ldapjs.GreaterThanEqualsFilter({
                attribute: 'started',
                value: String(filters[key])
            }));
        } else if (key === 'until') {
            ldap_filters.push(new ldapjs.LessThanEqualsFilter({
                attribute: 'started',
                value: String(filters[key])
            }));
        } else {
            ldap_filters.push(new ldapjs.EqualityFilter({
                attribute: key,
                value: filters[key]
            }));
            }
    });

    var filter;
    if (ldap_filters.length === 1)
        filter = ldap_filters[0];
    else
        filter = new ldapjs.AndFilter({ filters: ldap_filters });

    log.debug({
        bucket: bucket,
        filter: filter.toString() },
    'listing objects');

    findObjects.call(this, bucket, filter.toString(), opts,
        function (err, records) {
        if (err)
            return (cb(err));

        var vals = records.map(function (record) {
            var val = null;
            if (record)
                val = record.value;
            return (val);
        });

        return (cb(null, vals));
    });
}

function findObjects(bucket, filter, opts, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(filter, 'filter');
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var clients = [ this.local ];

    if (opts.include_master && this.master)
        clients.push(this.master);

    log.debug('finding objects with %d moray clients', clients.length);

    vasync.forEachParallel({
        func: function (client, subcb) {
            findObjectsPaginated.call(self,
                client, bucket, filter, subcb);
        },
        inputs: clients
    }, function (err, results) {
        if (err)
            return (cb(err));

        var objs = [];
        results.successes.forEach(function (r) {
            objs = objs.concat(r);
        });

        log.debug('found %d objects', objs.length);

        return (cb(null, objs));
    });
}

function findObjectsPaginated(client, bucket, filter, cb) {
    var self = this;
    var log = self.log;

    assert.object(client, 'client');
    assert.string(bucket, 'bucket');
    assert.string(filter, 'filter');
    assert.func(cb, 'cb');

    cb = once(cb);

    /*
     * Find 1000 records at a time.  By default records are sorted by _id,
     * so the records will be sorted by creation time.
     */
    var opts = {};
    opts.limit = 1000;
    opts.offset = 0;

    var hasMoreObjs = true;
    var objs = [];

    async.whilst(function () {
        return (hasMoreObjs);
    }, function (subcb) {
        var count = 0;

        // This can happen if moray isn't inited yet (see the init
        // timeout).
        try {
            var res = client.findObjects(bucket, filter, opts);
        } catch (e) {
            subcb(e);
            return;
        }

        // This is also a symtom of moray not being available.
        if (res === null) {
            subcb(new Error('moray client error'));
            return;
        }

        res.on('record', function (record) {
            objs.push(record);
            count++;
        });

        res.on('error', function (err) {
            log.error(err, 'failed to list objects from ' +
                'bucket %s', bucket);
            subcb(err);
        });

        res.on('end', function () {
            log.debug('found %d objects (%d total)',
                count, objs.length);

            /*
             * If there are less than 1000 objects in the most
             * recent query, we've reached the end of the bucket and
             * there are no more objects.
             */
            if (count !== 1000)
                hasMoreObjs = false;
            else
                opts.offset += 1000;

            subcb();
        });
    }, function (err) {
        cb(err, objs);
    });
}

MorayStorage.prototype.ping = function ping(cb) {
    var self = this;
    var opts = { deep: true, log: self.log };
    self.local.ping(opts, cb);
};

MorayStorage.prototype.close = function close() {
    this.local.close();
    if (this.master)
        this.master.close();
};
