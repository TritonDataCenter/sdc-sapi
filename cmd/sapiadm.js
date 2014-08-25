#!/usr/node/bin/node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * sapiadm.js: CLI tool for SAPI
 */

var assert = require('assert-plus');
var async = require('async');
var cmdln = require('cmdln');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var sdc = require('sdc-clients');
var util = require('util');

var mod_util = require('../lib/common/util');

var sprintf = require('sprintf-js').sprintf;

var Cmdln = cmdln.Cmdln;
var bunyan = require('bunyan');

var VERSION = '1.0.0';


function sortBy(field) {
	return (function (a, b) {
		if (a[field] < b[field])
			return (-1);
		if (a[field] > b[field])
			return (1);
		return (0);
	});
}

function Sapiadm() {
	Cmdln.call(this, {
		name: 'sapiadm',
		desc: 'Administer SAPI objects',
		// Custom options. By default you get -h/--help.
		options: [
			{names: ['help', 'h'], type: 'bool',
			    help: 'Print help and exit.'},
			{name: 'version', type: 'bool',
			    help: 'Print version and exit.'},
			{names: ['verbose', 'v'], type: 'arrayOfBool',
			    help: 'More verbose logging.'}
		]
	});
}
util.inherits(Sapiadm, Cmdln);

Sapiadm.prototype.init = function (opts, args, cb) {
	var self = this;

	if (opts.version) {
		console.log(VERSION);
		cb(false);
		return;
	}

	var level = 'warn';
	var src = false;
	if (opts.verbose) {
		if (opts.verbose.length === 1) {
			level = 'info';
		} else if (opts.verbose.length === 2) {
			level = 'debug';
		} else {
			level = 'trace';
			src = true;
		}
	}
	this.log = bunyan.createLogger({
		name: __filename,
		serializers: bunyan.stdSerializers,
		src: src,
		streams: [
			{
				stream: process.stderr,
				level: level
			}
		]
	});

	var onReady = function (err, client) {
		if (err)
			return (cb(err));
		self.client = client;
		Cmdln.prototype.init.call(self, opts, args, cb);
	};

	mod_util.zonename(function (err, zonename) {
		if (err)
			return (cb(err));

		if (zonename === 'global')
			initGlobalZone.call(self, onReady);
		else
			initNonGlobalZone.call(self, onReady);

	});
};

function initGlobalZone(cb) {
	var self = this;

	var cmd = '/usr/bin/bash /lib/sdc/config.sh -json';

	cp.exec(cmd, function (err, stdout, stderr) {
		if (err)
			return (cb(err));

		var config = JSON.parse(stdout);
		var sapi_url = 'http://' + config.sapi_domain;

		var client = new sdc.SAPI({
			url: sapi_url,
			log: self.log,
			agent: false
		});

		cb(null, client);
	});
}

function initNonGlobalZone(cb) {
	var self = this;

	var CFG = '/opt/smartdc/config-agent/etc/config.json';

	fs.readFile(CFG, 'utf8', function (err, contents) {
		if (err)
			return (cb(err));

		var config = JSON.parse(contents);

		var client = new sdc.SAPI({
			url: config.sapi.url,
			log: self.log,
			agent: false
		});

		cb(null, client);
	});
}


// -- Main subcommands

Sapiadm.prototype.do_get = function (subcmd, opts, args, cb) {
	if (args.length !== 1) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	this.client.whatis(args[0], function (err, app) {
		if (err)
			return (cb(err));

		if (!app) {
			console.log('no such object: ' + args[0]);
			return (cb(null));
		}

		console.log(JSON.stringify(app, null, 4));
		return (cb());
	});
};
Sapiadm.prototype.do_get.help = (
    'Get object details.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm get UUID\n'
);


Sapiadm.prototype.do_showapp = function (subcmd, opts, args, cb) {
	var self = this;

	if (args.length !== 1) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	var search_opts = {};
	search_opts.name = args[0];

	this.client.listApplications(search_opts, function (err, apps) {
		if (err)
			return (cb(err));

		if (apps.length === 0) {
			console.log('no such application: ' + args[0]);
			return (cb(null));
		}

		self.client.getApplicationObjects(apps[0].uuid,
		    function (suberr, ret) {
			if (suberr)
				return (cb(suberr));
			if (opts.json) {
				printApplicationJSON(ret.services,
				                     ret.instances);
			} else {
				printApplication(ret.services, ret.instances);
			}
			return (cb(null));
		});
	});
};
Sapiadm.prototype.do_showapp.options = [
	{
		names: [ 'json', 'j' ],
		type: 'bool',
		help: 'output in JSON'
	}
];
Sapiadm.prototype.do_showapp.help = (
    'Show services and instances inside an application.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm showapp APPLICATION-NAME\n'
    + '     sapiadm showapp -j APPLICATION-NAME\n'
);


