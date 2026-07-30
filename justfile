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
    find source -path source/integration-tests -prune -o -name '*.test.ts' -exec node --test --test-isolation='none' {} +

test-unit-with-coverage:
    find source -path source/integration-tests -prune -o -name '*.test.ts' -exec c8 --config .c8rc.json node --test --test-isolation='none' {} +

test-types:
    tstyche

test-package-smoke: compile
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    mkdir -p target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev
    packtory pack @overkill-dev/engine --format folder --version 0.0.0 --out target/build/source/integration-tests/package-smoke/node_modules/@overkill-dev/engine
    node source/test-support/package-smoke-assert-installer.mjs
    node --test target/build/source/integration-tests/package-smoke/**/*.test.js

publish-dry-run: compile
    packtory publish
