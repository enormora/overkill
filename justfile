export PATH := './node_modules/.bin:' + env_var('PATH')
package-smoke-packages := '@overkill-dev/engine,@overkill-dev/assert,@overkill-dev/doubles,@overkill-dev/run,@overkill-dev/test,@overkill-dev/reporter-line,@overkill-dev/reporter-brief,@overkill-dev/reporter-dot,@overkill-dev/output-renderer-github-actions'

default:
    @just --list

compile:
    tsc --build

eslint *OPTIONS:
    eslint . --cache --cache-location './target/.eslintcache' --cache-strategy content --max-warnings 0 {{OPTIONS}}

eslint-fix: (eslint '--fix')

lint-filename:
    ls-lint

lint-unused-code:
    knip

lint-dependencies:
    depcruise source --config dependency-cruiser.config.js

lint-duplication *OPTIONS:
    jscpd source --config jscpd.json {{OPTIONS}}

lint: eslint lint-filename lint-unused-code lint-dependencies lint-duplication

lint-fix: eslint-fix

test-unit:
    node source/overkill.test.ts

test-runner-integration:
    node source/integration-tests/run/runner-explicit-files.test.ts
    node source/integration-tests/run/runner-command-line.test.ts
    node source/integration-tests/run/runner-capability-policy.test.ts

test-unit-with-coverage:
    c8 --config .c8rc.json node source/overkill.test.ts

test-types:
    tstyche

test-package-smoke: compile
    rm -rf target/build/source/node_modules
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    rm -rf target/package-smoke
    mkdir -p target/package-smoke/node_modules
    PACKTORY_INCLUDED_PACKAGES={{package-smoke-packages}} packtory pack --all --format folder --version 0.0.0 --vendor-dependencies --out target/package-smoke/node_modules
    ln -s ../../../../package-smoke/node_modules target/build/source/integration-tests/package-smoke/node_modules
    node target/build/source/integration-tests/package-smoke/engine-direct-execution.test.js
    node target/build/source/integration-tests/package-smoke/test-binary.test.js
    rm -rf target/build/source/integration-tests/package-smoke/node_modules

publish-dry-run: compile
    rm -rf target/build/source/node_modules
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    packtory publish
