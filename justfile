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

lint: eslint lint-filename

lint-fix: eslint-fix

test-unit:
    node --test --test-isolation='none' source/**/*.test.ts

publish-dry-run: compile
    packtory publish
