/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * test/mode.test.js: test /mode endpoints
 */

var async = require('async');
var common = require('./common');
var mkdirp = require('mkdirp');
var node_uuid = require('node-uuid');
var path = require('path');
var rimraf = require('rimraf');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/mode';


// -- Boilerplate

var server;
var tests_run = 0;

helper.before(function (cb) {
    this.client = helper.createJsonClient();
    this.sapi = helper.createSapiClient();
    this.vmapiplus = helper.createVmapiPlusClient();

    var mode;

    async.waterfall([
        function (subcb) {
            var dirs = [
                '/opt/smartdc/sapi/storage',
                '/sapi/sapi_applications',
                '/sapi/sapi_instances',
                '/sapi/sapi_manifests',
                '/sapi/sapi_services'
            ];

            async.forEach(dirs, function (dir, scb) {
                // Remove any previous objects
                rimraf(dir, function (err) {
                    scb(err);
                });
            });
        },
        function (subcb) {
            /*
             * Start SAPI four times.  All but the second should be
             * in proto mode; the second in full mode.
             */
            if (tests_run === 0 ||
                tests_run === 2 ||
                tests_run === 3)
                mode = 'proto';
            else if (tests_run === 1)
                mode = 'full';
            else
                return (subcb(null));

            helper.startSapiServer(mode, function (err, res) {
                server = res;
                subcb(err);
            });
        }
    ], function (err) {
        cb(err);
    });
});

helper.after(function (cb) {
    if (++tests_run < 4 ||
        tests_run === helper.getNumTests()) {
        helper.shutdownSapiServer(server, cb);
    } else {
        cb();
    }
});


// -- Helper functions

function testMode(t, mode, cb) {
    var self = this;

    async.waterfall([
        function (subcb) {
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj, mode);
                subcb();
            });
        },
        function (subcb) {
            if (mode === 'proto') {
                // Skip because switching to proto mode isn't
                // supported. Not even as a no-op.
                return (subcb());
            }

            var uri_mode = URI + '?mode=' + mode;
            self.client.post(uri_mode,
                function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                subcb();
            });
        },
        function (subcb) {
            var uri_mode = URI + '?mode=bogus';

            self.client.post(uri_mode,
                function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 409);
                t.equal(err.name, 'InvalidArgumentError');
                subcb();
            });
        }
    ], function (err) {
        t.ifError(err);
        cb();
    });
}

// -- Test basic endpoints

test('in proto mode', function (t) {
    testMode.call(this, t, 'proto', function () {
        t.end();
    });
});

test('in full mode', function (t) {
    var self = this;

    testMode.call(this, t, 'full', function () {
        // Can't go from full -> proto
        var uri_mode = URI + '?mode=proto';

        self.client.post(uri_mode, function (err, req, res, obj) {
            t.ok(err);
            t.equal(res.statusCode, 409);
            t.equal(err.name, 'InvalidArgumentError');
            t.end();
        });
    });
});

// -- Test failed upgrade

test('upgrade to full mode with bogus IMAGE_UUID should fail', function (t) {
    var self = this;

    var man_uuid = node_uuid.v4();
    var app_uuid = node_uuid.v4();
    var svc_uuid = node_uuid.v4();
    var inst_uuid = node_uuid.v4();

    async.waterfall([
        function (cb) {
            // Should start in proto mode
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj, 'proto');
                cb();
            });
        },
        function (cb) {
            // Create an application, service, instance, and
            // manifest.
            common.createManifest.call(self, man_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            /*
             * This UUID is a known bogus image, so the
             * SAPI.setMode() call later will fail.
             */
            process.env['IMAGE_UUID'] =
                '0ee75f7e-b5d8-11e2-8c16-bb0d1acfb63d';

            common.createApplication.call(self, app_uuid,
                function (err) {
                delete process.env['IMAGE_UUID'];
                cb(err);
            });
        },
        function (cb) {
            common.createService.call(self, app_uuid, svc_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            common.createInstance.call(self, svc_uuid, inst_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            // Create an actual zone
            var vmapiplus = helper.createVmapiPlusClient();

            helper.consVmParams(function (err, params) {
                params.uuid = inst_uuid;
                vmapiplus.createVm(params, cb);
            });
        },
        function (cb) {
            // Attempt upgrade to full mode, which should fail
            var uri_mode = URI + '?mode=full';

            self.client.post(uri_mode,
                function (err, req, res, obj) {
                t.ok(err);
                if (res) {
                    t.equal(res.statusCode, 500);
                } else {
                    t.fail('res is null');
                }
                cb();
            });
        },
        function (cb) {
            // Should remain in proto mode
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj, 'proto');
                cb();
            });
        },
        function (cb) {
            /*
             * Even after the failed setMode() above, all the
             * objects must remain available.
             */
            var uris = [
                '/manifests/' + man_uuid,
                '/applications/' + app_uuid,
                '/services/' + svc_uuid,
                '/instances/' + inst_uuid
            ];

            async.forEach(uris, function (uri, subcb) {
                self.client.get(uri,
                    function (err, req, res, obj) {
                    t.ifError(err);
                    t.ok(obj);
                    t.equal(obj.uuid, path.basename(uri));
                    subcb();
                });
            }, cb);
        }
    ], function (err) {
        t.ifError(err);
        t.end();
    });
});


// -- Test upgrade proto -> full

test('upgrade to full mode', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();
    var svc_uuid = node_uuid.v4();
    var inst_uuid = node_uuid.v4();

    async.waterfall([
        function (cb) {
            // Should start in proto mode
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj, 'proto');
                cb();
            });
        },
        function (cb) {
            // Create an application, service, instance, and
            // manifest.
            common.createManifest.call(self,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            common.createApplication.call(self, app_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            common.createService.call(self, app_uuid, svc_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            common.createInstance.call(self, svc_uuid, inst_uuid,
                function (err) {
                cb(err);
            });
        },
        function (cb) {
            // Create an actual zone
            var vmapiplus = helper.createVmapiPlusClient();

            helper.consVmParams(function (err, params) {
                params.uuid = inst_uuid;
                vmapiplus.createVm(params, cb);
            });
        },
        function (cb) {
            // Upgrade to full mode
            var uri_mode = URI + '?mode=full';

            self.client.post(uri_mode,
                function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb();
            });
        },
        function (cb) {
            // Should finish in full mode
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj, 'full');
                cb();
            });
        }
    ], function (err) {
        t.ifError(err);
        t.end();
    });
});
