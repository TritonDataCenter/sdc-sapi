/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/manifests.test.js: test /manifests endpoints
 */

var async = require('async');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/manifests';


helper.before(function (cb) {
	this.client = helper.createJsonClient();

	cb(null);
});

helper.after(function (cb) {
	cb(null);
});


// -- Test invalid inputs

test('get nonexistent manifest', function (t) {
	var uri_cfg = '/manifests/' + node_uuid.v4();

	this.client.get(uri_cfg, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 404);
		t.end();
	});
});

test('create w/ missing inputs', function (t) {
	var self = this;

	var cfg = {};
	cfg.name = 'my bad manifest';
	cfg.path = '/opt/smartdc/minnow/etc/config.json';
	cfg.template = {
		logLevel: 'debug',
		datacenter: 'bh1-kvm6'
	};

	function check409(err, res) {
		t.ok(err);
		t.equal(err.name, 'MissingParameterError');
		t.equal(res.statusCode, 409);
	}

	async.waterfall([
		function (cb) {
			var badcfg = jsprim.deepCopy(cfg);
			delete badcfg.name;

			self.client.post(URI, badcfg, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			var badcfg = jsprim.deepCopy(cfg);
			delete badcfg.path;

			self.client.post(URI, badcfg, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			var badcfg = jsprim.deepCopy(cfg);
			delete badcfg.template;

			self.client.post(URI, badcfg, function (err, _, res) {
				check409(err, res);
				cb();
			});
		}
	], function (err) {
		t.end();
	});
});


// -- Test put/get/del manifest

test('put/get/del manifest', function (t) {
	var self = this;

	var cfg = {};
	cfg.uuid = node_uuid.v4();
	cfg.name = 'mycoolmanifest';
	cfg.path = '/opt/smartdc/minnow/etc/config.json';
	cfg.template = {
		logLevel: 'debug',
		datacenter: 'bh1-kvm6'
	};
	cfg.post_cmd = '/bin/true';

	var checkCfg = function (obj) {
		t.equal(obj.uuid, cfg.uuid);
		t.equal(obj.name, cfg.name);
		t.equal(obj.path, cfg.path);
		t.deepEqual(obj.template, cfg.template);
		t.equal(obj.post_cmd, cfg.post_cmd);
	};

	var uri_cfg = '/manifests/' + cfg.uuid;

	async.waterfall([
		function (cb) {
			self.client.post(URI, cfg, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkCfg(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_cfg, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkCfg(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(URI, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj.length > 0);

				var found = false;

				for (var ii = 0; ii < obj.length; ii++) {
					if (obj[ii].uuid === cfg.uuid) {
						checkCfg(obj[ii]);
						found = true;
					}
				}

				t.ok(found, 'found manifest ' + cfg.uuid);

				cb(null);
			});
		},
		function (cb) {
			self.client.del(uri_cfg, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_cfg, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb(null);
			});
		}
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});