Sapiadm.prototype.do_update = function (subcmd, opts, args, cb) {
	var self = this;

	if (args.length !== 1 && args.length !== 2) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	var uuid = args[0];

	async.waterfall([
		function (subcb) {
			if (args.length === 1)
				return (readInput(opts, subcb));

			/*
			 * If there's a second argument, it must be in the form:
			 *
			 *     metadata.foo=bar
			 */
			var input = args[1];

			if (input.indexOf('=') === -1)
				return (cb(new Error('invalid syntax')));

			var tokens = input.split('=');
			var key = tokens[0];
			var value = tokens[1].trim();

			if (key.indexOf('.') === -1)
				return (cb(new Error('missing update type')));

			var type = key.substr(0, key.indexOf('.'));
			type = type.toLowerCase();

			if (type !== 'params' &&
			    type !== 'metadata' &&
			    type !== 'manifests') {
				return (cb(new Error(
				    'invalid type (must be one of "params", ' +
				    '"metadata", or "manifests")')));
			}

			var field = key.substr(key.indexOf('.') + 1);

			if (field.indexOf('.') !== -1) {
				return (cb(new Error(
				    'fields cannot be complex objects ' +
				    '(' + field + ' contains a \'.\'). ' +
				    'Please update with the -f option or by ' +
				    'piping a json object in.')));
			}

			var changes = {};
			changes[type] = {};
			changes[type][field] = value;

			return (subcb(null, changes));
		},
		function (changes, subcb) {
			self.client.whatis(uuid, function (err, obj) {
				if (err)
					return (subcb(err));

				if (!obj) {
					console.log('no such object: ' + uuid);
					return (cb(null));
				}

				return (subcb(null, changes, obj));
			});
		},
		function (changes, obj, subcb) {
			var func;
			if (obj.type === 'application')
				func = self.client.updateApplication;
			if (obj.type === 'service')
				func = self.client.updateService;
			if (obj.type === 'instance')
				func = self.client.updateInstance;

			assert.func(func, 'func');

			func.call(self.client, obj.uuid, changes, subcb);
		}
	], cb);
};
Sapiadm.prototype.do_update.options = [
	{
		names: [ 'f' ],
		type: 'string',
		helpArg: 'FILE',
		help: 'file containing update JSON'
	}
];
Sapiadm.prototype.do_update.help = (
    'Update a SAPI object.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm update UUID metadata.foo=bar\n'
    + '     sapiadm update UUID -f /tmp/changes.json\n'
    + '     echo \'{ "metadata": { "foo": "bar" } }\' |\n'
    + '         sapiadm update UUID\n'
    + '\n'
    + '{{options}}\n'
);


