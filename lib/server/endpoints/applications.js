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
	params.uuid = req.params.uuid;

	params.name = req.params.name;
	params.owner_uuid = req.params.owner_uuid;

	params.params = req.params.params;
	params.metadata = req.params.metadata;
	params.manifests = req.params.manifests;

	params.master = req.params.master;

	if (!isValidApplication(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createApplication(params, function (err, app) {
		if (err) {
			model.log.error(err, 'failed to create application');
			return (next(err));
		}

		res.send(app);
		return (next());
	});

	return (null);
};

Applications.list = function (req, res, next) {
	var model = this.model;

	var filters = {};
	if (req.params.name)
		filters.name = req.params.name;
	if (req.params.owner_uuid)
		filters.owner_uuid = req.params.owner_uuid;

	var opts = {};
	if (req.params.include_master)
		opts.include_master = true;

	model.listApplications(filters, opts, function (err, apps) {
		if (err) {
			model.log.error(err, 'failed to list applications');
			return (next(err));
		}

		res.send(apps);
		return (next());
	});
};

Applications.get = function (req, res, next) {
	var model = this.model;

	model.getApplication(req.params.uuid, function (err, app) {
		if (err)
			return (next(err));
		res.send(app);
		return (next());
	});
};

Applications.update = function (req, res, next) {
	var model = this.model;

	var uuid = req.params.uuid;

	var changes = {};
	changes.params = req.params.params;
	changes.metadata = req.params.metadata;
	changes.manifests = req.params.manifests;

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

	model.updateApplication(uuid, changes, action, function (err, app) {
		if (err) {
			model.log.error(err, 'failed to update application');
			return (next(err));
		}

		res.send(app);
		return (next());
	});

	return (null);
};

Applications.del = function (req, res, next) {
	var model = this.model;

	model.delApplication(req.params.uuid, function (err) {
		if (err && err.name === 'ObjectNotFoundError') {
			res.send(404);
			return (next());
		} else if (err) {
			model.log.error(err, 'failed to delete application');
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

	// Create an application
	sapi.post({ path: '/applications', name: 'CreateApplication' },
		Applications.create.bind(toModel));

	// List all applications
	sapi.get({ path: '/applications', name: 'ListApplications' },
		Applications.list.bind(toModel));

	// Get an application
	sapi.get({ path: '/applications/:uuid', name: 'GetApplication' },
		Applications.get.bind(toModel));

	// Update an application
	sapi.put({ path: '/applications/:uuid', name: 'UpdateApplication' },
		Applications.update.bind(toModel));

	// Delete an application
	sapi.del({ path: '/applications/:uuid', name: 'DeleteApplication' },
		Applications.del.bind(toModel));
}

exports.attachTo = attachTo;
