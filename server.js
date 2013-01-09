/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * server.js: Main entry point for the Services API
 */

var SAPI = require('./lib/sapi');


var sapi = new SAPI({});

sapi.start(function (err) {
	if (err) {
		console.error('failure to start sapi: ' + err.message);
		process.exit(1);
	}
});
