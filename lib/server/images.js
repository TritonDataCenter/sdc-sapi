/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/images.js: use IMGAPI to download and install images
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var path = require('path');
var vasync = require('vasync');

var sprintf = require('util').format;

var TMPDIR = '/var/tmp';


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

function downloadImageFile(uuid, file, cb) {
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

function downloadManifest(uuid, manifest, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');
	assert.string(manifest, 'manifest');
	assert.func(cb, 'cb');

	this.remote_imgapi.getImage(uuid, function (err, res) {
		if (err) {
			log.error(err, 'failed to download ' +
			    'image manifest %s', uuid);
			return (cb(err));
		}

		var contents = JSON.stringify(res, null, 4);

		fs.writeFile(manifest, contents, 'ascii', function (suberr) {
			if (suberr) {
				log.error(suberr, 'failed to write manifest %s',
				    manifest);
				return (cb(suberr));
			}

			log.info('downloaded image manifest %s to %s',
			    uuid, manifest);

			return (cb(null));
		});
	});
}

exports.download = function download(uuid, cb) {
	var self = this;

	assert.string(uuid, 'uuid');

	var image = {};
	image.file = path.join(TMPDIR, sprintf('%s.zfs.gz', uuid));
	image.manifest = path.join(TMPDIR, sprintf('%s.zfs.dsmanifest', uuid));

	async.parallel([
		downloadImageFile.bind(self, uuid, image.file),
		downloadManifest.bind(self, uuid, image.manifest)
	], function (err) {
		cb(err, image);
	});
};

exports.importImage = function importImage(image, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	assert.object(image, 'image');
	assert.string(image.manifest, 'image.manifest');

	fs.readFile(image.manifest, 'ascii', function (err, contents) {
		if (err) {
			log.error(err, 'failed to read manifest %s',
			    image.manifest);
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
	});
};

exports.addImageFile = function addImageFile(image, uuid, cb) {
	var imgapi = this.imgapi;
	var log = this.log;

	assert.object(image, 'image');
	assert.string(image.file, 'image.file');

	var file = image.file;

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

	imgapi.addImageFile(options, function (err) {
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

exports.cleanup = function cleanup(image, cb) {
	var log = this.log;

	var files = [];
	Object.keys(image).forEach(function (key) {
		files.push(image[key]);
	});

	log.debug({ files: files }, 'removing files');

	vasync.forEachParallel({
		func: fs.unlink,
		inputs: files
	}, function (err, results) {
		if (err)
			log.warn(err, 'failed to remove image files');
		cb();
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
