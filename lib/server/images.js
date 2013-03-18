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


var TMPDIR = '/var/tmp';


exports.get = function get(uuid, cb) {
	var log = this.log;

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	this.imgapi.getImage(uuid, function (err, image) {
		if (err && err.name === 'ResourceNotFoundError') {
			log.warn('image %s doesn\'t exist', uuid);
			image = null;
		} else if (err) {
			log.error(err, 'failed to get image %s', uuid);
			return (cb(err));
		} else {
			log.debug({ image: image },
			    'retrieved image details for %s', uuid);
		}

		return (cb(null, image));
	});

	return (null);
};

function downloadImageFile(uuid, file, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');
	assert.string(file, 'file');
	assert.func(cb, 'cb');

	assert.equal(this.mode, common.FULL_MODE);

	this.remote_imgapi.getImageFile(uuid, file, function (err) {
		if (err) {
			log.error(err, 'failed to download image file %s',
			    uuid);
			return (cb(err));
		}

		log.info('downloaded image file %s to %s', uuid, file);

		return (cb(null));
	});

	return (null);
}

function downloadImageManifest(uuid, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	assert.equal(this.mode, common.FULL_MODE);

	this.remote_imgapi.getImage(uuid, function (err, manifest) {
		if (err) {
			log.error(err, 'failed to download ' +
			    'image manifest %s', uuid);
			return (cb(err));
		}

		log.debug({ manifest: manifest },
		    'downloaded manifest for %s', uuid);

		return (cb(null, manifest));
	});

	return (null);
}

exports.download = function download(uuid, cb) {
	var self = this;

	assert.string(uuid, 'uuid');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	var image = {};
	image.file = path.join(TMPDIR, sprintf('%s.zfs', uuid));

	async.waterfall([
		function (subcb) {
			downloadImageManifest.call(self, uuid,
			    function (err, manifest) {
				if (err)
					return (subcb(err));

				image.manifest = manifest;
				subcb();
			});
		},
		function (subcb) {
			downloadImageFile.call(self, uuid, image.file, subcb);
		}
	], function (err) {
		cb(err, image);
	});

	return (null);
};

exports.importImage = function importImage(image, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	assert.object(image, 'image');
	assert.object(image.manifest, 'image.manifest');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	var manifest = image.manifest;

	manifest.owner = '00000000-0000-0000-0000-000000000000';
	manifest.public = false;

	imgapi.adminImportImage(manifest, function (err) {
		if (err && err.name === 'ImageUuidAlreadyExistsError') {
			log.warn('image %s already exists',
			    manifest.uuid);
			return (cb(null));
		} else if (err) {
			log.error(err, 'failed to import image');
			return (cb(err));
		}

		log.info('imported image %s successfully',
		    manifest.uuid);

		return (cb(null));
	});

	return (null);
};

exports.addImageFile = function addImageFile(image, uuid, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	assert.object(image, 'image');
	assert.string(image.file, 'image.file');
	assert.object(image.manifest, 'image.manifest');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	var options = {};
	options.uuid = uuid;
	options.file = image.file;

	if (image.manifest.files &&
	    image.manifest.files.length > 0 &&
	    image.manifest.files[0].compression)
		options.compression = image.manifest.files[0].compression;
	else
		options.compression = 'none';

	log.info({ options: options }, 'adding image file for %s', uuid);

	imgapi.addImageFile(options, function (err) {
		if (err) {
			log.error(err, 'failed to add image file for %s',
			    uuid);
			return (cb(err));
		}

		log.info('added image file for %s', uuid);

		return (cb(null));
	});

	return (null);
};

exports.activate = function activate(uuid, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	imgapi.activateImage(uuid, function (err) {
		if (err) {
			log.error(err, 'failed to activate image %s', uuid);
			return (cb(err));
		}

		log.info('activated image %s', uuid);

		return (cb(null));
	});

	return (null);
};

exports.cleanup = function cleanup(image, cb) {
	var log = this.log;

	assert.object(image, 'image');
	assert.string(image.file, 'image.file');
	assert.func(cb, 'cb');

	fs.unlink(image.file, function (err) {
		if (err)
			log.warn(err, 'failed to remove image file');
		cb();
	});
};

exports.search = function search(name, cb) {
	var self = this;
	var log = self.log;

	assert.string(name, 'name');
	assert.func(cb, 'cb');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'IMGAPI not available in proto mode')));
	}

	var filters = {};
	filters.name = '~' + name;

	this.remote_imgapi.listImages(filters, function (err, images) {
		if (err) {
			log.error(err, 'failed to search for images with ' +
			    'name like %s', name);
			return (cb(err));
		}

		log.info({ images: images }, 'found images with name like %s',
		    name);

		return (cb(null, images));
	});

	return (null);
};
