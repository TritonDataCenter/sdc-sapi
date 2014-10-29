/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * test/applications.test.js: test /applications endpoints
 */

var async = require('async');
var common = require('./common');
var node_uuid = require('node-uuid');
var util = require('util');

if (require.cache[__dirname + '/helper.js']) {
    delete require.cache[__dirname + '/helper.js'];
}
var helper = require('./helper.js');
var test = helper.test;


var URI = '/history';
var ITEM_UUID;

// -- Boilerplate

var server;
var tests_run = 0;

helper.before(function (cb) {
    this.client = helper.createJsonClient({
        version: '2.0.0'
    });
    this.sapi = helper.createSapiClient({
        version: '2.0.0'
    });

    if (server) {
        return (cb(null));
    }

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

test('get nonexistent history item', function (t) {
    var uri_item = '/history/' + node_uuid.v4();

    this.client.get(uri_item, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.end();
    });
});


test('create w/o started', function (t) {
    var app = {
        uuid: node_uuid.v4(),
        changes: {
            whatever: 'here'
        }
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('create w/o changes', function (t) {
    var app = {
        uuid: node_uuid.v4(),
        started: new Date().getTime()
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('create w/ invalid changes', function (t) {
    var app = {
        changes: 'invalid changes',
        uuid: node_uuid.v4(),
        started: new Date().getTime()
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 500);
        t.end();
    });
});


test('create w/ invalid started', function (t) {
    var app = {
        started: 'invalid manifest',
        uuid: node_uuid.v4(),
        changes: { foo: 'bar' }
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 500);
        t.end();
    });
});


// CRUD history

test('create history item', function (t) {
    ITEM_UUID = node_uuid.v4();
    var app = {
        started: new Date().getTime(),
        uuid: ITEM_UUID,
        changes: { foo: 'bar' }
    };

    this.client.post(URI, app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj.started);
        t.ok(obj.changes.foo);
        t.equal(obj.uuid, ITEM_UUID);
        t.end();
    });
});

test('get history item by UUID', function (t) {
    var uri_app = '/history/' + ITEM_UUID;

    this.client.get(uri_app, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj.started);
        t.ok(obj.changes.foo);
        t.equal(obj.uuid, ITEM_UUID);
        t.end();
    });
});

test('update history item', function (t) {
    var uri_app = '/history/' + ITEM_UUID;
    this.client.put(uri_app, {
        started: new Date().getTime(),
        uuid: ITEM_UUID,
        changes: {
            foo: 'bar',
            fuu: 'baz'
        },
        error: {
            some: 'error'
        },
        finished: new Date().getTime()
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj.started);
        t.ok(obj.finished);
        t.ok(obj.changes.fuu);
        t.ok(obj.error);
        t.ok(obj.changes.foo);
        t.equal(obj.uuid, ITEM_UUID);
        t.end();
    });
});


test('list history', function (t) {
    this.client.get(URI, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(Array.isArray(obj));
        t.ok(obj[0].started);
        t.ok(obj[0].changes.foo);
        t.ok(obj[0].uuid);
        t.end();
    });
});


test('history exists since v2.0.0', function (t) {
    var sapi = helper.createSapiClient({
        version: '1.0.0'
    });
    sapi.get(URI, function (err, req, res, obj) {
        t.ok(err);
        t.equal(err.statusCode, 400);
        t.equal(err.name, 'InvalidVersionError');
        t.end();
    });
});


test('history works with version \'*\'', function (t) {
    var sapi = helper.createJsonClient({
        version: '*'
    });
    sapi.get(URI, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(Array.isArray(obj));
        t.ok(obj[0].started);
        t.ok(obj[0].changes.foo);
        t.ok(obj[0].uuid);
        t.end();
    });
});


test('delete history item', function (t) {
    var self = this;

    var uri_app = '/history/' + ITEM_UUID;

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
