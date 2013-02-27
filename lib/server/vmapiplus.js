/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/vmapiplus.js: simplified synchronous wrappers for the
 *     SDC VMAPI client
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var path = require('path');
var vasync = require('vasync');

var exec = require('child_process').exec;
var sprintf = require('util').format;


// -- Main exported interface

function VMAPIPlus(config) {
	assert.object(config.log, 'config.log');
	assert.object(config.vmapi, 'config.vmapi');

	this.log = config.log;
	this.vmapi = config.vmapi;
}


VMAPIPlus.prototype.deleteVm = function deleteVm(vm_uuid, cb) {
	var self = this;
	var vmapi = self.vmapi;
	var log = self.log;

	assert.string(vm_uuid, 'vm_uuid');

	var params = {};
	params.uuid = vm_uuid;

	vmapi.deleteVm(params, function (err, ret) {
		if (err) {
			log.error(err, 'failed to delete VM %s', vm_uuid);
			cb(err);
		} else {
			self.waitForJob(ret.job_uuid, cb);
		}
	});
};


VMAPIPlus.prototype.waitForJob = function waitForJob(job_uuid, cb) {
	var vmapi = this.vmapi;
	var log = this.log;

	var attempts = 0;
	var errors = 0;

	var timeout = 5000;

	log.info('waiting for job %s', job_uuid);

	var pollJob = function () {
		vmapi.getJob(job_uuid, function (err, job) {
			attempts++;

			if (err) {
				errors++;

				log.warn(err, 'failed to get job %s ' +
				    '(attempt %d, error %d)',
				    job_uuid, attempts, errors);

				if (errors >= 5) {
					log.error(err,
					    'failed to wait for job %s',
					    job_uuid);
					return (cb(err));
				} else {
					return (setTimeout(pollJob, timeout));
				}
			}

			log.debug({ job: job }, 'polling job %s (attempt %d)',
			    job_uuid, attempts);

			if (job && job.execution === 'succeeded') {
				return (cb(null));
			} else if (job && job.execution === 'failed') {
				log.error('job %s failed', job_uuid);
				return (cb(new Error('job failed')));
			} else if (attempts > 60) {
				log.warn('polling for job %s completion ' +
				    'timed out after %d seconds',
				    job_uuid, 60 * 5);
				return (cb(new Error(
				    'polling for job timed out')));
			}

			setTimeout(pollJob, timeout);
			return (null);
		});
	};

	pollJob();
};


module.exports = VMAPIPlus;
