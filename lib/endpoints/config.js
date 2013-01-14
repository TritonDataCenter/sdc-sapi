/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/config.js: SAPI endpoints to manage config
 */

var assert = require('assert-plus');

function Config() {}

function isValidConfig(cfg) {
	var valid = true;

	if (!cfg)
		return (false);

	valid = valid && cfg.service;
	valid = valid && cfg.type;
	valid = valid && cfg.path;
	valid = valid && cfg.template;

	if (cfg.type) {
		var type = cfg.type.toLowerCase();

		if (type !== 'text' && type !== 'json')
			valid = false;
	}

	return (valid);
}

Config.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;
	params.service = req.params.service;
	params.type = req.params.type;
	params.path = req.params.path;
	params.template = req.params.template;

	if (!isValidConfig(params)) {
		/* XXX More structured error reporting? */
		log.error({ params: params }, 'missing required fields');
		res.send(409);
		return (next());
	}

	model.createConfig(params, function (err, cfg) {
		if (err) {
			model.log.error(err, 'failed to create config');
			res.send(500);
			return (next());
		}

		res.send(cfg);
		return (next());
	});

	return (null);
};

Config.list = function (req, res, next) {
	var model = this.model;

	model.listConfigs(function (err, cfgs) {
		if (err) {
			res.send(500);
			return (next());
		}

		res.send(cfgs);
		return (next());
	});
};

Config.get = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'req.params.uuid');

	model.getConfig(req.params.uuid, function (err, cfg) {
		if (err)
			res.send(500);
		else if (!cfg)
			res.send(404);
		else
			res.send(cfg);

		return (next());
	});
};

Config.del = function (req, res, next) {
	var model = this.model;

	assert.string(req.params.uuid, 'req.params.uuid');

	model.delConfig(req.params.uuid, function (err) {
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

	// Create a config
	sapi.post({ path: '/config', name: 'CreateConfig' },
		Config.create.bind(toModel));

	// List all configs
	sapi.get({ path: '/config', name: 'ListConfigs' },
		Config.list.bind(toModel));

	// Get a config
	sapi.get({ path: '/config/:uuid', name: 'GetConfig' },
		Config.get.bind(toModel));

	// Delete a config
	sapi.del({ path: '/config/:uuid', name: 'DeleteConfig' },
		Config.del.bind(toModel));
}

exports.attachTo = attachTo;
