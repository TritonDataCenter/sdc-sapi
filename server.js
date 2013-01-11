/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * server.js: Main entry point for the Services API
 */

var SAPI = require('./lib/sapi');


/*
 * XXX
 * For now, this config refers to the services on kvm6.  Really should be moved
 * to a configuration file.
 */
var config = {
	moray: {
		host: '10.2.206.9',
		port: 2020
	},
	ufds: {
		url: 'ldaps://10.2.206.10',
		bindDN: 'cn=root',
		bindPassword: 'secret'
	},
	vmapi: {
		url: 'http://10.2.206.19'
	},
	imgapi: {
		url: 'http://10.2.206.13'
	},
	napi: {
		url: 'http://10.2.206.6'
	}
};

var sapi = new SAPI(config);

sapi.start(function (err) {
	if (err) {
		console.error('failure to start sapi: ' + err.message);
		process.exit(1);
	}
});
