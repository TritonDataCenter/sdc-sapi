/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/applications.js: SAPI endpoints to manage applications
 */

var assert = require('assert-plus');
var restify = require('restify');

function Applications() {}

function isValidApplication(app) {
	var valid = true;

	if (!app)
		return (false);

	valid = valid && app.name;
	valid = valid && app.owner_uuid;

	return (valid);
}

Applications.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.name = req.params.name;
	params.uuid = req.params.uuid;
	params.owner_uuid = req.params.owner_uuid;
	params.params = req.params.params;

	if (!isValidApplication(params)) {
		/* XXX More structured error reporting? */
		log.error({ params: params }, 'missing required fields');
		res.send(409);
		return (next());
	}

	model.createApplication(params, function (err, app) {
		if (err) {
			model.log.error(err, 'failed to create share');
			res.send(500);
			return (next());
		}

		res.send(app);
		return (next());
	});

	return (null);
};

Applications.list = function (req, res, next) {
	var model = this.model;

	model.listApplications(function (err, apps) {
		if (err) {
			res.send(500);
			return (next());
		}

		res.send(apps);
		return (next());
	});
};

Applications.get = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'req.params.uuid');

	model.getApplication(req.params.uuid, function (err, app) {
		if (err)
			res.send(500);
		else if (!app)
			res.send(404);
		else
			res.send(app);

		return (next());
	});
};

Applications.del = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'req.params.uuid');

	model.delApplication(req.params.uuid, function (err) {
		if (err) {
			// XXX Correct error code?
			res.send(404);
			return (next());
		}

		res.send(204);
		return (next());
	});
};


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	// Create an application
	sapi.post({ path: '/applications', name: 'CreateApplication' },
		Applications.create.bind(toModel));

	// List all applications
	sapi.get({ path: '/applications', name: 'ListApplications' },
		Applications.list.bind(toModel));

	// Get an application
	sapi.get({ path: '/applications/:uuid', name: 'GetApplication' },
		Applications.get.bind(toModel));

	// Delete an application
	sapi.del({ path: '/applications/:uuid', name: 'DeleteApplication' },
		Applications.del.bind(toModel));
}

exports.attachTo = attachTo;
