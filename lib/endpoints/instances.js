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
	params.name = req.params.name;
	params.uuid = req.params.uuid;
	params.service_uuid = req.params.service_uuid;
	params.params = req.params.params;

	if (!isValidInstance(params)) {
		/* XXX More structured error reporting? */
		log.error({ params: params }, 'missing required fields');
		res.send(409);
		return (next());
	}

	async.waterfall([
		function (cb) {
			model.createInstance(params, function (err, instance) {
				if (err)
					cb(err);
				else
					cb(null, instance);
			});

		},
		function (instance, cb) {
			model.deployInstance(instance, function (err) {
				if (err)
					cb(err);
				else
					cb(null, instance);
			});
		}
	], function (err, instance) {
		if (err) {
			log.error(err, 'failed to create instance');
			res.send(500);
			return (next());
		}

		res.send(instance);
		return (next());
	});

	return (null);
};

Instances.list = function (req, res, next) {
	var model = this.model;

	model.listInstances(function (err, instances) {
		if (err) {
			res.send(500);
			return (next());
		}

		res.send(instances);
		return (next());
	});
};

Instances.get = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.instance_uuid, 'req.params.instance_uuid');

	model.getInstance(req.params.instance_uuid, function (err, instance) {
		if (err)
			res.send(500);
		else if (!instance)
			res.send(404);
		else
			res.send(instance);

		return (next());
	});
};

Instances.del = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.instance_uuid, 'req.params.instance_uuid');

	model.delInstance(req.params.instance_uuid, function (err) {
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

	// Create an instance
	sapi.post({
	    path: '/instances',
	    name: 'CreateInstance'
	}, Instances.create.bind(toModel));

	// List all instances
	sapi.get({
	    path: '/instances',
	    name: 'ListInstances'
	}, Instances.list.bind(toModel));

	// Get an instance
	sapi.get({
	    path: '/instances/:instance_uuid',
	    name: 'GetInstance'
	}, Instances.get.bind(toModel));

	// Delete an instance
	sapi.del({
	    path: '/instances/:instance_uuid',
	    name: 'DeleteInstance'
	}, Instances.del.bind(toModel));
}

exports.attachTo = attachTo;
