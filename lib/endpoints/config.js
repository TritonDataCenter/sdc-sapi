/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/config.js: SAPI endpoints to manage config
 */

var assert = require('assert-plus');
var restify = require('restify');

function Config() {}

function isValidConfig(cfg) {
	var valid = true;

	if (!cfg)
		return (false);

	valid = valid && cfg.name;
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
	params.name = req.params.name;
	params.type = req.params.type;
	params.path = req.params.path;
	params.template = req.params.template;

	if (!isValidConfig(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createConfig(params, function (err, cfg) {
		if (err) {
			model.log.error(err, 'failed to create config');
			return (next(err));
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
			model.log.error(err, 'failed to list configs');
			return (next(err));
		}

		res.send(cfgs);
		return (next());
	});
};

Config.get = function (req, res, next) {
	var model = this.model;

	model.getConfig(req.params.uuid, function (err, cfg) {
		if (err) {
			model.log.error(err, 'failed to get config');
			return (next(err));
		} else if (!cfg) {
			res.send(404);
		} else {
			res.send(cfg);
		}

		return (next());
	});
};

Config.del = function (req, res, next) {
	var model = this.model;

	model.delConfig(req.params.uuid, function (err) {
		if (err && err.name === 'ObjectNotFoundError') {
			res.send(404);
			return (next());
		} else if (err) {
			model.log.error(err, 'failed to delete config');
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
