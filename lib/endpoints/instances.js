/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/instances.js: SAPI endpoints to manage instances
 */

var assert = require('assert-plus');
var async = require('async');
var restify = require('restify');

function Instances() {}

function isValidInstance(instance) {
	var valid = true;

	if (!instance)
		return (false);

	valid = valid && instance.name;
	valid = valid && instance.service_uuid;

	return (valid);
}

Instances.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;

	params.name = req.params.name;
	params.service_uuid = req.params.service_uuid;

	params.params = req.params.params;
	params.metadata = req.params.metadata;
	params.configs = req.params.configs;

	if (!isValidInstance(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	async.waterfall([
		function (cb) {
			model.createInstance(params, function (err, inst) {
				if (err)
					cb(err);
				else
					cb(null, inst);
			});

		},
		function (inst, cb) {
			model.deployInstance(inst, function (err) {
				if (err)
					cb(err);
				else
					cb(null, inst);
			});
		}
	], function (err, inst) {
		if (err) {
			log.error(err, 'failed to create instance');
			return (next(err));
		}

		res.send(inst);
		return (next());
	});

	return (null);
};

Instances.list = function (req, res, next) {
	var model = this.model;

	model.listInstances(function (err, insts) {
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

	// Delete an instance
	sapi.del({ path: '/instances/:uuid', name: 'DeleteInstance' },
	    Instances.del.bind(toModel));
}

exports.attachTo = attachTo;
