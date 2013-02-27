# Services API (SAPI)

Repository: <git@git.joyent.com:sapi.git>
Browsing: <https://mo.joyent.com/sapi>
Who: Bill Pijewski
Docs: <https://mo.joyent.com/docs/sapi/master>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/SAPI>


# Overview

See <https://mo.joyent.com/docs/sapi/master/#overview>.


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    etc/            Test configuration files for running SAPI locally
    lib/            Source files.
    node_modules/   Node.js dependencies
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using nodeunit)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run a SAPI server locally:

    git clone git@git.joyent.com:sapi.git
    cd sapi
    git submodule update --init
    make all
    node server.js

Before commiting/pushing run `make prepush` and, if possible, get a code
review.


# Testing

The etc/config.json defaults to SDC endpoints on bh1-kvm6.  If you're testing
SAPI against a different machine, modify those parameters or use
etc/config.coal.json.

    $ npm start
    $ (in a different shell) make test
