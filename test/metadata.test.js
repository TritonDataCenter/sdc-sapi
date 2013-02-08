/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/metadata.test.js: test serialization of metadata
 */

var async = require('async');
var common = require('./common');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');

var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;

var mod_manifests = require('../lib/common/manifests');


// -- Tests

helper.before(function (cb) {
	cb(null);
});

helper.after(function (cb) {
	cb(null);
});


// -- Test metadata and configuration serialization

test('test serialize() w/ empty args', function (t) {
	var kvpairs = mod_manifests.serialize([], {});

	t.equal(kvpairs[mod_manifests.MANIFESTS], JSON.stringify([]));
	t.equal(kvpairs[mod_manifests.MDATA_KEYS], JSON.stringify([]));

	t.end();
});


test('test serialize()', function (t) {
	var metadata = {
		FOO: 'BAR',
		BAZ: 123,
		OBJ: {
			DATA: true
		}
	};

	var manifest = {
		uuid: node_uuid.v4(),
		name: 'my_manifest',
		type: 'json',
		path: '/opt/smartdc/etc/config.json',
		template: 'Service template here'
	};
	var manifests = [ manifest ];

	var kvpairs = mod_manifests.serialize(manifests, metadata);

	t.deepEqual(kvpairs[mod_manifests.MANIFESTS],
	    JSON.stringify([ manifest.uuid ]));
	t.deepEqual(kvpairs[mod_manifests.MDATA_KEYS],
	    JSON.stringify([ 'FOO', 'BAZ', 'OBJ' ]));

	t.deepEqual(kvpairs[manifest.uuid], JSON.stringify(manifest));

	t.deepEqual(kvpairs['FOO'], JSON.stringify(metadata.FOO));
	t.deepEqual(kvpairs['BAZ'], JSON.stringify(metadata.BAZ));
	t.deepEqual(kvpairs['OBJ'], JSON.stringify(metadata.OBJ));

	t.end();
});

test('test excluded keys', function (t) {
	var script = 'my script here';

	var metadata = {
		FOO: 'BAR',
		'user-script': script
	};

	var manifest = {
		uuid: node_uuid.v4(),
		type: 'json',
		path: '/opt/smartdc/etc/config.json',
		template: 'Service template here'
	};
	var manifests = [ manifest ];

	var kvpairs = mod_manifests.serialize(manifests, metadata);

	t.deepEqual(kvpairs[mod_manifests.MANIFESTS],
	    JSON.stringify([ manifest.uuid ]));
	t.deepEqual(kvpairs[mod_manifests.MDATA_KEYS],
	    JSON.stringify([ 'FOO' ]));

	t.deepEqual(kvpairs[manifest.uuid], JSON.stringify(manifest));
	t.deepEqual(kvpairs['FOO'], JSON.stringify(metadata.FOO));
	t.equal(kvpairs['user-script'], script);

	t.end();
});
