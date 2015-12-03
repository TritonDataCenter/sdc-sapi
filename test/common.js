/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * test/common.js: common routines for all tests
 */

var assert = require('assert-plus');
var async = require('async');
var node_uuid = require('node-uuid');
var util = require('util');


/**
 * Create a test SAPI application.
 *
 * ...
 * @param cb {Function} `function (err, app)`
 */
function createApplication(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.sapi, 'opts.sapi');  // SAPI client
    assert.uuid(opts.uuid, 'opts.uuid');
    assert.optionalString(opts.name, 'opts.name');
    assert.optionalUuid(opts.image_uuid, 'opts.image_uuid');
    assert.func(cb, 'cb');
    assert.uuid(process.env.ADMIN_UUID, 'process.env.ADMIN_UUID');

    var name = opts.name || 'empty_test_application';
    var createOpts = {
        uuid: opts.uuid
    };
    if (opts.image_uuid) {
        createOpts.params = {
            image_uuid: opts.image_uuid
        };
    }

    opts.sapi.createApplication(name, process.env.ADMIN_UUID, createOpts, cb);
}

function createService(app_uuid, uuid, cb) {
    var name = 'empty_test_service';

    var opts = {};
    opts.params = {};
    opts.params.ram = 256;
    opts.params.networks = [ 'admin' ];
    assert.string(process.env.SAPI_TEST_IMAGE_UUID,
        'process.env.SAPI_TEST_IMAGE_UUID');
    opts.params.image_uuid = process.env.SAPI_TEST_IMAGE_UUID;

    if (arguments.length === 2)
        cb = uuid;
    else
        opts.uuid = uuid;

    this.sapi.createService(name, app_uuid, opts, function (err, svc) {
        return (cb(err));
    });
}

function createInstance(svc_uuid, uuid, cb) {
    var opts = {};

    if (arguments.length === 2)
        cb = uuid;
    else
        opts.uuid = uuid;

    if (!opts.params)
        opts.params = {};
    if (!opts.params.alias)
        opts.params.alias = 'sapitest-' + node_uuid.v4().substr(0, 8);

    this.sapi.createInstance(svc_uuid, opts, cb);
}

function createManifest(uuid, cb) {
    var opts = {};

    if (arguments.length === 1)
        cb = uuid;
    else
        opts.uuid = uuid;

    opts.path = '/var/tmp/config.json';
    opts.template = '{ logLevel: "debug" }';
    opts.name = 'more_or_less_empty test config';

    this.sapi.createManifest(opts, cb);
}

function testUpdates(t, uri, cb) {
    var self = this;

    async.waterfall([
        function putUpdateChanges(subcb) {
            var changes = {};
            changes.action = 'update';
            changes.params = {};
            changes.params.foo = 'baz';
            changes.metadata = {};
            changes.metadata.foo = 'bar';

            function onPut(err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                if (res.statusCode === 200) {
                    t.equal(obj.params.foo, 'baz');
                    t.equal(obj.metadata.foo, 'bar');
                }
                subcb(null);
            }

            self.client.put(uri, changes, onPut);
        },
        function putDeleteChanges(subcb) {
            var changes = {};
            changes.action = 'delete';
            changes.params = {};
            changes.params.foo = ' ';
            changes.metadata = {};
            changes.metadata.foo = ' ';

            function onPut(err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                if (res.statusCode === 200) {
                    t.ok(!obj.params.foo);
                    t.ok(!obj.metadata.foo);
                }
                subcb(null);
            }

            self.client.put(uri, changes, onPut);
        },
        function putReplaceChanges1(subcb) {
            var changes = {};
            changes.action = 'update';
            changes.params = {};
            changes.params.oldparam = 'oldvalue';
            changes.metadata = {};
            changes.metadata.oldmd = 'oldvalue';

            function onPut(err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                if (res.statusCode === 200) {
                    t.equal(obj.params.oldparam, 'oldvalue');
                    t.equal(obj.metadata.oldmd, 'oldvalue');
                }
                subcb(null);
            }

            self.client.put(uri, changes, onPut);
        },
        function putReplaceChanges2(subcb) {
            var changes = {};
            changes.action = 'replace';
            changes.params = {};
            changes.params.newparam = 'newvalue';
            changes.metadata = {};
            changes.metadata.newmd = 'newvalue';

            function onPut(err, _, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                if (res.statusCode === 200) {
                    t.equal(obj.params.newparam, 'newvalue');
                    t.equal(obj.metadata.newmd, 'newvalue');
                    t.equal(Object.keys(obj.params).length, 1);
                    t.equal(Object.keys(obj.metadata).length, 1);
                }
                subcb(null);
            }

            self.client.put(uri, changes, onPut);
        }
    ], cb);
}


exports.createApplication = createApplication;
exports.createService = createService;
exports.createInstance = createInstance;
exports.createManifest = createManifest;
exports.testUpdates = testUpdates;
