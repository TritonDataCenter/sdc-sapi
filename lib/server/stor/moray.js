/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/stor/moray.js: moray interface
 */

var async = require('async');
var assert = require('assert-plus');
var jsprim = require('jsprim');
var ldapjs = require('ldapjs');
var LRU = require('lru-cache');
var moray = require('moray');
var once = require('once');
var vasync = require('vasync');

var mod_errors = require('../errors');

var sprintf = require('util').format;


module.exports = MorayStorage;

function MorayStorage(config) {
	assert.object(config, 'config');
	assert.object(config.moray, 'config.moray');
	assert.object(config.log, 'config.log');
	assert.object(config.buckets, 'config.buckets');

	this.config = config.moray;
	this.log = config.log;
	this.buckets = config.buckets;

	this.object_cache = LRU({
		max: 10000,
		maxAge: 15 * 1000,  /* 15 seconds */
		length: function (item) { return (1); }
	});
}

MorayStorage.prototype.init = function init(cb) {
	var self = this;
	var log = this.log;
	var config = this.config;

	assert.func(cb, 'callback');

	var HEARTBEAT;
	var INTERVAL;
	var TIMER;

	cb = once(cb);

	var init_barrier = vasync.barrier();
	init_barrier.start('sync');
	init_barrier.on('drain', function () {
		log.info('all moray connections ready');
		cb();
	});

	config.port = parseInt(config.port, 10);

	var retry = config.retry || {};
	this.local = moray.createClient({
		connectTimeout: config.connectTimeout,
		log: log,
		host: config.host,
		port: config.port,
		retry: (config.retry === false ? false : {
			retries: retry.retries || Infinity,
			minTimeout: retry.minTimeout || 1000,
			maxTimeout: retry.maxTimeout || 60000
		})
	});

	init_barrier.start('local_moray');

	/*
	 * If specified, create a second connect to the master moray instance.
	 */
	if (config.master_host && config.master_port) {
		config.master_port = parseInt(config.master_port, 10);

		this.master = moray.createClient({
			connectTimeout: config.connectTimeout,
			log: log,
			host: config.master_host,
			port: config.master_port,
			retry: (config.retry === false ? false : {
				retries: retry.retries || Infinity,
				minTimeout: retry.minTimeout || 1000,
				maxTimeout: retry.maxTimeout || 60000
			})
		});

		log.info('initializing master moray client');

		init_barrier.start('master_moray');
	}

	this.object_cache.reset();

	function setup(tag) {
		var clients = [ self.local ];
		if (self.master)
			clients.push(self.master);

		vasync.forEachParallel({
			func: initBuckets.bind(self),
			inputs: clients
		}, function (err) {
			if (err)
				return (cb(err));

			init_barrier.done(tag);
		});
	}

	function onConnect(tag, client) {
		client.removeListener('error', onError);
		log.info({moray: client.toString()}, 'moray: connected');

		client.on('close', function () {
			log.error('moray: closed: stopping heartbeats');
			clearInterval(TIMER);
		});

		client.on('connect', function () {
			log.info('moray: connect: starting heartbeats');
			TIMER = setInterval(HEARTBEAT, INTERVAL);
		});

		client.on('error', function (err) {
			log.warn(err, 'moray: error (reconnecting)');
		});

		setup(tag);
	}

	function onError(client, err) {
		client.removeListener('connect', onConnect);
		log.error(err, 'moray: connection failed');

		setTimeout(init.bind(null, function () {}), 1000);
	}

	function onConnectAttempt(number, delay) {
		var level;
		if (number === 0) {
			level = 'info';
		} else if (number < 5) {
			level = 'warn';
		} else {
			level = 'error';
		}
		log[level]({
			attempt: number,
			delay: delay
		}, 'moray: connection attempted');
	}

	this.local.once('connect',
	    onConnect.bind(this, 'local_moray', this.local));
	this.local.once('error', onError.bind(this, this.local));
	this.local.on('connectAttempt', onConnectAttempt);

	if (this.master) {
		this.master.once('connect',
		    onConnect.bind(this, 'master_moray', this.master));
		this.master.once('error', onError.bind(this, this.master));
		this.master.on('connectAttempt', onConnectAttempt);
	}

	init_barrier.done('sync');
};


// -- Bucket operations

function initBuckets(client, cb) {
	var self = this;
	var buckets = self.buckets;

	assert.object(client, 'client');
	assert.func(cb, 'cb');

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

			createBucket.call(self, client,
			    buckets.applications, basecfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.name = {
				type: 'string'
			};
			cfg.index.application_uuid = {
				type: 'string'
			};

			createBucket.call(self, client,
			    buckets.services, cfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.service_uuid = {
				type: 'string'
			};

			createBucket.call(self, client,
			    buckets.instances, cfg, subcb);
		},
		function (subcb) {
			createBucket.call(self, client,
			    buckets.manifests, basecfg, subcb);
		}
	], cb);
}

