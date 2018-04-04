<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2018, Joyent, Inc.
-->

# sdc-sapi

SAPI is the Services API, one of the core services of Triton DataCenter
("Triton" for short). This API allows operators to specify, configure, deploy,
and upgrade applications in Triton. Specifically, SAPI is used to hold the
configuration data for the services and instances that make up Triton itself --
grouped under the "sdc" SAPI application. The "sdc" app name is historical:
Triton DataCenter was initially known as SmartDataCenter (SDC).
See [the SAPI docs](docs/index.md).

Note: This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.


# Development

Typically, development of SAPI is done in
[COAL](https://github.com/joyent/triton#getting-started) (a
Triton-in-a-local-VMware-VM). It should be possible to run a SAPI server
locally, but that's not well supported.

## Quick dev cycle

Warning: "./tools/rsync-to" is not a fully faithful build.

1. Get a COAL running, including optionally a "coal" alias in your "~/.ssh/config" file:

        Host coal
            User root
            Hostname 10.99.99.7
            StrictHostKeyChecking no
            UserKnownHostsFile /dev/null

2. Get a local clone of the repo:

        git clone git@github.com:joyent/sdc-sapi.git
        cd sdc-sapi
        make

3. Make local edits to JS files, and sync those changes to your COAL:

        ./tools/rsync-to coal

   Warning: This method is *not perfect*. In particular, it allows for syncing
   changes from a different architecture and OS, so binary modules can not
   be handled. However, this can be handle for a quicker dev cycle to start.

## Building SAPI images

The more "correct" dev cycle, at least for final testing, is to create a new
SAPI image for your changes. This can be done by following the procedure for
building Triton component images defined [here](https://github.com/joyent/mountain-gorilla/blob/master/README.md).
Or, for Joyent employees, you can use our Jenkins and the `TRY_BRANCH` build
option:

1. Push your change to a feature branch of https://github.com/joyent/sdc-sapi

2. Build the "sapi" Jenkins job with `TRY_BRANCH=<your feature branch name>`.

3. After the image is built, run this in COAL to update your SAPI using the
   latest "sapi" image on the "experimental" channel of updates.joyent.com:

        sdcadm up -C experimental sapi


## Commiting

Before pushing, ensure your changes pass:

    make prepush

Also, directly pushes to "master" are not allowed. Changes must go through
Joyent's Gerrit CR. See the note and link for contribution guidelines above.


# Testing

In addition to the test suite (see below), any significant changes to SAPI
should also run through both (a) creating a SAPI image and updating SAPI in
COAL using that (see "Building SAPI images" above) and (b) creating and
setting up a new COAL using that SAPI image. The latter is important because
SAPI is an early core zone in Triton DataCenter headnode setup, with
interactions that are only tested with headnode setup.

## Testing headnode setup

If you created a `TRY_BRANCH` build of SAPI via Jenkins (see above), you can
use that SAPI image in a new COAL via something like:

    git clone git@github.com:joyent/sdc-headnode.git
    cd sdc-headnode

Include something like the following in "sdc-headnode/build.spec.local":

    {
        "build-tgz": "false",
        "zones": {
            "sapi": {
                "source": "manta",
                "branch": "<feature branch name>"
            }
        }
    }

Then run:

    make coal-and-open

If successful, that will create a COAL VMware VM using your custom SAPI
image, start the VM, and setup the headnode successfully.


## Test suite

Testing prerequisites:

- Set the marker file that allows testing in a TritonDC:

        ssh coal
        touch /lib/sdc/.sdc-test-no-production-data

- Ensure that dev sample data has been added to your COAL:

        sdcadm post-setup common-external-nics
        sdcadm post-setup dev-sample-data


To test, SSH to your test machine and run the "runtests" driver script:

    ssh coal
    sdc-login -l sapi
    /opt/smartdc/sapi/tests/runtests

To run a single test (for example):

    TEST_SAPI_PROTO_MODE=false ./node_modules/.bin/nodeunit \
        ./test/mode.test.js -t 'upgrade to full mode'

When running tests, the SAPI SMF service will be disabled so the server logs
will be rewritten by nodeunit on a separate file located at:

    /opt/smartdc/sapi/test/tests.log
