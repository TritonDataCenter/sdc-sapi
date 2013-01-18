/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/common.js: common routines for all tests
 */

var ADMIN_UUID = '00000000-0000-0000-0000-000000000000';
var SMARTOS_163_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';

function createApplication(uuid, cb) {
	var name = 'empty_test_application';

	this.sapi.createApplication(name, ADMIN_UUID, { uuid: uuid },
	    function (err, app) {
		return (cb(err));
	});
}

function createService(app_uuid, uuid, cb) {
	var name = 'empty_test_service';

	var opts = {};
	opts.params = {};
	opts.params.ram = 256;
	opts.params.networks = [ 'admin' ];
	opts.params.image_uuid = SMARTOS_163_UUID;

	if (arguments.length === 2) {
		cb = uuid;
	} else {
		opts.uuid = uuid;
	}

	this.sapi.createService(name, app_uuid, opts, function (err, svc) {
		return (cb(err));
	});
}

function createConfig(cb) {
	var type = 'json';
	var path = '/opt/smartdc/SERVICE/etc/config.json';
	var template = 'My service template goes here.';

	this.sapi.createConfig(type, path, template, function (err, cfg) {
		return (cb(err, cfg));
	});
}


exports.ADMIN_UUID = ADMIN_UUID;
exports.SMARTOS_163_UUID = SMARTOS_163_UUID;

exports.createApplication = createApplication;
exports.createService = createService;
exports.createConfig = createConfig;
