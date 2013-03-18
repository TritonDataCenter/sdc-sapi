/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/stor/moray.js: moray interface
 */

var async = require('async');
var assert = require('assert-plus');
var jsprim = require('jsprim');
var ldapjs = require('ldapjs');
var moray = require('moray');

var mod_errors = require('../errors');

var sprintf = require('util').format;


module.exports = MorayStorage;

function MorayStorage(config) {
	var self = this;

	assert.object(config, 'config');
	assert.object(config.moray, 'config.moray');
	assert.object(config.log, 'config.log');
	assert.object(config.buckets, 'config.buckets');

	self.config = config.moray;
	self.log = config.log;
	self.buckets = config.buckets;
}

MorayStorage.prototype.init = function init(cb) {
	var self = this;

	self.moray = moray.createClient(self.config);

	self.moray.on('connect', function () {
		initBuckets.call(self, cb);
	});
};


// -- Bucket operations

function initBuckets(cb) {
	var self = this;
	var buckets = self.buckets;

	var basecfg = {
		index: {
			uuid: {
				type: 'string',
				unique: true
			}
		}
	};

	async.waterfall([
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.name = {
				type: 'string'
			};
			cfg.index.owner_uuid = {
				type: 'string'
			};

			createBucket.call(self, buckets.applications,
			    basecfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.name = {
				type: 'string'
			};
			cfg.index.application_uuid = {
				type: 'string'
			};

			createBucket.call(self, buckets.services,
			    cfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.service_uuid = {
				type: 'string'
			};

			createBucket.call(self, buckets.instances,
			    cfg, subcb);
		},
		function (subcb) {
			createBucket.call(self, buckets.manifests,
			    basecfg, subcb);
		}
	], cb);
}

function createBucket(name, cfg, cb) {
	var self = this;
	var log = self.log;

	self.moray.getBucket(name, function (err, bucket) {
		if (!err)
			return (cb(null));

		if (err && err.name !== 'BucketNotFoundError') {
			log.error(err, 'failed to get bucket %s', name);
			return (cb(err));
		}

		self.moray.createBucket(name, cfg, function (suberr) {
			if (suberr) {
				log.error(suberr,
				    'failed to create bucket %s', name);
				return (cb(
				    new Error('failed to create bucket')));
			}

			log.info('created bucket %s', name);

			return (cb(null));
		});

		return (null);
	});
}


// -- Object operations

MorayStorage.prototype.putObject = putObject;

function putObject(bucket, uuid, obj, opts, cb) {
	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.object(obj, 'obj');

	if (arguments.length === 4) {
		cb = opts;
		opts = {};
	}

	this.moray.putObject(bucket, uuid, obj, opts, cb);
}

MorayStorage.prototype.getObject = function getObject(bucket, uuid, cb) {
	var log = this.log;

	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	var filter = sprintf('(uuid=%s)', uuid);

	findObjects.call(this, bucket, filter, function (err, objs) {
		if (err) {
			log.error(err, 'failed to find object %s', uuid);
			cb(err);
		} else {
			cb(null, objs.length > 0 ? objs[0] : null);
		}
	});
};

MorayStorage.prototype.delObject = function delObject(bucket, uuid, cb) {
	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	this.moray.delObject(bucket, uuid, function (err) {
		if (err) {
			if (err.name === 'ObjectNotFoundError') {
				return (cb(new mod_errors.ObjectNotFoundError(
				    err.message)));
			} else {
				return (cb(err));
			}
		}

		return (cb(null));
	});
};

MorayStorage.prototype.listObjectValues = listObjectValues;

function listObjectValues(bucket, search_opts, cb) {
	var log = this.log;

	assert.string(bucket, 'bucket');
	assert.object(search_opts, 'search_opts');
	assert.func(cb, 'cb');

	var filters = [ ldapjs.parseFilter('(uuid=*)') ];

	Object.keys(search_opts).forEach(function (key) {
		filters.push(new ldapjs.EqualityFilter({
			attribute: key,
			value: search_opts[key]
		}));
	});

	var filter;
	if (filters.length === 1)
		filter = filters[0];
	else
		filter = new ldapjs.AndFilter({ filters: filters });

	log.info({ filter: filter.toString() }, 'listing objects');

	findObjects.call(this, bucket, filter.toString(),
	    function (err, records) {
		if (err)
			return (cb(err));

		var vals = records.map(function (record) {
			var val = null;
			if (record)
				val = record.value;
			return (val);
		});

		return (cb(null, vals));
	});
}

function findObjects(bucket, filter, cb) {
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.string(filter, 'filter');
	assert.func(cb, 'cb');

	var res = self.moray.findObjects(bucket, filter, {});

	var objs = [];

	res.on('record', function (record) {
		objs.push(record);
	});

	res.on('error', function (err) {
		log.error(err, 'failed to list objects from bucket %s', bucket);
		return (cb(err));
	});

	res.on('end', function () {
		return (cb(null, objs));
	});
}

MorayStorage.prototype.close = function close() {
	this.moray.close();
};
