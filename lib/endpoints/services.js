/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/services.js: SAPI endpoints to manage services
 */

var assert = require('assert-plus');

function Services() {}

function isValidService(app) {
	var valid = true;

	if (!app)
		return (false);

	valid = valid && app.name;
	valid = valid && app.application_uuid;
	valid = valid && app.image_uuid;
	valid = valid && app.ram;
	valid = valid && app.networks;

	return (valid);
}

Services.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.name = req.params.name;
	params.uuid = req.params.uuid;
	params.application_uuid = req.params.application_uuid;
	params.image_uuid = req.params.image_uuid;
	params.ram = req.params.ram;
	params.networks = req.params.networks;

	params.params = req.params.params;

	if (!isValidService(params)) {
		/* XXX More structured error reporting? */
		log.error({ params: params }, 'missing required fields');
		res.send(409);
		return (next());
	}

	model.createService(params, function (err, service) {
		if (err) {
			model.log.error(err, 'failed to create service');
			res.send(500);
			return (next());
		}

		res.send(service);
		return (next());
	});

	return (null);
};

Services.list = function (req, res, next) {
	var model = this.model;

	model.listServices(function (err, apps) {
		if (err) {
			res.send(500);
			return (next());
		}

		res.send(apps);
		return (next());
	});
};

Services.get = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'uuid');

	model.getService(req.params.uuid, function (err, app) {
		if (err)
			res.send(500);
		else if (!app)
			res.send(404);
		else
			res.send(app);

		return (next());
	});
};

Services.del = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'uuid');

	model.delService(req.params.uuid, function (err) {
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

	// Create a service
	sapi.post({ path: '/services', name: 'CreateService' },
		Services.create.bind(toModel));

	// List all services
	sapi.get({ path: '/services', name: 'ListServices' },
		Services.list.bind(toModel));

	// Get a service
	sapi.get({ path: '/services/:uuid', name: 'GetService' },
		Services.get.bind(toModel));

	// Delete a service
	sapi.del({ path: '/services/:uuid', name: 'DeleteService' },
		Services.del.bind(toModel));
}

exports.attachTo = attachTo;
