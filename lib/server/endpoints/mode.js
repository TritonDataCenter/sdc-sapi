/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/mode.js: get or set SAPI mode
 */

var restify = require('restify');

function Mode() {}

Mode.get = function (req, res, next) {
	var model = this.model;

	model.getMode(function (err, mode) {
		if (err) {
			model.log.error(err, 'failed to get config');
			return (next(err));
		}

		res.send(mode);
		return (next());
	});
};

Mode.set = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var mode = req.params.mode;

	if (!mode) {
		log.error('missing "mode" parameter');
		return (next(new restify.MissingParameterError()));
	}

	model.setMode(mode, function (err) {
		if (err) {
			log.error(err, 'failed to set mode');
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

	// Get mode
	sapi.get({ path: '/mode', name: 'GetMode' },
		Mode.get.bind(toModel));

	// Change mode
	sapi.post({ path: '/mode', name: 'SetMode' },
		Mode.set.bind(toModel));
}

exports.attachTo = attachTo;
