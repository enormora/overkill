export PATH := './node_modules/.bin:' + env_var('PATH')
package-smoke-packages := '@overkill-dev/eslint-test,@overkill-dev/linearizability,@overkill-dev/differential,@overkill-dev/model,@overkill-dev/reporter-benchmark-html,@overkill-dev/baselines,@overkill-dev/bench,@overkill-dev/engine,@overkill-dev/assert,@overkill-dev/doubles,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run,@overkill-dev/stryker-runner,@overkill-dev/type-test,@overkill-dev/property,@overkill-dev/test,@overkill-dev/reporter-line,@overkill-dev/reporter-brief,@overkill-dev/reporter-dot,@overkill-dev/reporter-opentelemetry,@overkill-dev/output-renderer-github-actions'
eslint-smoke-packages := '@overkill-dev/eslint-test,@overkill-dev/engine,@overkill-dev/assert,@overkill-dev/property,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run'
mutation-smoke-packages := '@overkill-dev/engine,@overkill-dev/run,@overkill-dev/stryker-runner,@overkill-dev/reporter-line'
packtory-node-options := '--max-old-space-size-percentage=75'
eslint-node-options := '--max-old-space-size-percentage=75'

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
    depcruise source --config dependency-cruiser.config.js

lint-duplication *OPTIONS:
    jscpd source --config jscpd.json {{OPTIONS}}

lint: eslint lint-filename lint-unused-code lint-dependencies lint-duplication

lint-fix: eslint-fix

test-unit: benchmark-html-browser
    overkill run --profile unit

test-integration: benchmark-html-browser
    overkill run --profile integration
    overkill run --profile mutation-campaigns

test-runner-integration: test-integration

test-process-integration: benchmark-html-browser
    overkill run --profile process

test-unit-with-coverage: benchmark-html-browser
    overkill run --profile unit --coverage

test-type-test-api:
    overkill run --profile compiler-assessment

test-types:
    TSTYCHE_TYPESCRIPT_SPECIFIER=typescript tstyche

_pack-smoke-packages packages: _build-packages
    rm -rf source/integration-tests/package-smoke/node_modules
    rm -rf target/package-smoke
    mkdir -p target/package-smoke/node_modules
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES={{packages}} packtory pack --all --format folder --version 0.0.0 --vendor-dependencies --out target/package-smoke/node_modules
    ln -s ../../../target/package-smoke/node_modules source/integration-tests/package-smoke/node_modules

test-model-package-smoke: _build-packages
    rm -rf source/integration-tests/package-smoke/node_modules
    rm -rf target/model-package-smoke
    mkdir -p target/model-package-smoke/node_modules/@overkill-dev
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES=@overkill-dev/model,@overkill-dev/property,@overkill-dev/engine,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run packtory pack @overkill-dev/model --format folder --version 0.0.0 --vendor-dependencies --out target/model-package-smoke/node_modules/@overkill-dev/model
    ln -s model/node_modules/@overkill-dev/engine target/model-package-smoke/node_modules/@overkill-dev/engine
    ln -s model/node_modules/@overkill-dev/property target/model-package-smoke/node_modules/@overkill-dev/property
    ln -s ../../../target/model-package-smoke/node_modules source/integration-tests/package-smoke/node_modules
    overkill run --profile package-smoke source/integration-tests/package-smoke/model.test.ts
    rm -rf source/integration-tests/package-smoke/node_modules

test-linearizability-package-smoke: _build-packages
    rm -rf source/integration-tests/package-smoke/node_modules
    rm -rf target/linearizability-package-smoke
    mkdir -p target/linearizability-package-smoke/node_modules/@overkill-dev
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES=@overkill-dev/linearizability,@overkill-dev/assert,@overkill-dev/model,@overkill-dev/property,@overkill-dev/engine,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run packtory pack @overkill-dev/linearizability --format folder --version 0.0.0 --vendor-dependencies --out target/linearizability-package-smoke/node_modules/@overkill-dev/linearizability
    ln -s linearizability/node_modules/@overkill-dev/engine target/linearizability-package-smoke/node_modules/@overkill-dev/engine
    ln -s linearizability/node_modules/@overkill-dev/property target/linearizability-package-smoke/node_modules/@overkill-dev/property
    ln -s ../../../target/linearizability-package-smoke/node_modules source/integration-tests/package-smoke/node_modules
    overkill run --profile package-smoke source/integration-tests/package-smoke/linearizability.test.ts
    rm -rf source/integration-tests/package-smoke/node_modules

test-eslint-package-smoke: _build-packages
    rm -rf source/integration-tests/package-smoke/node_modules
    rm -rf target/eslint-package-smoke
    mkdir -p target/eslint-package-smoke/node_modules/@overkill-dev
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES={{eslint-smoke-packages}} packtory pack @overkill-dev/eslint-test --format folder --version 0.0.0 --vendor-dependencies --out target/eslint-package-smoke/node_modules/@overkill-dev/eslint-test
    ln -sfn eslint-test/node_modules/@overkill-dev/engine target/eslint-package-smoke/node_modules/@overkill-dev/engine
    ln -s ../../../target/eslint-package-smoke/node_modules source/integration-tests/package-smoke/node_modules
    overkill run --profile package-smoke source/integration-tests/package-smoke/eslint-test.test.ts
    rm -rf source/integration-tests/package-smoke/node_modules

test-mutation-package-smoke: (_pack-smoke-packages mutation-smoke-packages)
    overkill run --profile package-smoke source/integration-tests/package-smoke/stryker-runner.test.ts
    rm -rf source/integration-tests/package-smoke/node_modules

test-package-smoke: (_pack-smoke-packages package-smoke-packages)
    overkill run --profile package-smoke
    rm -rf source/integration-tests/package-smoke/node_modules

publish-dry-run: _build-packages
    rm -rf source/integration-tests/package-smoke/node_modules
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" packtory publish

benchmark-mutation-cost: benchmark-html-browser
    overkill bench run --profile mutation-cost --seed 42 --order lexical

test-type-test-package-smoke: (_pack-smoke-packages "@overkill-dev/engine,@overkill-dev/run,@overkill-dev/type-test")
    overkill run --profile package-smoke source/integration-tests/package-smoke/type-test.test.ts
    rm -rf source/integration-tests/package-smoke/node_modules
