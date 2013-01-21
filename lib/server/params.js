/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/params.js: manage VM params
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');


/*
 * Assemble a zone's parameters from its associated application, service, and
 * instance.  The zone's parameters are determined first by the parameters of
 * its application, then by the parameters of its service, and finally by the
 * parameters of its instance.
 */
module.exports.assemble = function assemble(app, svc, inst) {
	var self = this;
	var log = self.log;

	var params = {};

	if (app.params) {
		Object.keys(app.params).forEach(function (key) {
			params[key] = app.params[key];
		});
	}

	if (svc.params) {
		Object.keys(svc.params).forEach(function (key) {
			params[key] = svc.params[key];
		});
	}

	if (inst.params) {
		Object.keys(inst.params).forEach(function (key) {
			params[key] = inst.params[key];
		});
	}

	/*
	 * No matter what, the owner_uuid is the owner_uuid associated with the
	 * application, even if specified in the service's or instance's params.
	 */
	assert.string(app.owner_uuid, 'app.owner_uuid');
	params.owner_uuid = app.owner_uuid;

	log.info({ params: params }, 'assembled parameters for zone');

	return (params);
};
