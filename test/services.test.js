/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * test/services.test.js: test /services endpoints
 */

var async = require('async');
var common = require('./common');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/services';


// -- Boilerplate

var server;
var tests_run = 0;

helper.before(function (cb) {
    this.client = helper.createJsonClient();
    this.sapi = helper.createSapiClient();

    if (server)
        return (cb(null));

    helper.startSapiServer(function (err, res) {
        server = res;
        cb(err);
    });
});

helper.after(function (cb) {
    if (++tests_run === helper.getNumTests()) {
        helper.shutdownSapiServer(server, cb);
    } else {
        cb();
    }
});


// -- Test invalid inputs

test('create w/ missing inputs', function (t) {
    var self = this;

    var svc = {};
    svc.name = 'application_uuid missing';
    svc.application_uuid = node_uuid.v4();

    svc.params = {};
    t.ok(process.env.SAPI_TEST_IMAGE_UUID, 'process.env.SAPI_TEST_IMAGE_UUID');
    svc.params.image_uuid = process.env.SAPI_TEST_IMAGE_UUID;
    svc.params.ram = 256;
    svc.params.networks = [ 'admin' ];

    function check409(err, res) {
        t.ok(err);
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
    }

    async.waterfall([
        function (cb) {
            var badsvc = jsprim.deepCopy(svc);
            delete badsvc.name;

            self.client.post(URI, badsvc, function (err, req, res) {
                check409(err, res);
                cb();
            });
        },
        function (cb) {
            var badsvc = jsprim.deepCopy(svc);
            delete badsvc.application_uuid;

            self.client.post(URI, badsvc, function (err, req, res) {
                check409(err, res);
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('create w/ invalid application_uuid', function (t) {
    var svc = {};
    svc.name = 'invalid application_uuid';
    svc.application_uuid = node_uuid.v4();  // invalid

    svc.params = {};
    t.ok(process.env.SAPI_TEST_IMAGE_UUID, 'process.env.SAPI_TEST_IMAGE_UUID');
    svc.params.image_uuid = process.env.SAPI_TEST_IMAGE_UUID;
    svc.params.ram = 256;
    svc.params.networks = [ 'admin' ];

    this.client.post('/services', svc, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
    });
});

test('create w/ other invalid inputs', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();

    var svc = {};
    svc.name = 'invalid inputs';
    svc.application_uuid = app_uuid;

    svc.params = {};
    t.ok(process.env.SAPI_TEST_IMAGE_UUID, 'process.env.SAPI_TEST_IMAGE_UUID');
    svc.params.image_uuid = process.env.SAPI_TEST_IMAGE_UUID;
    svc.params.ram = 256;
    svc.params.networks = [ 'admin' ];

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            // invalid config manifest
            var badsvc = jsprim.deepCopy(svc);
            badsvc.manifests = { my_service: node_uuid.v4() };

            self.client.post(URI, badsvc, function (err, req, res) {
                t.ok(err);
                t.equal(res.statusCode, 500);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, cb);
        }
    ]}, function (err) {
        t.ifError(err);
        t.end();
    });
});

test('create w/ invalid type', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();

    var svc = {};
    svc.name = 'invalid inputs';
    svc.application_uuid = app_uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            // invalid type
            var badsvc = jsprim.deepCopy(svc);
            badsvc.type = 'superagent';

            self.client.post(URI, badsvc, function (err, req, res) {
                t.ok(err);
                t.equal(res.statusCode, 500);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, cb);
        }
    ]}, function (err) {
        t.ifError(err);
        t.end();
    });
});

test('create w/ an agent service', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();

    var svc = {};
    svc.uuid = node_uuid.v4();
    svc.name = 'vm-agent';
    svc.application_uuid = app_uuid;
    svc.type = 'agent';

    var uri_svc = '/services/' + svc.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            self.client.post(URI, svc, function (err, req, res) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                cb();
            });
        },
        function (_, cb) {
            self.client.del(uri_svc, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, cb);
        }
    ]}, function (err) {
        t.ifError(err);
        t.end();
    });
});

test('get nonexistent service', function (t) {
    var uri_svc = '/services/' + node_uuid.v4();

    this.client.get(uri_svc, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
    });
});


// -- Test a standard put/get/del service

