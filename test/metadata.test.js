/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/instances.test.js: test /instances endpoints
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

var mod_metadata = require('../lib/metadata');


// XXX These key names should only be in one place
var MANIFESTS = 'config_manifests';
var MDATA_KEYS = 'metadata_keys';


// -- Tests

helper.before(function (cb) {
	cb(null);
});

helper.after(function (cb) {
	cb(null);
});


// -- Test metadata and configuration serialization

test('test w/ empty args', function (t) {
	var kvpairs = mod_metadata.generateZoneMetadata({}, []);

	t.equal(kvpairs[MANIFESTS], JSON.stringify([]));
	t.equal(kvpairs[MDATA_KEYS], JSON.stringify([]));

	t.end();
});


test('test metadata serialization', function (t) {
	var metadata = {
		FOO: 'BAR',
		BAZ: 123,
		OBJ: {
			DATA: true
		}
	};

	var config = {
		name: 'my_config',
		type: 'json',
		path: '/opt/smartdc/etc/config.json',
		template: 'Service template here'
	};
	var configs = [ config ];

	var kvpairs = mod_metadata.generateZoneMetadata(metadata, configs);

	t.deepEqual(kvpairs[MANIFESTS],
	    JSON.stringify([ 'my_config_manifest' ]));
	t.deepEqual(kvpairs[MDATA_KEYS],
	    JSON.stringify([ 'FOO', 'BAZ', 'OBJ' ]));

	t.deepEqual(kvpairs['my_config_manifest'], JSON.stringify(config));

	t.deepEqual(kvpairs['FOO'], JSON.stringify(metadata.FOO));
	t.deepEqual(kvpairs['BAZ'], JSON.stringify(metadata.BAZ));
	t.deepEqual(kvpairs['OBJ'], JSON.stringify(metadata.OBJ));

	t.end();
});
