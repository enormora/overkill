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
    node --test --test-isolation='none' source/**/*.test.ts

test-unit-with-coverage:
    c8 --config .c8rc.json node --test --test-isolation='none' source/**/*.test.ts

publish-dry-run: compile
    packtory publish
