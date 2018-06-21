#!/usr/bin/env node

var execSync = require('child_process').execSync;
var fs = require('fs');
var path = require('path');

var assert = require('assert-plus');
var bunyan = require('bunyan');
var vasync = require('vasync');

var testCommon = require('../test/common');
var testHelper = require('../test/helper');

// Make sure that the alias used does not match all VMs
assert.string(testCommon.TEST_RESOURCES_NAME_PREFIX);
assert.notEqual(testCommon.TEST_RESOURCES_NAME_PREFIX, '');
assert.notEqual(testCommon.TEST_RESOURCES_NAME_PREFIX, '*');

var configJs = path.resolve(__dirname, '../lib/config.js');
var vmapiUrl = execSync(
    [
        process.execPath,
        configJs,
        'vmapi.url'
    ].join(' '),
    {encoding: 'utf8'}
);
var vmapiClient = testHelper.createVmapiClient(vmapiUrl);

var log = bunyan.createLogger({
    name: 'sapi-cleanup-test-resources',
    level: process.env.LOG_LEVEL || 'info',
    serializers: bunyan.stdSerializers
});

vasync.waterfall([
    function listTestVms(next) {
        vmapiClient.listVms({
            alias: testCommon.TEST_RESOURCES_NAME_PREFIX,
            state: 'active'
        }, function onTestVmsListed(err, testVms) {
            next(err, testVms);
            return;
        });
    },
    function deleteTestVms(testVms, next) {
        assert.arrayOfObject(testVms, 'testVms');
        assert.func(next, 'next');

        log.debug({testVms: testVms}, 'test vms to delete');

        vasync.forEachParallel({
            func: function _deleteTestVm(testVm, done) {
                assert.object(testVm, 'testVm');

                // Skip VMs that have already been deleted
                if (testVm.state === 'destroyed' &&
                    testVm.zone_state === 'destroyed') {
                    done();
                    return;
                } else {
                    vmapiClient.deleteVm({
                        uuid: testVm.uuid,
                        sync: true
                    }, done);

                    return;
                }
            },
            inputs: testVms
        }, next);
    }
], function cleanupDone(err) {
    if (err) {
        log.error({err: err}, 'Error when cleaning up test resources.');
    } else {
        log.info('Cleanup of test resources done successfully!');
    }
});
