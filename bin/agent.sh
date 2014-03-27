#!/bin/bash

###############################################################################
# Due to race conditions for dependent services, this script will first run
# the agent in synchronous mode, then fork an agent process in the background.
###############################################################################

set -o xtrace

DIR=$(dirname $(dirname $0))
EXEC="$DIR/build/node/bin/node $DIR/agent.js -f $DIR/etc/config.json"

echo 'Attempting synchronous mode until success.'
SUCCESS=1
while [[ $SUCCESS != 0 ]]; do
    $EXEC -s
    SUCCESS=$?
    if [[ $SUCCESS != 0 ]]; then
        echo 'Failed to run the agent in synchronous mode.  Sleeping...'
        sleep 1;
    fi
done

echo 'Starting the agent in daemon mode.'
$EXEC &
