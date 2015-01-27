/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * test/applications.test.js: test /applications endpoints
 */

var async = require('async');
var common = require('./common');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/applications';
var APP_UUID;

/*
 * Two schemas, one which allows additional properties, one which does not.
 */
var soft_schema = {
    'type': 'object',
    'properties': {
        'foo': {
            'type': 'string',
            'minLength': 1,
            'required': true
        }
    }
};

var hard_schema = {
    'type': 'object',
    'properties': {
        'foo': {
            'type': 'string',
            'minLength': 1,
            'required': true
        }
    },
    'additionalProperties': true
};

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

test('get nonexistent application', function (t) {
    var uri_app = '/applications/' + node_uuid.v4();

    this.client.get(uri_app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
    });
});

test('create w/o owner_uuid', function (t) {
    var app = {
        name: 'owner_uuid missing'
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('create w/o name', function (t) {
    var app = {
        owner_uuid: process.env.ADMIN_UUID
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('create w/ invalid owner_uuid', function (t) {
    var app = {
        name: 'invalid owner_uuid',
        owner_uuid: node_uuid.v4()
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        // Since we don't consult ufds anymore, this will succeed.
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.end();
    });
});

test('create w/ invalid manifest', function (t) {
    var app = {
        name: 'invalid manifest',
        owner_uuid: process.env.ADMIN_UUID,
        manifests: { my_service: node_uuid.v4() }
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 500);
        t.end();
    });
});

// -- Test put/get/del application without specifying UUID

test('create application w/o UUID', function (t) {
    var app = {
        name: 'no uuid here',
        owner_uuid: process.env.ADMIN_UUID
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'no uuid here');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        APP_UUID = obj.uuid;
        t.end();
    });
});

test('get application w/o UUID', function (t) {
    var uri_app = '/applications/' + APP_UUID;

    this.client.get(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'no uuid here');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        t.equal(obj.uuid, APP_UUID);
        t.end();
    });
});

test('delete application', function (t) {
    var self = this;

    var uri_app = '/applications/' + APP_UUID;

    this.client.del(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 204);

        self.client.get(uri_app, function (suberr, _, subres) {
            t.ok(suberr);
            t.equal(suberr.statusCode, 404);
            t.end();
        });
    });
});


// -- Test put/get/del application with specifying UUID and parameters

test('put/get/del application', function (t) {
    var self = this;

    APP_UUID = node_uuid.v4();

    var params = {
        dns: '10.0.0.2',
        domain: 'foo.co.us',
        vmapi: {
            url: 'https://10.0.0.10'
        }
    };

    var app = {
        name: 'mycoolapp_' + node_uuid.v4().substr(0, 8),
        uuid: APP_UUID,
        owner_uuid: process.env.ADMIN_UUID,
        params: params
    };

    var cfg_uuid;

    var checkApp = function (obj) {
        t.equal(obj.name, app.name);
        t.equal(obj.uuid, app.uuid);
        t.equal(obj.owner_uuid, app.owner_uuid);
        t.deepEqual(obj.params, app.params);
        t.deepEqual(obj.manifests, { my_service: cfg_uuid });
    };

    var checkAppInArray = function (obj) {
        t.ok(obj.length > 0);

        var found = false;

        for (var ii = 0; ii < obj.length; ii++) {
            if (obj[ii].uuid === APP_UUID) {
                checkApp(obj[ii]);
                found = true;
            }
        }

        t.ok(found, 'found application ' + APP_UUID);
    };

    var uri_app = '/applications/' + APP_UUID;

    async.waterfall([
        function (cb) {
            common.createManifest.call(self, function (err, cfg) {
                if (cfg) {
                    cfg_uuid = cfg.uuid;
                    app.manifests =
                        { my_service: cfg_uuid };
                }

                cb(err);
            });
        },
        function (cb) {
            self.client.post(URI, app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkApp(obj);

                cb(null);
            });
        },
        function (cb) {
            self.client.get(uri_app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkApp(obj);

                cb(null);
            });
        },
        function (cb) {
            var uri = '/applications?name=' + app.name;

            self.client.get(uri, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkApp(obj[0]);

                cb(null);
            });
        },
        function (cb) {
            var uri = '/applications?owner_uuid=' + app.owner_uuid;

            self.client.get(uri, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkAppInArray(obj);

                cb(null);
            });
        },
        function (cb) {
            self.client.get(URI, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkAppInArray(obj);

                cb(null);
            });
        },
        function (cb) {
            common.testUpdates.call(self, t, uri_app, cb);
        },
        function (cb) {
            self.client.del(uri_app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);

                cb(null);
            });
        },
        function (cb) {
            self.client.get(uri_app, function (err, _, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb(null);
            });
        },
        function (cb) {
            self.sapi.deleteManifest(cfg_uuid, cb);
        }
    ], function (err, results) {
        t.ifError(err);
        t.end();
    });
});


// -- Test put/get/del application with already-used UUID

test('reuse application UUID', function (t) {
    var app = {
        name: 'This application name has spaces.',
        uuid: APP_UUID,
        owner_uuid: process.env.ADMIN_UUID
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'This application name has spaces.');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        t.equal(obj.uuid, APP_UUID);
        t.end();
    });
});

test('get reused application', function (t) {
    var uri_app = '/applications/' + APP_UUID;

    this.client.get(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'This application name has spaces.');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        t.equal(obj.uuid, APP_UUID);
        t.end();
    });
});

