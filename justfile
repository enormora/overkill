export PATH := './node_modules/.bin:' + env_var('PATH')
package-smoke-packages := '@overkill-dev/reporter-benchmark-html,@overkill-dev/baselines,@overkill-dev/bench,@overkill-dev/engine,@overkill-dev/assert,@overkill-dev/doubles,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run,@overkill-dev/stryker-runner,@overkill-dev/property,@overkill-dev/test,@overkill-dev/reporter-line,@overkill-dev/reporter-brief,@overkill-dev/reporter-dot,@overkill-dev/reporter-opentelemetry,@overkill-dev/output-renderer-github-actions'

default:
    @just --list

compile: benchmark-html-browser
    tsc --build
    tsc --project source/tsconfig.sources.json --outDir target/package-build --tsBuildInfoFile target/buildcache/package-sources.tsbuildinfo

benchmark-html-browser:
    node build-benchmark-html.js

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

test-unit: benchmark-html-browser
    node source/overkill.test.ts

test-runner-integration: benchmark-html-browser
    node source/integration-tests/run/runner-property-policy.test.ts
    node source/integration-tests/run/runner-benchmark-html.test.ts
    node source/integration-tests/run/runner-measurements.test.ts
    node source/integration-tests/run/runner-supervised-cancellation.test.ts
    node source/integration-tests/run/runner-mutation-execution.test.ts
    node source/integration-tests/run/runner-stryker-lifecycle.test.ts
    node source/integration-tests/run/runner-collected-lifecycle.test.ts
    node source/integration-tests/run/runner-workloads.test.ts
    node source/integration-tests/run/runner-benchmark-baseline-cli.test.ts
    node source/integration-tests/run/runner-benchmark-baseline-failures.test.ts
    node source/integration-tests/run/runner-benchmark-baselines.test.ts
    node source/integration-tests/run/runner-mutation-policy.test.ts
    node source/integration-tests/run/runner-mutation-boundaries.test.ts
    node source/integration-tests/run/runner-frozen-policy.test.ts
    node source/integration-tests/run/runner-frozen-policy-activation.test.ts
    node source/integration-tests/run/runner-benchmarks.test.ts
    node source/integration-tests/run/runner-attachments.test.ts
    node source/integration-tests/run/runner-attachment-retention.test.ts
    node source/integration-tests/run/runner-retries.test.ts
    node source/integration-tests/run/runner-ipc-results.test.ts
    node source/integration-tests/run/runner-coverage-branches.test.ts
    node source/integration-tests/run/runner-coverage.test.ts
    node source/integration-tests/run/runner-coverage-records.test.ts
    node source/integration-tests/run/runner-coverage-sources.test.ts
    node source/integration-tests/run/runner-explicit-files.test.ts
    node source/integration-tests/run/runner-supervised-timeouts.test.ts
    node source/integration-tests/run/runner-file-sets.test.ts
    node source/integration-tests/run/runner-command-line.test.ts
    node source/integration-tests/run/runner-capability-policy.test.ts
    node source/integration-tests/run/runner-process-policy.test.ts

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
    node target/build/source/integration-tests/package-smoke/run-lifecycle.test.js
    node target/build/source/integration-tests/package-smoke/benchmark-html.test.js
    node target/build/source/integration-tests/package-smoke/bench.test.js
    node target/build/source/integration-tests/package-smoke/property.test.js
    node target/build/source/integration-tests/package-smoke/stryker-runner.test.js
    node target/build/source/integration-tests/package-smoke/test-binary.test.js
    node target/build/source/integration-tests/package-smoke/test-binary-attachments.test.js
    node target/build/source/integration-tests/package-smoke/test-binary-coverage.test.js
    rm -rf target/build/source/integration-tests/package-smoke/node_modules

publish-dry-run: compile
    rm -rf target/build/source/node_modules
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    packtory publish
