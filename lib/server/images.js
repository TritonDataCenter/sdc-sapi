/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/images.js: use IMGAPI to download and install images
 */

var assert = require('assert-plus');
var async = require('async');
var common = require('./common');
var fs = require('fs');
var path = require('path');
var vasync = require('vasync');

var sprintf = require('util').format;

var mod_errors = require('./errors');


exports.search = function search(search_opts, cb) {
	var self = this;
	var log = self.log;

	assert.object(search_opts, 'search_opts');
	assert.string(search_opts.name, 'search_opts.name');
	assert.func(cb, 'cb');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	var filters = {};
	filters.name = '~' + search_opts.name;
	if (search_opts.version)
		filters.version = '~' + search_opts.version;

	log.info({ filters: filters }, 'search for images');

	this.remote_imgapi.listImages(filters, function (err, images) {
		if (err) {
			log.error(err, 'failed to search for images with ' +
			    'name like %s', search_opts.name);
			return (cb(err));
		}

		log.info('found %d images with name like %s',
		    images.length, search_opts.name);
		log.debug({ images: images }, 'images with name like %s',
		    search_opts.name);

		return (cb(null, images));
	});

	return (null);
};
