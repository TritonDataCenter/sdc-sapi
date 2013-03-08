/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/instances.js: SAPI endpoints to manage instances
 */

var assert = require('assert-plus');
var async = require('async');
var restify = require('restify');

function Instances() {}

function isValidInstance(instance) {
	var valid = true;

	if (!instance)
		return (false);

	valid = valid && instance.service_uuid;

	return (valid);
}

Instances.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	log.debug({ 'req.params': req.params }, 'creating instance');

	var params = {};
	params.uuid = req.params.uuid;

	params.service_uuid = req.params.service_uuid;

	params.params = req.params.params;
	params.metadata = req.params.metadata;
	params.manifests = req.params.manifests;

	/*
	 * The 'wait' option waits for the zone provision to complete before
	 * returning.
	 */
	var wait = req.params.wait ? true : false;

	if (!isValidInstance(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createInstance(params, wait, function (err, inst) {
		if (err) {
			log.error(err, 'failed to create instance');
			return (next(err));
		}

		res.send(inst);
		return (next());
	});
};


Instances.list = function (req, res, next) {
	var model = this.model;

	var search_opts = {};
	if (req.params.service_uuid)
		search_opts.service_uuid = req.params.service_uuid;

	model.listInstances(search_opts, function (err, insts) {
		if (err) {
			model.log.error(err, 'failed to list instances');
			return (next(err));
		}

		res.send(insts);
		return (next());
	});
};

Instances.get = function (req, res, next) {
	var model = this.model;

	model.getInstance(req.params.uuid, function (err, inst) {
		if (err) {
			model.log.error(err, 'failed to get instance');
			return (next(err));
		} else if (!inst) {
			res.send(404);
		} else {
			res.send(inst);
		}

		return (next());
	});
};

Instances.getPayload = function (req, res, next) {
	var model = this.model;

	model.getInstancePayload(req.params.uuid, function (err, params) {
		if (err) {
			model.log.error(err, 'failed to get instance payload');
			return (next(err));
		} else if (!params) {
			res.send(404);
		} else {
			res.send(params);
		}

		return (next());
	});
};

Instances.update = function (req, res, next) {
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

	model.updateInstance(uuid, changes, action, function (err, svc) {
		if (err) {
			model.log.error(err, 'failed to update instance');
			return (next(err));
		}

		res.send(svc);
		return (next());
	});

	return (null);
};

Instances.del = function (req, res, next) {
	var model = this.model;

	model.delInstance(req.params.uuid, function (err) {
		if (err && err.name === 'ObjectNotFoundError') {
			res.send(404);
			return (next());
		} else if (err) {
			model.log.error(err, 'failed to delete instance');
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

	// Create an instance
	sapi.post({ path: '/instances', name: 'CreateInstance' },
	    Instances.create.bind(toModel));

	// List all instances
	sapi.get({ path: '/instances', name: 'ListInstances' },
	    Instances.list.bind(toModel));

	// Get an instance
	sapi.get({ path: '/instances/:uuid', name: 'GetInstance' },
	    Instances.get.bind(toModel));

	// Get an instance's payload
	sapi.get({
	    path: '/instances/:uuid/payload',
	    name: 'GetInstancePayload'
	}, Instances.getPayload.bind(toModel));

	// Update an instance
	sapi.put({ path: '/instances/:uuid', name: 'UpdateInstance' },
		Instances.update.bind(toModel));

	// Delete an instance
	sapi.del({ path: '/instances/:uuid', name: 'DeleteInstance' },
	    Instances.del.bind(toModel));
}

exports.attachTo = attachTo;
