/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/configs.js: get zone configurations
 */

var crypto = require('crypto');
var restify = require('restify');

function flatten(obj, prevKey, vals) {
	if (!vals) vals = [];
	var newKey;

	if (Array.isArray(obj)) {
		obj.map(function (val) {
			newKey = (prevKey === '' ? '' : prevKey);
			return (flatten(val, newKey, vals));
		});
	} else if (typeof (obj) === 'object') {
		for (var key in obj) {
			newKey = (prevKey === '' ? key :
			    [prevKey, key].join(','));
			flatten(obj[key], newKey, vals);
		}
	} else {
		vals.push([prevKey, obj.toString()].join(','));
	}
}

// [ { foo: 'bar' }, 'arr': [1, 2, 3] ]
// ->  [ 'foo,bar', 'arr,1', 'arr,2', 'arr,3' ]
function flatConfig(config) {
	var vals = [];
	flatten(config, '', vals);
	vals.sort();
	return (vals);
}

function Configs() {}

Configs.get = function (req, res, next) {
	var model = this.model;

	model.getConfig(req.params.uuid, function (err, config) {
		if (err) {
			model.log.error(err, 'failed to get config');
			return (next(err));
		} else if (!config) {
			res.send(404);
			return (next(false));
		} else {
			var shasum = crypto.createHash('sha1');
			var flat = flatConfig(config);
			var sha1 = shasum.update(JSON.stringify(flat), 'utf8').
						digest('hex');

			res.etag = sha1;
			res.header('Etag', sha1);
			req.config = config;
			return (next());
		}
	});
};

// Allows us to first check the conditional request and then respond with the
// config object when the etag conditions don't match
function configResponse(req, res, next) {
	res.send(req.config);
	return (next());
}


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	// Get a manifest
	sapi.get({ path: '/configs/:uuid', name: 'GetConfigs' },
		Configs.get.bind(toModel),
		restify.conditionalRequest(),
		configResponse);
}

exports.attachTo = attachTo;
