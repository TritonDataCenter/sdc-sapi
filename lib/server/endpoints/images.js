/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/endpoints/server/images.js: SAPI endpoints to manage images
 */

var restify = require('restify');

function Images() {}

Images.download = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	/*
	 * Node's default HTTP timeout is two minutes, and this DownloadImage
	 * request can take longer than that to complete.  Set this connection's
	 * timeout to an hour to avoid an abrupt close after two minutes.
	 */
	req.connection.setTimeout(60 * 60 * 1000);

	var opts = {};
	if (req.params.skipOwnerCheck)
		opts.skipOwnerCheck = true;

	model.downloadImage(req.params.uuid, opts, function (err) {
		if (err) {
			log.error(err, 'failed to download image');
			return (next(err));
		}

		res.send(204);
		return (next());

	});

	return (null);
};

Images.search = function (req, res, next) {
	var model = this.model;
	var log = model.log;

	var name = req.params.name;

	if (!name) {
		log.error('missing "name" parameter');
		return (next(new restify.MissingParameterError()));
	}

	var search_opts = {};
	search_opts.name = name;
	if (req.params.version)
		search_opts.version = req.params.version;

	model.searchImages(search_opts, function (err, images) {
		if (err)
			return (next(err));

		res.send(images);
		return (next());
	});

	return (null);
};


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	// Download an image
	sapi.post({ path: '/images/:uuid', name: 'DownloadImage' },
		Images.download.bind(toModel));

	// Search for images
	sapi.get({ path: '/images', name: 'SearchImages' },
		Images.search.bind(toModel));
}

exports.attachTo = attachTo;
