/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/endpoints/manifests.js: SAPI endpoints to manage configuration
 *     manifests
 */

var assert = require('assert-plus');
var restify = require('restify');
var semver = require('semver');

function Manifests() {}

function isValidManifest(mfest) {
	var valid = true;

	if (!mfest)
		return (false);

	valid = valid && mfest.name;
	valid = valid && mfest.path;
	valid = valid && mfest.template;

	return (valid);
}

Manifests.create = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var params = {};
	params.uuid = req.params.uuid;

	params.name = req.params.name;
	params.path = req.params.path;
	params.template = req.params.template;
	params.post_cmd = req.params.post_cmd;
	params.version = req.params.version;

	params.master = req.params.master;

	if (!isValidManifest(params)) {
		log.error({ params: params }, 'missing required parameters');
		return (next(new restify.MissingParameterError()));
	}

	if (params.version && !semver.valid(params.version)) {
		log.error({ version: params.version }, 'invalid version');
		return (next(new restify.InvalidArgumentError(
		    'invalid version')));
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

	var opts = {};
	if (req.params.include_master)
		opts.include_master = true;

	model.listManifests(opts, function (err, mfests) {
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
		if (err)
			return (next(err));

		res.send(mfest);
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
