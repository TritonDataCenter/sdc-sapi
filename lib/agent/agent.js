/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/agent/agent.js: in-zone agent responsible for maintaining configuration
 *     files
 *
 * This agent makes extensive use of objects called configuration manifests.
 * These manifests describe all data associated with a configuration file,
 * including but not limited to its template, where that file is installed, and
 * a command to run after the file is installed.  These manifests are generated
 * by and retrieved from the Services API (SAPI).
 *
 * The full list of fields includes:
 *
 * 	name		The manifest's name.
 *
 * 	template	The file's hogan.js template.
 *
 *	contents	The rendered configuration file, basically the
 *			template + metadata.  This is not actually stored in
 *			SAPI but rather generated here in the zone.
 *
 *	path		Where this file is installed.
 *
 *	post_cmd	(Optional) If a file is updated, this command is run
 *			after the file is updated.
 *
 * In addition to the configuration manfiests, each zone also has a set of
 * metadata values.  These values are used to render the configuration file from
 * the manifest's template.  These values are stored separately from each
 * manfiest since the metadata values apply to all manifests in a zone.
 */

var assert = require('assert-plus');
var async = require('async');
var exec = require('child_process').exec;
var find = require('find');
var fs = require('fs');
var hogan = require('hogan.js');
var once = require('once');
var path = require('path');
var sdc = require('sdc-clients');
var sprintf = require('util').format;
var vasync = require('vasync');

var mkdirp = require('mkdirp');


function Agent(config) {
	assert.object(config, 'config');
	assert.string(config.zonename, 'config.zonename');
	assert.object(config.log, 'config.log');
	assert.object(config.sapi, 'config.sapi');
	assert.string(config.sapi.url, 'config.sapi.url');

	/*
	 * If the config.localManifestDirs field is specified, the agent will
	 * find and read any manifests in those directories.  If any of those
	 * manifests has the same name as a manifest retrieved from SAPI, the
	 * local version of the manifest will override the SAPI version.
	 */
	assert.optionalArrayOfString(config.localManifestDirs,
	    'config.localManifestDirs');

	this.zonename = config.zonename;
	this.localManifestDirs = config.localManifestDirs;

	this.log = config.log;

	this.sapi = new sdc.SAPI({
		log: config.log,
		url: config.sapi.url,
		agent: false
	});
}

Agent.prototype.init = function init(cb) {
	var self = this;
	var log = this.log;

	if (!this.localManifestDirs) {
		self.local_manifests = [];
		log.info('using 0 local manifests');
		return (cb(null));
	}

	assert.arrayOfString(this.localManifestDirs);

	findManifestDirs.call(this, this.localManifestDirs,
	    function (err, dirs) {
		if (err)
			return (cb(err));

		vasync.forEachParallel({
			func: readManifests.bind(self),
			inputs: dirs
		}, function (suberr, results) {
			if (suberr)
				return (cb(suberr));

			var manifests = [];

			results.successes.forEach(function (suc) {
				manifests = manifests.concat(suc);
			});

			self.local_manifests = manifests;

			log.info('using %d local manifests', manifests.length);
			log.debug({ local_manifests: manifests },
			    'local manifests');

			cb();
		});
	});

	return (null);
};

Agent.prototype.checkAndRefresh = function checkAndRefresh(cb) {
	var self = this;
	var log = self.log;
	var sapi = self.sapi;

	async.waterfall([
		function querySapi(subcb) {
			sapi.getConfig(self.zonename, function (err, config) {
				if (err) {
					log.error(err, 'failed to get config');
					return (subcb(err));
				}

				log.trace({ config: config },
				    'read config from SAPI');

				var manifests = resolveManifests.call(self,
				    config.manifests, self.local_manifests);

				return (subcb(null,
				    manifests, config.metadata));
			});
		},
		function renderFiles(manifests, metadata, subcb) {
			assert.object(manifests, 'manifests');
			assert.object(metadata, 'metadata');

			log.debug({
			    manifests: manifests,
			    metadata: metadata
			}, 'read manifests and metadata');

			Object.keys(manifests).forEach(function (name) {
				renderConfigFile.call(self,
				    manifests[name], metadata);
			});

			return (subcb(null, manifests));
		},
		function writeFiles(manifests, subcb) {
			assert.object(manifests, 'manifests');

			vasync.forEachParallel({
				func: function (name, subsubcb) {
					writeConfigFile.call(self,
					    manifests[name], subsubcb);
				},
				inputs: Object.keys(manifests)
			}, function (err) {
				return (subcb(err));
			});
		}
	], function (err, results) {
		if (err)
			log.error(err, 'failed to write all files');

		if (cb)
			cb();
	});
};

/*
 * Look through a list of directories for directories named "sapi_manifests",
 * and read manfiests from any directories there.
 */
function findManifestDirs(dirs, cb) {
	var log = this.log;

	assert.arrayOfString(dirs, 'dirs');
	assert.func(cb, 'cb');

	cb = once(cb);

	var searchDirs = [];

	async.forEachSeries(dirs, function (dir, subcb) {
		subcb = once(subcb);

		try {
			find.dir('sapi_manifests', dir, function (res) {
				searchDirs = searchDirs.concat(res);

				log.debug({ directories: res },
				    'searching for local manifests in these ' +
				    'directories');

				subcb();
			});
		} catch (err) {
			log.error(err, 'failed to find directories in %s', dir);
			return (subcb(err));
		}
	}, function (err) {
		cb(err, searchDirs);
	});
}

/*
 * Given a particular sapi_manifests directory (e.g.
 * /opt/smartdc/vmapi/sapi_manifests), read all the manifests from that
 * location.
 */
