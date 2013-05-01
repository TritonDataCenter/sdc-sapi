#!/opt/smartdc/config-agent/build/node/bin/node

/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * sapiadm.js: CLI tool for SAPI
 */

var assert = require('assert-plus');
var async = require('async');
var cmdln = require('cmdln');
var cp = require('child_process');
var fs = require('fs');
var read = require('read');
var sdc = require('sdc-clients');
var util = require('util');

var sprintf = require('sprintf-js').sprintf;

var Cmdln = cmdln.Cmdln;
var Logger = require('bunyan');

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
			    help: 'Print version and exit.'}
		]
	});
}
util.inherits(Sapiadm, Cmdln);

Sapiadm.prototype.init = function (opts, args, cb) {
	if (opts.version) {
		console.log(VERSION);
		cb(false);
		return;
	}

	this.log = new Logger({
		name: __filename,
		serializers: Logger.stdSerializers
	});

	var CFG = '/opt/smartdc/config-agent/etc/config.json';
	var config = JSON.parse(fs.readFileSync(CFG, 'utf8'));

	this.client = new sdc.SAPI({
		url: config.sapi.url,
		log: this.log,
		agent: false
	});

	Cmdln.prototype.init.apply(this, arguments);
};



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
			printApplication(ret.services, ret.instances);
			return (cb(null));
		});
	});
};
Sapiadm.prototype.do_showapp.help = (
    'Show services and instances inside an application.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm showapp APPLICATION-NAME\n'
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
		names: [ 'T' ],
		type: 'string',
		help: 'file containing update (e.g. `curl -T`)'
	}
];
Sapiadm.prototype.do_update.help = (
    'Update a SAPI object.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm update UUID metadata.foo=bar\n'
    + '     sapiadm update UUID -T /tmp/changes.json\n'
    + '     echo \'{ "metadata": { "foo": "bar" } }\' |\n'
    + '         sapiadm update UUID\n'
);


Sapiadm.prototype.do_provision = function (subcmd, opts, args, cb) {
	if (args.length !== 1) {
		this.do_help('help', {}, [subcmd], cb);
		return;
	}

	var service_uuid = args[0];

	this.client.createInstance(service_uuid, function (err, inst) {
		if (err)
			return (cb(err));

		console.log(sprintf('Provisioned instance %s successfully',
		    inst.uuid));
		cb();
	});
};
Sapiadm.prototype.do_provision.help = (
    'Provision a new instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     sapiadm provision SERVICE-UUID\n'
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


// -- Helper functions

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


function readInput(opts, cb) {
	if (opts.T) {
		fs.readFile(opts.T, 'utf8', function (err, contents) {
			if (err)
				return (cb(err));
			parseInput(contents, cb);
		});
	} else {
		read({ silent: true }, function (err, stdin) {
			if (err)
				return (cb(err));
			parseInput(stdin, cb);
		});
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
