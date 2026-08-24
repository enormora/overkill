export PATH := './node_modules/.bin:' + env_var('PATH')

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
    node source/integration-tests/run/runner-capability-policy.test.ts

test-unit-with-coverage:
    c8 --config .c8rc.json node source/overkill.test.ts

test-types:
    tstyche

test-package-smoke: compile
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    mkdir -p target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev
    packtory pack @overkill-dev/engine --format folder --version 0.0.0 --out target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev/engine
    packtory pack @overkill-dev/assert --format folder --version 0.0.0 --out target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev/assert
    packtory pack @overkill-dev/doubles --format folder --version 0.0.0 --out target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev/doubles
    packtory pack @overkill-dev/reporter-line --format folder --version 0.0.0 --out target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev/reporter-line
    node target/build/source/integration-tests/package-smoke/engine-direct-execution.test.js

publish-dry-run: compile
    packtory publish
