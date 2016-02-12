/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/stor/local.js: provide local storage for SAPI objects
 */

var async = require('async');
var assert = require('assert-plus');
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var vasync = require('vasync');
var verror = require('verror');

var mod_errors = require('../errors');

var sprintf = require('util').format;

var ROOT = '/sapi';
var BACKUP_ROOT = '/opt/smartdc/sapi/storage';
var ENCODING = 'utf8';


module.exports = LocalStorage;

function LocalStorage(config) {
    var self = this;

    assert.object(config, 'config');
    assert.object(config.log, 'config.log');
    assert.object(config.buckets, 'config.buckets');

    self.log = config.log;
    self.buckets = config.buckets;
}

LocalStorage.prototype.init = function init(cb) {
    var self = this;
    var buckets = self.buckets;
    var m = 'This SAPI doesn\'t have a delegated dataset.  Falling back ' +
        'to local filesystem.';

    async.waterfall([
        function (subcb) {
            fs.stat(ROOT, function (err, stats) {
                if (err || !stats.isDirectory()) {
                    self.log.error(m);
                    ROOT = BACKUP_ROOT;
                }
                return (subcb());
            });
        },
        function (subcb) {
            mkdirp(ROOT, function (err) {
                subcb(err);
            });
        },
        function (subcb) {
            vasync.forEachParallel({
                func: function (key, subsubcb) {
                    initBucket(buckets[key], subsubcb);
                },
                inputs: Object.keys(buckets)
            }, function (err) {
                subcb(err);
            });
        }
    ], cb);
};

function initBucket(bucket, cb) {
    var dir = path.join(ROOT, bucket);

    fs.mkdir(dir, function (err) {
        if (err && err.code !== 'EEXIST')
            return (cb(err));
        return (cb(null));
    });
}


// -- Object operations

function getObjectFile(bucket, uuid) {
    return (sprintf('%s/%s/%s', ROOT, bucket, uuid));
}

LocalStorage.prototype.putObject = putObject;

function putObject(bucket, uuid, obj, opts, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.object(obj, 'obj');

    /*
     * This is kind of wacky since opts isn't used anywhere, but it's
     * necessary to keep the same function signature as
     * MorayStorage.putObject().
     */
    if (arguments.length === 4) {
        cb = opts;
        opts = {};
    }

    var file = getObjectFile(bucket, uuid);
    var contents = JSON.stringify(obj, null, 4);

    fs.writeFile(file, contents, ENCODING, function (err) {
        if (err)
            log.error(err, 'failed to write file "%s"', file);
        cb(err);
    });
}

LocalStorage.prototype.getObject = function getObject(bucket, uuid, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.func(cb, 'cb');

    var file = getObjectFile(bucket, uuid);

    fs.readFile(file, ENCODING, function (err, contents) {
        if (err && err.code !== 'ENOENT') {
            log.error(err, 'failed to read file "%s"', file);
            return (cb(err));
        } else if (err) {
            log.warn('object %s doesn\'t exist', uuid);
            return (cb(null, null));
        }

        var obj = null;
        try {
            obj = JSON.parse(contents);
        } catch (e) {
            err = new Error('invalid JSON in "' + file + '"');
        }

        if (err)
            return (cb(err));

        return (cb(null, { value: obj }));
    });
};

LocalStorage.prototype.delObject = function delObject(bucket, uuid, cb) {
    var self = this;
    var log = self.log;

    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.func(cb, 'cb');

    var file = getObjectFile(bucket, uuid);

    fs.unlink(file, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
                log.warn('not deleting %s; ' +
                    'object doesn\'t exist', uuid);
                return (cb(new mod_errors.ObjectNotFoundError(
                    'no such object: ' + uuid)));
            } else {
                log.error('failed to remove file "%s"', file);
                return (cb(err));
            }
        }

        return (cb(null));
    });
};

LocalStorage.prototype.listObjectValues = listObjectValues;

function listObjectValues(bucket, filters, opts, cb) {
    var self = this;
    var log = self.log;

    /*
     * The opts argument isn't used here, but is kept to maintain
     * compatibility with MorayStorage.listObjectValues().
     */
    assert.string(bucket, 'bucket');
    assert.object(filters, 'filters');
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var dir = path.join(ROOT, bucket);

    fs.readdir(dir, function (err, dirents) {
        if (err) {
            log.error(err, 'failed to readdir "%s"', dir);
            return (cb(err));
        }

        var results = [];
        var errors = [];

        var queue = vasync.queue(
            function (dirent, subcb) {
                filterObject.call(self,
                    bucket, dirent, filters, function (filterErr, result) {
                        if (filterErr) {
                            subcb(filterErr);
                            return;
                        }
                        results.push(result);
                        subcb();
                    });
            },
            512);


        queue.push(dirents, function (queueErr) {
            if (queueErr) {
                errors.push(queueErr);
            }
        });

        queue.close();

        queue.on('end', function () {
            if (errors.length) {
                return (cb(new verror.VError(errors[0], 'loading objects')));
            }

            var vals = [];

            results.forEach(function (op) {
                if (op) {
                    vals.push(op);
                }
            });

            return (cb(null, vals));
        });

        return (null);
    });
}

function filterObject(bucket, uuid, filters, cb) {
    assert.string(bucket, 'bucket');
    assert.string(uuid, 'uuid');
    assert.object(filters, 'filters');
    assert.func(cb, 'cb');

    this.getObject(bucket, uuid, function (err, record) {
        if (err)
            return (cb(err));

        var val = record.value;

        /*
         * Filter objects which match all the search options.
         */
        var matches = true;
        Object.keys(filters).forEach(function (key) {
            // History filters:
            if (key === 'since') {
                matches = matches &&
                    val.started >= filters.since;
            } else if (key === 'until') {
                matches = matches &&
                    val.started <= filters.until;
            } else {
                matches = matches &&
                    filters[key] === val[key];
            }
        });

        return (cb(null, matches ? val : null));
    });
}

LocalStorage.prototype.ping = function ping(cb) {
    process.nextTick(cb);
};

LocalStorage.prototype.close = function close() {
    // Nothing to do when closing client
    return;
};