test('delete reused application', function (t) {
    var self = this;

    var uri_app = '/applications/' + APP_UUID;

    this.client.del(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 204);

        self.client.get(uri_app, function (suberr, _, subres) {
            t.ok(suberr);
            t.equal(suberr.statusCode, 404);
            t.end();
        });
    });
});


test('updating owner_uuid', function (t) {
    var self = this;

    APP_UUID = node_uuid.v4();

    var params = {
        dns: '10.0.0.2',
        domain: 'foo.co.us',
        vmapi: {
            url: 'https://10.0.0.10'
        }
    };

    var app = {
        name: 'mycoolapp_' + node_uuid.v4().substr(0, 8),
        uuid: APP_UUID,
        owner_uuid: process.env.ADMIN_UUID,
        params: params
    };

    var new_owner_uuid = node_uuid.v4();

    var uri_app = '/applications/' + APP_UUID;

    async.waterfall([
        function (cb) {
            self.client.post(URI, app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
                cb();
            });
        },
        function (cb) {
            self.client.get(uri_app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.ok(obj);
                cb();
            });
        },
        function (cb) {
            var uri = '/applications?owner_uuid=' + app.owner_uuid;

            self.client.get(uri, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj.length >= 1);

                cb();
            });
        },
        function (cb) {
            var changes = {};
            changes.owner_uuid = new_owner_uuid;

            self.client.put(uri_app, changes,
                function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                t.equal(obj.owner_uuid, new_owner_uuid);
                cb();
            });
        },
        function (cb) {
            var uri = '/applications?owner_uuid=' + new_owner_uuid;

            self.client.get(uri, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj.length === 1);

                cb();
            });
        },
        function (cb) {
            self.client.del(uri_app, function (err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);

                cb();
            });
        }
    ], function (err) {
        t.ifError(err);
        t.end();
    });
});

/* Create application with metadata that doesn't match schema */
test('create application with schema mismatch', function (t) {
    var app = {
        name: 'badschema',
        owner_uuid: process.env.ADMIN_UUID,
        metadata: {},
        metadata_schema: soft_schema
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.name, 'SchemaValidationError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});

/*
 * Create application with valid schema
 *   o Verify requiring additional properties properly passes and fails
 *   o Update metadata that matches schema passes
 *   o Update metadata that doesn't match schema fails
 *   o Update schema and metadata matches new schema
 */
test('create application with valid schema', function (t) {
    var data, app;
    data = { 'foo': 'bar' };
    app = {
        name: 'schema',
        owner_uuid: process.env.ADMIN_UUID,
        metadata: data,
        metadata_schema: soft_schema
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'schema');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        t.deepEqual(obj.metadata, data);
        t.deepEqual(obj.metadata_schema, soft_schema);
        APP_UUID = obj.uuid;
        t.end();
    });
});

test('put that matches schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var data = { 'foo': 'baz' };
    var self = this;

    self.client.put(uri_app, { 'metadata': data },
        function (err, _, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.deepEqual(obj.metadata, data);
        t.end();
    });
});

test('put that fails schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var data = { 'bad_key': 'baz' };
    var self = this;

    self.client.put(uri_app, { 'action': 'replace', 'metadata': data },
        function (err, _, res, obj) {
        t.ok(err);
        t.equal(err.name, 'SchemaValidationError');
        t.equal(res.statusCode, 409);
        t.end();
    });

});

test('delete application with schema', function (t) {
    var self = this;

    var uri_app = '/applications/' + APP_UUID;

    this.client.del(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 204);

        self.client.get(uri_app, function (suberr, _, subres) {
            t.ok(suberr);
            t.equal(suberr.statusCode, 404);
            t.end();
        });
    });
});

/*
 * Create application without schema:
 *   o Verify adding mismatching schema fails
 *   o Verify adding matching schema passes
 */
test('create application for eventual schema', function (t) {
    var data, app;
    data = { 'hello': 'world' };
    app = {
        name: 'schema',
        owner_uuid: process.env.ADMIN_UUID,
        metadata: data
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equal(obj.name, 'schema');
        t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
        t.deepEqual(obj.metadata, data);
        APP_UUID = obj.uuid;
        t.end();
    });
});

test('put with mis-matching schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var self = this;

    self.client.put(uri_app, { 'metadata_schema': soft_schema },
        function (err, _, res, obj) {
        t.ok(err);
        t.equal(err.name, 'SchemaValidationError');
        t.equal(res.statusCode, 409);
        t.end();
    });

});

test('put with failing hard schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var data = { 'foo': 'bar' };
    var self = this;

    self.client.put(uri_app, { 'metadata_schema': hard_schema,
        'metadata': data },
        function (err, _, res, obj) {
        t.ok(err);
        t.equal(err.name, 'SchemaValidationError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('put adding valid schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var data = { 'foo': 'bar' };
    var self = this;

    self.client.put(uri_app, { 'metadata_schema': soft_schema,
        'metadata': data },
        function (err, _, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.deepEqual(obj.metadata_schema, soft_schema);
        t.end();
    });
});

test('replacing metadata and schema', function (t) {
    var uri_app = '/applications/' + APP_UUID;
    var data = { 'foo': 'bar' };
    var self = this;

    self.client.put(uri_app, { 'action': 'replace',
        'metadata_schema': hard_schema, 'metadata': data },
        function (err, _, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.deepEqual(obj.metadata_schema, hard_schema);
        t.end();
    });
});
