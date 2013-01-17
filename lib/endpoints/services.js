/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/services.js: SAPI endpoints to manage services
 */

var assert = require('assert-plus');
var restify = require('restify');

function Services() {}

function isValidService(svc) {
	var valid = true;

	if (!svc)
		return (false);

	valid = valid && svc.name;
	valid = valid && svc.application_uuid;
	valid = valid && svc.image_uuid;
	valid = valid && svc.ram;
	valid = valid && svc.networks;

	return (valid);
}

Services.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;

	params.name = req.params.name;
	params.application_uuid = req.params.application_uuid;
	params.image_uuid = req.params.image_uuid;
	params.ram = req.params.ram;
	params.networks = req.params.networks;

	params.params = req.params.params;
	params.metadata = req.params.metadata;

	if (!isValidService(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createService(params, function (err, svc) {
		if (err) {
			model.log.error(err, 'failed to create service');
			return (next(err));
		}

		res.send(svc);
		return (next());
	});

	return (null);
};

Services.list = function (req, res, next) {
	var model = this.model;

	model.listServices(function (err, svcs) {
		if (err) {
			model.log.error(err, 'failed to list services');
			return (next(err));
		}

		res.send(svcs);
		return (next());
	});
};

Services.get = function (req, res, next) {
	var model = this.model;

	model.getService(req.params.uuid, function (err, svc) {
		if (err) {
			model.log.error(err, 'failed to get service');
			return (next(err));
		} else if (!svc) {
			res.send(404);
		} else {
			res.send(svc);
		}

		return (next());
	});
};

Services.del = function (req, res, next) {
	var model = this.model;

	model.delService(req.params.uuid, function (err) {
		if (err && err.name === 'ObjectNotFoundError') {
			res.send(404);
			return (next());
		} else if (err) {
			model.log.error(err, 'failed to delete service');
			return (next(err));
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
