/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
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

var mod_errors = require('./errors');


// -- Main exported interface

module.exports = VMAPIPlus;
VMAPIPlus.prototype.createVm = createVm;
VMAPIPlus.prototype.deleteVm = deleteVm;
VMAPIPlus.prototype.reprovisionVm = reprovisionVm;

function VMAPIPlus(config) {
    assert.object(config.log, 'config.log');
    assert.object(config.vmapi, 'config.vmapi');

    this.log = config.log;
    this.vmapi = config.vmapi;
}

function createVm(params, opts, cb) {
    var self = this;
    var log = self.log;

    assert.object(params, 'params');
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    self.vmapi.createVm(params, function (err, res) {
        if (err) {
            log.error(err, 'failed to create zone');
            return (cb(err));
        }

        log.info({ job: res.job_uuid }, 'create job dispatched');

        if (opts.async) {
            return (cb(null, res));
        }

        waitForJob.call(self, res.job_uuid, function (suberr) {
            if (suberr) {
                suberr = new mod_errors.ProvisionFailedError(
                    suberr.message);
            }

            cb(suberr);
        });
    });
}

function deleteVm(uuid, cb) {
    var self = this;
    var vmapi = self.vmapi;
    var log = self.log;

    assert.string(uuid, 'uuid');
    assert.func(cb, 'cb');

    var params = {};
    params.uuid = uuid;

    vmapi.deleteVm(params, function (err, res) {
        if (err) {
            log.error(err, 'failed to delete VM %s', uuid);
            return (cb(err));
        }

        log.info({ job: res.job_uuid }, 'destroy job dispatched');

        var expected_errors = [ 'ResourceNotFoundError' ];

        waitForJob.call(self, res.job_uuid, expected_errors,
            function (suberr) {
            if (suberr) {
                suberr = new mod_errors.DestroyFailedError(
                    suberr.message);
            }

            cb(suberr);
        });
    });
}

function reprovisionVm(uuid, image_uuid, cb) {
    var self = this;
    var vmapi = self.vmapi;
    var log = self.log;

    assert.string(uuid, 'uuid');
    assert.string(image_uuid, 'image_uuid');
    assert.func(cb, 'cb');

    var params = {};
    params.uuid = uuid;
    params.image_uuid = image_uuid;

    vmapi.reprovisionVm(params, function (err, res) {
        if (err) {
            log.error(err, 'failed to reprovision VM %s', uuid);
            return (cb(err));
        }

        log.info({ job: res.job_uuid }, 'reprovision job dispatched');

        waitForJob.call(self, res.job_uuid, function (suberr) {
            if (suberr) {
                suberr = new mod_errors.ReprovisionFailedError(
                    suberr.message);
            }

            cb(suberr);
        });
    });
}


// -- Helper functions

/*
 * Wait for a job to complete.  Returns an error if the job fails with an error
 * other than the (optional) list of expected errors.
 */
function waitForJob(job_uuid, errors, cb) {
    var log = this.log;

    assert.string(job_uuid, 'job_uuid');

    if (arguments.length === 2) {
        cb = errors;
        errors = [];
    }

    assert.func(cb, 'cb');

    log.info('waiting for job %s', job_uuid);

    pollJob.call(this, job_uuid, function (err, job) {
        if (err)
            return (cb(err));

        var result = job.chain_results.pop();

        if (result.error) {
            var err_name = result.error.name;
            for (var i = 0; i < errors.length; i++) {
                if (err_name === errors[i]) {
                    log.warn('job failed with error %s; ' +
                        'ignoring expected error',
                        errors[i]);
                    return (cb(null));
                }
            }

            var m = sprintf('job %s (%s) failed: %s: %s',
                    job.name, job_uuid, result.name,
                    result.error);
            m = result.error.message ? result.error.message : m;
            return (cb(new Error(m)));
        }

        cb(null);
    });
}


/*
 * Poll a job until it reaches either the succeeded or failed state.
 *
 * Note: if a job fails, it's the caller's responsibility to check for a failed
 * job.  The error object will be null even if the job fails.
 */
function pollJob(job_uuid, cb) {
    var vmapi = this.vmapi;
    var log = this.log;

    var attempts = 0;
    var errors = 0;

    var timeout = 5000;  // 5 seconds
    var limit = 720;     // 1 hour

    log.info('polling job %s', job_uuid);

    var poll = function () {
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
                    return (setTimeout(poll, timeout));
                }
            }

            log.debug({ job: job }, 'polling job %s (attempt %d)',
                job_uuid, attempts);

            if (job && job.execution === 'succeeded') {
                return (cb(null, job));
            } else if (job && job.execution === 'failed') {
                log.warn('job %s failed', job_uuid);
                return (cb(null, job));
            } else if (attempts > limit) {
                log.warn('polling for job %s completion ' +
                    'timed out after %d seconds',
                    job_uuid, limit * (timeout / 1000));
                return (cb(new Error(
                    'polling for job timed out'), job));
            }

            setTimeout(poll, timeout);
            return (null);
        });
    };

    poll();
}
