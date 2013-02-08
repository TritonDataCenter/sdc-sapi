/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/metadata.test.js: test serialization of metadata
 */

var assert = require('assert-plus');
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
	var config = JSON.parse(mod_manifests.serialize([], {}));

	t.deepEqual(config[mod_manifests.METADATA], {});
	t.deepEqual(config[mod_manifests.MANIFESTS], []);
	t.deepEqual(config[mod_manifests.VERSION], '1.0.0');

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

	var serialized = mod_manifests.serialize(manifests, metadata);
	assert.string(serialized, 'serialized');

	var config = JSON.parse(serialized);
	assert.object(config, 'config');

	t.deepEqual(config[mod_manifests.METADATA], metadata);
	t.deepEqual(config[mod_manifests.MANIFESTS], manifests);

	t.end();
});