function readManifests(dir, cb) {
	var self = this;
	var log = self.log;
	var sapi = self.sapi;

	assert.string(dir, 'dir');
	assert.func(cb, 'cb');

	fs.readdir(dir, function (err, files) {
		if (err) {
			log.warn(err, 'failed to read directory %s', dir);
			return (cb(err));
		}

		vasync.forEachParallel({
			func: function (item, subcb) {
				var dirname = path.join(dir, item);

				sapi.readManifest(dirname, subcb);
			},
			inputs: files
		}, function (suberr, results) {
			log.info('read %d manifests from %s',
			    results.successes.length, dir);

			log.debug({ manifests: results.successes },
			    'read these manifests from %s', dir);

			cb(suberr, results.successes);
		});
	});
}

/*
 * Given a list of SAPI manifests and local manifests, find the set of manifests
 * to be used for this zone's configuration.  Any local manifest with the same
 * name as a SAPI manifest will override that SAPI manifest.
 */
function resolveManifests(sapi_manifests, local_manifests) {
	var log = this.log;

	assert.arrayOfObject(sapi_manifests, 'sapi_manifests');
	assert.arrayOfObject(local_manifests, 'local_manifests');

	var manifests = {};

	sapi_manifests.forEach(function (manifest) {
		log.trace('using manifest "%s" from SAPI', manifest.name);
		manifests[manifest.name] = manifest;
	});

	/*
	 * If there are local manifests, use those
	 * instead of manifests provided from SAPI.
	 */
	local_manifests.forEach(function (manifest) {
		log.trace('using manifest %s from local image',
		    manifest.name);

		if (manifests[manifest.name]) {
			log.debug('local manifest %s overriding SAPI manifest',
			    manifest.name);
		}

		manifests[manifest.name] = manifest;
	});

	log.debug({ manifests: manifests },
	    'resolved SAPI and local manifests');

	return (manifests);
}


function runPostCommand(post_cmd, cb) {
	var self = this;
	var log = self.log;

	assert.string(post_cmd, 'post_cmd');

	log.info({ post_cmd: post_cmd }, 'running post_cmd');

	exec(post_cmd, function (err, stdout, stderr) {
		if (err) {
			log.error({
			    err: err,
			    stdout: stdout,
			    stderr: stderr,
			    post_cmd: post_cmd
			}, 'post_cmd failed');
		} else {
			log.info({
			    post_cmd: post_cmd
			}, 'post_cmd ran successfully');
		}

		return (cb(err));
	});
}


/*
 * Render a configuration file from its manifest.
 */
function renderConfigFile(manifest, metadata) {
	var self = this;
	var log = self.log;

	assert.object(manifest, 'manifest');
	assert.string(manifest.template, 'manifest.template');

	assert.object(metadata, 'metadata');

	log.debug('rendering configuration file from manifest %s',
	    manifest.name);

	var contents = null;
	try {
		contents = hogan.compile(manifest.template).render(metadata);
	} catch (e) {
		log.error('invalid hogan template: ' + e.message);
	}

	if (!contents) {
		log.error('failed to render configuration file');
	} else {
		log.debug({ contents: contents },
		    'rendered configuration file');
	}

	manifest.contents = contents;

	log.debug({ contents: contents }, 'generated contents for manifest %s',
	    manifest.name);

	return (manifest);
}


function writeConfigFile(manifest, cb) {
	var self = this;
	var log = self.log;

	assert.object(manifest, 'manifest');
	assert.string(manifest.name, 'manifest.name');
	assert.string(manifest.path, 'manifest.path');
	assert.string(manifest.contents, 'manifest.contents');

	var contents = manifest.contents;
	var existing = null;

	async.waterfall([
		function (subcb) {
			var dirname = path.dirname(manifest.path);

			log.debug('mkdir -p %s', dirname);

			mkdirp(dirname, function (err) {
				if (err) {
					log.warn(err,
					    'failed to mkdir -p %s', dirname);
				}

				subcb(null);
			});
		},
		function (subcb) {
			fs.readFile(manifest.path, 'ascii',
			    function (err, file) {
				if (err) {
					log.warn(err, 'failed to read file %s',
					    manifest.path);
					return (subcb(null));
				}

				existing = file;
				return (subcb(null));
			});
		},
		function (subcb) {
			if (existing && contents === existing) {
				log.debug('file %s unchaged; not updating ' +
				    'file', manifest.path);
				return (subcb(null, false));
			}

			log.info({
			    path: manifest.path,
			    updated: contents,
			    existing: existing
			}, 'writing updated file');

			fs.writeFile(manifest.path, contents, function (err) {
				if (err) {
					log.error(err, 'failed to write ' +
					    'file %s', manifest.path);
					return (subcb(err));
				}

				log.info('updated file %s for manifest %s',
				    manifest.path, manifest.name);

				return (subcb(null, true));
			});

			return (null);
		},
		function (updated, subcb) {
			assert.bool(updated, 'updated');
			assert.func(subcb, 'subcb');

			if (!updated)
				return (subcb(null));

			if (!manifest.post_cmd) {
				log.debug('no post command to run for ' +
				    'manifest %s', manifest.name);
				return (subcb(null));
			}

			runPostCommand.call(self, manifest.post_cmd,
			    function (err) {
				/*
				 * If the post command fails, it's not a fatal
				 * error.  The failure will be logged in the
				 * runPostCommand() function.
				 */
				subcb(null);
			});
			return (null);
		}
	], function (err) {
		if (err) {
			log.error(err, 'failed to update file for manifest %s',
			    manifest.name);
			return (cb(err));
		}

		return (cb(null));
	});
}

module.exports = Agent;
