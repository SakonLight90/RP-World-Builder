#!/usr/bin/env bash
#
# Development start: the interface recompiles each page on request.
#
# Faster to start, and much slower to use. It is here for changing the code, not
# for playing: on this project a page took 3121 ms in development and 17 ms built,
# so a speed problem cannot be judged from this mode.
#
# The checks and the two-process handling live in start.sh, so there is one place
# that knows how to start the platform and not two that can disagree.
exec "$(dirname "$(readlink -f "$0")")/start.sh" --development