Sapiadm.prototype.do_provision = function (subcmd, opts, args, cb) {
	var self = this;
	// Cannot specify '-f FILE' *and* SERVICE-UUID arg.
	if (args.length > 1 || (opts.f && args.length)) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	function readInputStr(subcb) {
		if (opts.f) {
			fs.readFile(opts.f, 'utf8', subcb);
		} else if (args.length) {
			subcb(null, JSON.stringify({service_uuid: args[0]}));
		} else {
			var stdin = '';
			process.stdin.resume();
			process.stdin.on('data', function (chunk) {
				stdin += chunk;
			});
			process.stdin.on('end', function () {
				subcb(null, stdin);
			});
		}
	}

	function getInput(subcb) {
		readInputStr(function (rErr, input_str) {
			if (rErr)
				return (subcb(rErr));
			parseInput(input_str, function (err, input) {
				if (err) {
					return (subcb(err));
				}
				subcb(null, input);
			});
		});
	}

	getInput(function (pErr, input) {
		if (pErr)
			return (cb(pErr));

		var service_uuid = input.service_uuid;
		delete input.service_uuid;

		self.log.debug({service_uuid: service_uuid, opts: input},
		    'call SAPI.createInstance');
		self.client.createInstance(service_uuid, input,
		    function (err, inst) {
			if (err)
				return (cb(err));

			console.log('Provisioned instance %s successfully',
			    inst.uuid);
			cb();
		});
	});
};
Sapiadm.prototype.do_provision.options = [
	{
		names: [ 'f' ],
		type: 'string',
		helpArg: 'FILE',
		help: 'Optional additional provision JSON payload. Use "-"'
		    + 'to read JSON from stdin.'
	}
];
Sapiadm.prototype.do_provision.help = (
    'Provision a new instance the given service.\n'
    + '\n'
    + 'Extra provision params, instance metadata and manifests can\n'
    + 'optionally be provided via stdin or a file specified with "-f".\n'
    + 'Minimally a service uuid must be provided as an argument or as\n'
    + '"service_uuid" in the JSON payload. See \n'
    + '<https://mo.joyent.com/docs/sapi/master/#CreateInstance> for full\n'
    + 'details on acceptable payload.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm provision <service-uuid>\n'
    + '     sapiadm provision -f <file>\n'
    + '     ...payload on stdin ... | sapiadm provision\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Examples:\n'
    + '     sapiadm provision 66a67b43-6744-4f4d-afee-6f64dc61afb7\n'
    + '\n'
    + '     sapiadm provision -f payload.json\n'
    + '\n'
    + '     echo \'{\n'
    + '         "service_uuid": "66a67b43-6744-4f4d-afee-6f64dc61afb7",\n'
    + '         "params": {\n'
    + '             "alias": "foo0"\n'
    + '         }\n'
    + '     }\' | sapiadm provision\n'
);


Sapiadm.prototype.do_reprovision = function (subcmd, opts, args, cb) {
	if (args.length !== 2) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	var instance_uuid = args[0];
	var image_uuid = args[1];

	this.client.reprovisionInstance(instance_uuid, image_uuid,
	    function (err) {
		if (err)
			return (cb(err));

		console.log(sprintf('Reprovisioned %s successfully',
		    instance_uuid));
		cb();
	});
};
Sapiadm.prototype.do_reprovision.help = (
    'Reprovision an existing instance with a new image.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm reprovision INSTANCE-UUID IMAGE-UUID\n'
);


Sapiadm.prototype.do_edit_manifest = function (subcmd, opts, args, cb) {
	if (args.length !== 2) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	var self = this;
	var svc_or_app_uuid = args[0];
	var mn_name = args[1];
	var old_mn_uuid;
	var svcapp_type;
	var svcapp;
	var mn;

	async.waterfall([
		function getSvcOrApp(subcb) {
			self.client.getService(svc_or_app_uuid,
					function (sErr, svc_) {
				if (sErr) {
					self.client.getApplication(
							svc_or_app_uuid,
							function (aErr, app_) {
						svcapp = app_;
						svcapp_type = 'application';
						subcb(aErr);
					});
				} else {
					svcapp = svc_;
					svcapp_type = 'service';
					subcb();
				}
			});
		},
		function getMn(subcb) {
			var mn_uuid = svcapp.manifests[mn_name];
			if (!mn_uuid) {
				subcb(new Error(sprintf(
				    'no manifest named "%s" on %s "%s"',
				    mn_name, svcapp_type, svc_or_app_uuid)));
				return;
			}
			self.client.getManifest(mn_uuid, function (err, mn_) {
				mn = mn_;
				old_mn_uuid = mn.uuid;
				subcb(err);
			});
		},
		function editMn(subcb) {
			editInVi(mn_name, mn.template, subcb);
		},
		function earlyOutOrNewMn(new_template, changed, subcb) {
			if (!changed) {
				console.log(
				    'Manifest "%s" on %s "%s" unchanged.',
				    mn_name, svcapp_type, svc_or_app_uuid);
				subcb(true);
				return;
			}
			delete mn.uuid;
			mn.template = new_template;
			self.client.createManifest(mn, function (err, newMn) {
				if (!err) {
					console.log(
					    'Created new manifest "%s".',
					    newMn.uuid);
				}
				subcb(err, newMn);
			});
		},
		function updateSvcOrApp(newMn, subcb) {
			var update = {
				action: 'update',
				manifests: {}
			};
			update.manifests[mn_name] = newMn.uuid;
			var updateFunc = (svcapp_type === 'service'
				? self.client.updateService
				: self.client.updateApplication)
				.bind(self.client);
			updateFunc(svc_or_app_uuid, update,
			    function (err, newSvc) {
				if (!err) {
					console.log('Updated %s "%s" with '
					    + 'new manifest.', svcapp_type,
					    svc_or_app_uuid);
				}
				subcb(err);
			});
		},
		function deleteMn(subcb) {
			self.client.deleteManifest(old_mn_uuid, function (err) {
				if (!err) {
					console.log(
					    'Deleted old manifest "%s".',
					    old_mn_uuid);
				}
				subcb(err);
			});
		}
	], function (err) {
		// `err === true` is the early out
		if (err && err !== true) {
			cb(err);
			return;
		}
		cb();
	});
};
Sapiadm.prototype.do_edit_manifest.help = (
    'Edit a manifest tied to a service or application and save it back.\n'
    + '\n'
    + 'SAPI does not include an UpdateManifest endpoint, so this instead\n'
    + 'creates a new manifest, swaps the new manifest UUID into the service,\n'
    + 'and deletes the old.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm edit-manifest SERVICE-UUID MANIFEST-NAME\n'
);


