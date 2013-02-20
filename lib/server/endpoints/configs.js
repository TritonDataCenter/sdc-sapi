/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/configs.js: get zone configurations
 */

function Configs() {}

Configs.get = function (req, res, next) {
	var model = this.model;

	model.getConfig(req.params.uuid, function (err, config) {
		if (err) {
			model.log.error(err, 'failed to get config');
			return (next(err));
		} else if (!config) {
			res.send(404);
		} else {
			res.send(config);
		}

		return (next());
	});
};


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	// Get a manifest
	sapi.get({ path: '/configs/:uuid', name: 'GetConfigs' },
		Configs.get.bind(toModel));
}

exports.attachTo = attachTo;
