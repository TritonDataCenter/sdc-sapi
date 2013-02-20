/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/endpoints/manifests.js: SAPI endpoints to manage configuration
 *     manifests
 */

var assert = require('assert-plus');
var restify = require('restify');

function Manifests() {}

function isValidManifest(mfest) {
	var valid = true;

	if (!mfest)
		return (false);

	valid = valid && mfest.name;
	valid = valid && mfest.type;
	valid = valid && mfest.path;
	valid = valid && mfest.template;

	if (mfest.type) {
		var type = mfest.type.toLowerCase();

		if (type !== 'text' && type !== 'json')
			valid = false;
	}

	return (valid);
}

Manifests.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;

	params.service = req.params.service;
	params.name = req.params.name;
	params.type = req.params.type;
	params.path = req.params.path;
	params.template = req.params.template;

	if (!isValidManifest(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	model.createManifest(params, function (err, mfest) {
		if (err) {
			model.log.error(err, 'failed to create manifest');
			return (next(err));
		}

		res.send(mfest);
		return (next());
	});

	return (null);
};

Manifests.list = function (req, res, next) {
	var model = this.model;

	model.listManifests(function (err, mfests) {
		if (err) {
			model.log.error(err, 'failed to list manifests');
			return (next(err));
		}

		res.send(mfests);
		return (next());
	});
};

Manifests.get = function (req, res, next) {
	var model = this.model;

	model.getManifest(req.params.uuid, function (err, mfest) {
		if (err) {
			model.log.error(err, 'failed to get manifest');
			return (next(err));
		} else if (!mfest) {
			res.send(404);
		} else {
			res.send(mfest);
		}

		return (next());
	});
};

Manifests.del = function (req, res, next) {
	var model = this.model;

	model.delManifest(req.params.uuid, function (err) {
		if (err && err.name === 'ObjectNotFoundError') {
			res.send(404);
			return (next());
		} else if (err) {
			model.log.error(err, 'failed to delete manifest');
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

	// Create a manifest
	sapi.post({ path: '/manifests', name: 'CreateManifest' },
		Manifests.create.bind(toModel));

	// List all manifests
	sapi.get({ path: '/manifests', name: 'ListManifests' },
		Manifests.list.bind(toModel));

	// Get a manifest
	sapi.get({ path: '/manifests/:uuid', name: 'GetManifest' },
		Manifests.get.bind(toModel));

	// Delete a manifest
	sapi.del({ path: '/manifests/:uuid', name: 'DeleteManifest' },
		Manifests.del.bind(toModel));
}

exports.attachTo = attachTo;
