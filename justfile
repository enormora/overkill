export PATH := './node_modules/.bin:' + env_var('PATH')
packtory-node-options := '--max-old-space-size-percentage=75'
eslint-node-options := '--max-old-space-size-percentage=75'
type-overkill := './tools/type-tests/node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'

default:
    @just --list

compile: _build-packages
    tsc --build

_build-packages: benchmark-html-browser
    tsc --project source/tsconfig.sources.json --outDir target/package-build --tsBuildInfoFile target/buildcache/package-sources.tsbuildinfo

benchmark-html-browser:
    node build-benchmark-html.js

eslint *OPTIONS:
    NODE_OPTIONS="${NODE_OPTIONS:-} {{eslint-node-options}}" eslint . --cache --cache-location './target/.eslintcache' --cache-strategy content --max-warnings 0 {{OPTIONS}}

eslint-fix: (eslint '--fix')

lint-filename:
    ls-lint

lint-unused-code:
    knip

lint-dependencies:
    depcruise source eslint.config.js --config dependency-cruiser.config.js

lint-duplication *OPTIONS:
    jscpd source --config jscpd.json {{OPTIONS}}

lint: eslint lint-filename lint-unused-code lint-dependencies lint-duplication

lint-fix: eslint-fix

test-microtests: benchmark-html-browser
    overkill run --profile microtests

test-integration: benchmark-html-browser
    overkill run --profile runtime
    overkill run --profile mutation-campaigns

test-mutation-campaigns-extended: benchmark-html-browser
    overkill run --profile mutation-campaigns-extended

test-cli-integration: benchmark-html-browser
    overkill run --profile cli

test-microtests-with-coverage: benchmark-html-browser
    overkill run --profile microtests --coverage

test-types:
    for shard in 1 2 3 4 5 6 7 8; do just test-type-shard "$shard/8" || exit; done

test-type-shard shard:
    NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size-percentage=50" {{type-overkill}} run --config overkill.types.config.ts --profile types --shard {{quote(shard)}}

test-package-smoke: _build-packages
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" node source/integration-tests/package-smoke/support/pack-packages.ts
    overkill run --profile package-smoke

publish-dry-run: _build-packages
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" packtory publish

benchmark-mutation-cost: benchmark-html-browser
    overkill bench run --profile mutation-cost --seed 42 --order lexical

benchmark mode="compare" output="target/performance/full" reference="source/benchmarks/baselines/shared.json" compiler="cc": benchmark-html-browser
    node source/benchmarks/run-performance.entry-point.ts {{mode}} "{{output}}" all "{{reference}}" "{{compiler}}"
