/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/images.js: use IMGAPI to download and install images
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var path = require('path');

var sprintf = require('util').format;


exports.get = function get(uuid, cb) {
	var log = this.log;

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
};

function downloadImage(uuid, file, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');
	assert.string(file, 'file');
	assert.func(cb, 'cb');

	this.remote_imgapi.getImageFile(uuid, file, function (err) {
		if (err) {
			log.error(err, 'failed to download image file %s',
			    uuid);
			return (cb(err));
		}

		log.info('downloaded image file %s to %s', uuid, file);

		return (cb(null));
	});
}

function downloadManifest(uuid, file, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');
	assert.string(file, 'file');
	assert.func(cb, 'cb');

	this.remote_imgapi.getImage(uuid, function (err, manifest) {
		if (err) {
			log.error(err, 'failed to download ' +
			    'image manifest %s', uuid);
			return (cb(err));
		}

		var contents = JSON.stringify(manifest, null, 4);

		fs.writeFile(file, contents, 'ascii', function (suberr) {
			if (suberr) {
				log.error(suberr, 'failed to write file %s',
				    file);
				return (cb(suberr));
			}

			log.info('downloaded image manifest %s to %s',
			    uuid, file);

			return (cb(null));
		});

		return (null);
	});
}

exports.download = function download(uuid, cb) {
	var self = this;

	assert.string(uuid, 'uuid');

	var image = path.join('/var/tmp', sprintf('%s.zfs.gz', uuid));
	var manifest = path.join('/var/tmp',
	    sprintf('%s.zfs.dsmanifest', uuid));

	async.parallel([
		downloadImage.bind(self, uuid, image),
		downloadManifest.bind(self, uuid, manifest)
	], function (err) {
		if (err)
			return (cb(err));

		var ret = {};
		ret.image = image;
		ret.manifest = manifest;

		return (cb(null, ret));
	});
};

exports.importImage = function importImage(file, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	fs.readFile(file, 'ascii', function (err, contents) {
		if (err) {
			log.error(err, 'failed to read file %s', file);
			return (cb(err));
		}

		var manifest = JSON.parse(contents);

		manifest.owner = '00000000-0000-0000-0000-000000000000';
		manifest.public = false;

		log.debug({ manifest: manifest }, 'read manifest');

		imgapi.adminImportImage(manifest, function (suberr) {
			if (suberr &&
			    suberr.name === 'ImageUuidAlreadyExistsError') {
				log.warn('image %s already exists',
				    manifest.uuid);
				return (cb(null));
			} else if (suberr) {
				log.error(suberr, 'failed to import image');
				return (cb(suberr));
			}

			log.info('imported image %s successfully',
			    manifest.uuid);

			return (cb(null));
		});

		return (null);
	});
};

exports.addImageFile = function addImageFile(file, uuid, cb) {
	var log = this.log;

	var options = {};
	options.uuid = uuid;
	options.file = file;
	if (file.substr(file.length - 3, 3) === '.gz')
		options.compression = 'gzip';
	else if (file.substr(file.length - 4, 4) === '.bz2')
		options.compression = 'bzip2';
	else
		options.compression = 'none';

	log.info({ options: options }, 'adding image file for %s', uuid);

	this.imgapi.addImageFile(options, function (err) {
		if (err) {
			log.error(err, 'failed to add image file for %s',
			    uuid);
			return (cb(err));
		}

		log.info('added image file for %s', uuid);

		return (cb(null));

	});
};

exports.activate = function activate(uuid, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	imgapi.activateImage(uuid, function (err) {
		if (err) {
			log.error(err, 'failed to activate image %s', uuid);
			return (cb(err));
		}

		log.info('activated image %s', uuid);

		return (cb(null));
	});
};

exports.search = function search(name, cb) {
	var self = this;
	var log = self.log;
	var remote_imgapi = self.remote_imgapi;

	var filters = {};
	filters.name = '~' + name;

	remote_imgapi.listImages(filters, function (err, images) {
		if (err) {
			log.error(err, 'failed to search for images with ' +
			    'name like %s', name);
			return (cb(err));
		}

		log.info({ images: images }, 'found images with name like %s',
		    name);

		return (cb(null, images));
	});
};