function createBucket(client, name, cfg, cb) {
	var self = this;
	var log = self.log;

	assert.object(client, 'client');
	assert.string(name, 'name');
	assert.object(cfg, 'cfg');
	assert.func(cb, 'cb');

	client.getBucket(name, function (err, bucket) {
		if (!err)
			return (cb(null));

		if (err && err.name !== 'BucketNotFoundError') {
			log.error(err, 'failed to get bucket %s', name);
			return (cb(err));
		}

		client.createBucket(name, cfg, function (suberr) {
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
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.object(obj, 'obj');

	if (arguments.length === 4) {
		cb = opts;
		opts = {};
	}

	var client = this.local;

	/*
	 * If a connection to the master moray instance exists and the object
	 * contiains .master = true, then put that object into the master moray
	 * instance.
	 */
	if (obj.master && this.master)
		client = this.master;

	client.putObject(bucket, uuid, obj, opts, function (err, res) {
		if (err)
			return (cb(err));

		var record = {};
		record.value = obj;
		record.etag = res.etag;

		log.debug('adding object %s to cache', uuid);
		self.object_cache.set(uuid, record);

		cb(null);
	});
}

MorayStorage.prototype.getObject = function getObject(bucket, uuid, cb) {
	var log = this.log;

	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	var obj = this.object_cache.get(uuid);
	if (obj) {
		log.debug('serving object %s from cache', uuid);
		return (cb(null, obj));
	}

	var filter = sprintf('(uuid=%s)', uuid);

	/*
	 * A object should never exist in both the local and master moray
	 * instances, so it's safe to search both here when looking for a
	 * particular object.
	 */
	var opts = {};
	opts.include_master = true;

	findObjects.call(this, bucket, filter, opts, function (err, objs) {
		if (err) {
			log.error(err, 'failed to find object %s', uuid);
			cb(err);
		} else {
			cb(null, objs.length > 0 ? objs[0] : null);
		}
	});

	return (null);
};

MorayStorage.prototype.delObject = function delObject(bucket, uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	var onFinish = function () {
		log.debug('deleting object %s from cache', uuid);
		self.object_cache.del(uuid);
		cb(null);
	};

	this.local.delObject(bucket, uuid, function (err) {
		if (err && err.name !== 'ObjectNotFoundError')
			return (cb(err));

		if (!err)
			return (onFinish());

		assert.ok(err && err.name === 'ObjectNotFoundError');

		if (!self.master) {
			return (cb(new mod_errors.ObjectNotFoundError(
			    err.message)));
		}

		/*
		 * When the object isn't present in the local datacenter's
		 * moray, try to delete it from the master datacenter's moray.
		 */
		self.master.delObject(bucket, uuid, function (suberr) {
			if (suberr &&
			    suberr.name !== 'ObjectNotFoundError')
				return (cb(suberr));

			if (!suberr)
				return (onFinish());

			return (cb(new mod_errors.ObjectNotFoundError(
			    err.message)));
		});
	});
};

MorayStorage.prototype.listObjectValues = listObjectValues;

function listObjectValues(bucket, filters, opts, cb) {
	var log = this.log;

	assert.string(bucket, 'bucket');
	assert.object(filters, 'filters');
	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	var ldap_filters = [ ldapjs.parseFilter('(uuid=*)') ];
	Object.keys(filters).forEach(function (key) {
		ldap_filters.push(new ldapjs.EqualityFilter({
			attribute: key,
			value: filters[key]
		}));
	});

	var filter;
	if (ldap_filters.length === 1)
		filter = ldap_filters[0];
	else
		filter = new ldapjs.AndFilter({ filters: ldap_filters });

	log.info({ filter: filter.toString() }, 'listing objects');

	findObjects.call(this, bucket, filter.toString(), opts,
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

function findObjects(bucket, filter, opts, cb) {
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.string(filter, 'filter');
	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	var clients = [ this.local ];

	if (opts.include_master && this.master)
		clients.push(this.master);

	vasync.forEachParallel({
		func: function (client, subcb) {
			var res = client.findObjects(bucket, filter, {});

			var objs = [];

			res.on('record', function (record) {
				objs.push(record);
			});

			res.on('error', function (err) {
				log.error(err, 'failed to list objects from ' +
				    'bucket %s', bucket);
				return (subcb(err));
			});

			res.on('end', function () {
				return (subcb(null, objs));
			});
		},
		inputs: clients
	}, function (err, results) {
		if (err)
			return (cb(err));

		var objs = [];
		results.successes.forEach(function (r) {
			objs = objs.concat(r);
		});

		return (cb(null, objs));
	});
}

MorayStorage.prototype.close = function close() {
	this.local.close();
	if (this.master)
		this.master.close();
};
