/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/mode.js: get or set SAPI mode
 */

var restify = require('restify');


function Mode() {}

Mode.get = function (req, res, next) {
	var model = this.model;

	model.isProtoMode(function (err, proto_mode) {
		if (err) {
			model.log.error(err, 'failed to get mode');
			return (next(err));
		}

		res.send(proto_mode ? 'proto' : 'full');
		return (next());
	});
};

Mode.set = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var mode = req.params.mode;

	if (!mode) {
		return (next(new restify.MissingParameterError(
		    'missing "mode" parameter')));
	} else if (mode !== 'full') {
		return (next(new restify.InvalidArgumentError(
		    'invalid mode: ' + mode)));
	}

	model.upgradeToFullMode(function (err) {
		if (err) {
			log.error(err, 'failed to upgrade to full mode');
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

	sapi.get({ path: '/mode', name: 'GetMode' },
		Mode.get.bind(toModel));
	sapi.post({ path: '/mode', name: 'SetMode' },
		Mode.set.bind(toModel));
}

exports.attachTo = attachTo;