test('put/get/del service', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();

    var svc = {};
    svc.name = 'mycoolservice_' + node_uuid.v4().substr(0, 8);
    svc.uuid = node_uuid.v4();
    svc.application_uuid = app_uuid;

    svc.params = {};
    t.ok(process.env.SAPI_TEST_IMAGE_UUID, 'process.env.SAPI_TEST_IMAGE_UUID');
    svc.params.image_uuid = process.env.SAPI_TEST_IMAGE_UUID;
    svc.params.ram = 256;
    svc.params.networks = [ 'admin' ];

    svc.metadata = {
        dns: '10.0.0.2',
        domain: 'foo.co.us',
        vmapi: {
            url: 'https://10.0.0.10'
        }
    };

    var cfg_uuid;

    var checkService = function (obj) {
        t.equal(obj.name, svc.name);
        t.equal(obj.uuid, svc.uuid);
        t.deepEqual(obj.params, svc.params);
        t.deepEqual(obj.metadata, svc.metadata);
        t.deepEqual(obj.manifests, { my_service: cfg_uuid });
    };

    var checkServiceInArray = function (obj) {
        t.ok(obj.length > 0);

        var found = false;

        for (var ii = 0; ii < obj.length; ii++) {
            if (obj[ii].uuid === svc.uuid) {
                checkService(obj[ii]);
                found = true;
            }
        }

        t.ok(found, 'found service' + svc.uuid);
    };

    var uri_svc = '/services/' + svc.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createManifest.call(self, function (err, cfg) {
                if (cfg) {
                    cfg_uuid = cfg.uuid;
                    svc.manifests = {
                        my_service: cfg_uuid
                    };
                }
                cb(err);
            });
        },
        function (_, cb) {
            self.client.get(uri_svc, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb();
            });
        },
        function (_, cb) {
            self.client.post(URI, svc, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkService(obj);

                cb();
            });
        },
        function (_, cb) {
            self.client.get(uri_svc, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkService(obj);

                cb();
            });
        },
        function (_, cb) {
            // Check to make sure the service object is not
            // available through /applications -- this was a bug in
            // the moray cache looking in the wrong bucket.
            var uri = '/applications/' + svc.uuid;
            self.client.get(uri, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb();
            });
        },

        function (_, cb) {
            var uri = '/services?name=' + svc.name;

            self.client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkService(obj[0]);

                cb();
            });
        },
        function (_, cb) {
            var uri = '/services?application_uuid=' +
                svc.application_uuid;

            self.client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkServiceInArray(obj);

                cb();
            });
        },
        function (_, cb) {
            var uri = '/services?type=vm';

            self.client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkServiceInArray(obj);

                cb();
            });
        },
        function (_, cb) {
            self.client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkServiceInArray(obj);

                cb();
            });
        },
        function (_, cb) {
            common.testUpdates.call(self, t, uri_svc, cb);
        },
        function (_, cb) {
            self.client.del(uri_svc, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb();
            });
        },
        function (_, cb) {
            self.client.get(uri_svc, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteManifest(cfg_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
        t.ifError(err);
        t.end();
    });
});

// -- Test 1100 services to test moray findObjects limit

test('test 1100 services', function (t) {
    var self = this;

    var app_uuid = node_uuid.v4();

    var svcs = [];

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            async.whilst(
            function () {
                return (svcs.length < 1100);
            }, function (subcb) {
                var svc = {};
                svc.name = '1100services_' +
                    node_uuid.v4().substr(0, 8);
                svc.application_uuid = app_uuid;

                function onPost(err, req, res, obj) {
                    t.ifError(err);
                    t.equal(res.statusCode, 200);

                    svcs.push(obj);

                    subcb();
                }

                self.client.post(URI, svc, onPost);
            }, function (err) {
                cb();
            });
        },
        function (_, cb) {
            var uri = '/services?application_uuid=' + app_uuid;

            self.client.get(uri, function (err, req, res, obj) {
                t.ifError(err);

                if (res)
                    t.equal(res.statusCode, 200);
                else
                    t.fail('res not defined');

                t.equal(obj.length, 1100);

                cb();
            });
        },
        function (_, cb) {
            async.forEachSeries(svcs, function (svc, subcb) {
                var uri = '/services/' + svc.uuid;

                self.client.del(uri, function (err, req, res) {
                    t.ifError(err);
                    t.equal(res.statusCode, 204);
                    subcb();
                });
            }, function (err) {
                cb();
            });
        }
    ]}, function (err) {
        t.ifError(err);
        t.end();
    });
});
