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

	/*
	 * Node's default HTTP timeout is two minutes, and this CreateInstance
	 * request can take longer than that to complete.  Set this connection's
	 * timeout to an hour to avoid an abrupt close after two minutes.
	 *
	 * It can take this long since the provisioner agent downloads and
	 * installed the image from the datacenter's local IMGAPI, and if that
	 * image is compressed with bzip2, it takes roughly six minutes to
	 * decompress 1 GB of that image.
	 */
	req.connection.setTimeout(60 * 60 * 1000);

	log.debug({ 'req.params': req.params }, 'creating instance');

	var params = {};
	params.uuid = req.params.uuid;

	params.service_uuid = req.params.service_uuid;

	params.params = req.params.params;
	params.metadata = req.params.metadata;
	params.manifests = req.params.manifests;

	params.master = req.params.master;

	if (!isValidInstance(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createInstance(params, function (err, inst) {
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

	var filters = {};
	if (req.params.service_uuid)
		filters.service_uuid = req.params.service_uuid;

	var opts = {};
	if (req.params.include_master)
		opts.include_master = true;

	model.listInstances(filters, opts, function (err, insts) {
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
		if (err)
			return (next(err));

		res.send(inst);
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

	model.updateInstance(uuid, changes, action, function (err, inst) {
		if (err) {
			model.log.error(err, 'failed to update instance');
			return (next(err));
		}

		res.send(inst);
		return (next());
	});

	return (null);
};

Instances.upgrade = function (req, res, next) {
	var model = this.model;

	var uuid = req.params.uuid;
	var image_uuid = req.params.image_uuid;

	if (!image_uuid) {
		return (next(new restify.MissingParameterError(
		    'missing image_uuid')));
	}

	model.upgradeInstance(uuid, image_uuid, function (err, inst) {
		if (err) {
			model.log.error(err, 'failed to upgrade instance');
			return (next(err));
		}

		res.send(inst);
		return (next());
	});
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

	// Upgrade an instance
	sapi.put({
	    path: '/instances/:uuid/upgrade',
	    name: 'UpgradeInstance' },
	Instances.upgrade.bind(toModel));

	// Delete an instance
	sapi.del({ path: '/instances/:uuid', name: 'DeleteInstance' },
	    Instances.del.bind(toModel));
}

exports.attachTo = attachTo;
