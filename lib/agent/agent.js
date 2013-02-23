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
 *	type		One of 'text' or 'json'. Used in formatting the
 *			rendered template.
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
var fs = require('fs');
var hogan = require('hogan.js');
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

	this.zonename = config.zonename;

	this.log = config.log;

	this.sapi = new sdc.SAPI({
		log: config.log,
		url: config.sapi.url,
		agent: false
	});
}


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

				assert.object(config, 'config');

				log.debug({ config: config },
				    'read config from SAPI');

				return (subcb(null,
				    config.manifests, config.metadata));
			});
		},
		function renderFiles(manifests, metadata, subcb) {
			assert.arrayOfObject(manifests, 'manifests');
			assert.object(metadata, 'metadata');

			log.debug({
			    manifests: manifests,
			    metadata: metadata
			}, 'read manifests and metadata');

			manifests.forEach(function (manifest) {
				renderConfigFile.call(self, manifest, metadata);
			});
			return (subcb(null, manifests));
		},
		function writeFiles(manifests, subcb) {
			vasync.forEachParallel({
				func: writeConfigFile.bind(self),
				inputs: manifests
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


function runPostCommand(post_cmd, cb) {
	var self = this;
	var log = self.log;

	assert.string(post_cmd, 'post_cmd');

	exec(post_cmd, function (err) {
		if (err)
			log.error(err, 'post_cmd "%s" failed', post_cmd);

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

	log.info('rendering configuration file from manifest %s',
	    manifest.name);

	var contents = hogan.compile(manifest.template).render(metadata);

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
	assert.string(manifest.type, 'manifest.type');
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
			if (manifest.type === 'json') {
				var obj = null;
				try {
					obj = JSON.parse(contents);
				} catch (e) {}

				if (obj)
					contents = JSON.stringify(obj, null, 4);
			}

			if (existing && contents === existing) {
				log.info('file %s unchaged; not updating ' +
				    'file', manifest.path);
				return (subcb(null, true));
			}

			log.info('writing %s file into %s', manifest.type,
				manifest.path);

			fs.writeFile(manifest.path, contents, function (err) {
				if (err) {
					log.error(err, 'failed to write ' +
					    'file %s', manifest.path);
					return (subcb(err));
				}

				log.info('updated file for manifest %s',
				    manifest.name);

				return (subcb(null));
			});

			return (null);
		},
		function (subcb) {
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
