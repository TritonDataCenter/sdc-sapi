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

	return (valid);
}

Services.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;

	params.name = req.params.name;
	params.application_uuid = req.params.application_uuid;

	params.params = req.params.params;
	params.metadata = req.params.metadata;
	params.configs = req.params.configs;

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

Services.update = function (req, res, next) {
	var model = this.model;

	var uuid = req.params.uuid;

	var changes = {};
	changes.params = req.params.params;
	changes.metadata = req.params.metadata;
	changes.configs = req.params.configs;

	/*
	 * If not specified, the default action is to update existing
	 * attributes.
	 */
	if (!req.params.action)
		req.params.action = 'update';

	var action = req.params.action.toLowerCase();

	if (action !== 'update' &&
	    action !== 'replace' &&
	    action !== 'delete') {
		model.log.error({ action: action }, 'invalid action');
		return (next(new restify.InvalidArgumentError()));
	}

	model.updateService(uuid, changes, action, function (err, svc) {
		if (err) {
			model.log.error(err, 'failed to update service');
			return (next(err));
		}

		res.send(svc);
		return (next());
	});

	return (null);
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

	// Update a service
	sapi.put({ path: '/services/:uuid', name: 'UpdateService' },
		Services.update.bind(toModel));

	// Delete a service
	sapi.del({ path: '/services/:uuid', name: 'DeleteService' },
		Services.del.bind(toModel));
}

exports.attachTo = attachTo;