// -- Helper functions


/**
 * Edit the given text in Vi and return the edited text.
 *
 * This callback with `callback(err, updatedText, changed)` where `changed`
 * is a boolean true if the text was changed.
 */
function editInVi(filename, beforeText, callback) {
	var tmpPath = path.resolve(os.tmpDir(),
	    sprintf('sapiadm-%s-edit-%s', process.pid, filename));
	fs.writeFileSync(tmpPath, beforeText, 'utf8');

	var vi = cp.spawn('/usr/bin/vi', ['-f', tmpPath], {stdio: 'inherit'});
	vi.on('exit', function (code) {
		if (code) {
			return (callback(code));
		}
		var afterText = fs.readFileSync(tmpPath, 'utf8');
		fs.unlinkSync(tmpPath);
		callback(null, afterText, (afterText !== beforeText));
	});
}

function printApplication(services, instances) {
	var width = 0;

	Object.keys(services).forEach(function (uuid) {
		width = Math.max(width, services[uuid].name.length);
	});

	var fmt = '%-' + width + 's  %-36s  %-8s';
	console.log(sprintf(fmt, 'NAME', 'UUID', 'INSTANCES'));

	Object.keys(services).forEach(function (uuid) {
		var name = services[uuid].name;
		var insts = instances[uuid] ? instances[uuid] : [];

		insts = insts.sort(sortBy('uuid'));

		console.log(sprintf(fmt, name, uuid, insts.length));

		if (insts.length === 0)
			return;

		console.log('  |');
		for (var ii = 0; ii < insts.length; ii++) {
			console.log(sprintf(fmt,
			    ii === 0 ? '  ---> ' : '',
			    insts[ii].uuid, ''));
		}
	});
}

function printApplicationJSON(services, instances) {
	Object.keys(services).forEach(function (uuid) {
		var name = services[uuid].name;
		var insts = instances[uuid] ? instances[uuid] : [];

		for (var ii = 0; ii < insts.length; ii++) {
			insts[ii] = insts[ii].uuid;
		}

		var out = {
			name: name,
			uuid: uuid,
			instances: insts
		};

		console.log(JSON.stringify(out));
	});
}

function readInput(opts, cb) {
	if (opts.f) {
		fs.readFile(opts.f, 'utf8', function (err, contents) {
			if (err)
				return (cb(err));
			parseInput(contents, cb);
		});
	} else {
		var content = '';
		var calledBack = false;
		process.stdin.on('data', function (chunk) {
			content += chunk;
		});
		process.stdin.on('end', function () {
			if (calledBack)
				return;
			calledBack = true;
			parseInput(content, cb);
		});
		process.stdin.on('error', function (err) {
			if (calledBack)
				return;
			calledBack = true;
			cb(err);
		});
		process.stdin.resume();
	}
}

function parseInput(input, cb) {
	var changes = null;
	try {
		changes = JSON.parse(input);
	} catch (e) {
		return (cb(new Error('input is invalid JSON')));
	}

	return (cb(null, changes));
}


cmdln.main(Sapiadm);
