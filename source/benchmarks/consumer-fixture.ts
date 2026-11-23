import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from 'ts-pattern';
import type { PerformanceCase } from './performance-cases.ts';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceImports = new Map([
    [ '@overkill-dev/engine', 'engine/engine.entry-point.ts' ],
    [ '@overkill-dev/run', 'run/run.entry-point.ts' ],
    [ '@overkill-dev/run/config', 'run/config.entry-point.ts' ],
    [ '@overkill-dev/test', 'test/test.entry-point.ts' ],
    [ '@overkill-dev/test/bench', 'test/bench.entry-point.ts' ],
    [ '@overkill-dev/test/config', 'test/config.entry-point.ts' ],
    [ '@overkill-dev/test/property', 'test/property.entry-point.ts' ],
    [ '@overkill-dev/test/reporters', 'test/reporters.entry-point.ts' ],
    [ '@overkill-dev/test/resources', 'test/resources.entry-point.ts' ],
    [ '@overkill-dev/type-test', 'type-test/type-test.entry-point.ts' ]
]);

function sourceImportsFrom(directory: string, content: string): string {
    return content.replaceAll(
        /(?<quote>['"])(?<specifier>@overkill-dev\/[a-z/-]+)\k<quote>/gu,
        function checkoutImport(_quoted, _quote, specifier: string) {
            const entry = sourceImports.get(specifier);
            if (entry === undefined) {
                throw new Error(`Unknown benchmark import ${specifier}`);
            }
            return JSON.stringify(`./${relative(directory, join(sourceRoot, 'packages', entry))}`);
        }
    );
}

export async function writeBenchmarkTemplate(directory: string, filename: string): Promise<void> {
    const content = await readFile(new URL(`${filename}.txt`, import.meta.url), 'utf8');
    await writeFile(join(directory, filename), sourceImportsFrom(directory, content));
}

const compiler = { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' };
const innerSamples = 2;
const propertyTrials = 16;
const imports = {
    suite: "import { suite } from '@overkill-dev/test';",
    ordinary: "import { suite, test } from '@overkill-dev/test';",
    property: "import { gen, property } from '@overkill-dev/test/property';",
    resources: "import { defineResource, withResource } from '@overkill-dev/test/resources';",
    engine: "import { createTestCase, type TestScope } from '@overkill-dev/engine';",
    typeTest: "import { sameType } from '@overkill-dev/type-test';",
    benchmark: "import * as bench from '@overkill-dev/test/bench';"
};

const slowCaseMilliseconds = 80;
const regularCaseMilliseconds = 1;
const passingBody = 'scope.assert.equal(42, 42); return scope.assert.collect();';
const runtimeBodies = {
    compiler: 'scope.assert(sameType<number, number>()); return scope.assert.collect();',
    resources: 'scope.assert.equal(scope.resources.fixture, 42); return scope.assert.collect();'
};

function asynchronousCase(title: string, straggler: boolean): string {
    const delayed = straggler
        ? `await new Promise(resolve => setTimeout(resolve,
            process.env.OVERKILL_PERFORMANCE_PRIME === 'yes' ? ${regularCaseMilliseconds} : ${slowCaseMilliseconds}));`
        : 'await Promise.resolve();';
    return `test({ title: ${title}, controls: { duplicateExecution: 'idempotent' }, async body(scope) {
        ${delayed}
        ${passingBody}
    } })`;
}

function runtimeCase(title: string, workload: PerformanceCase['workload'], first: boolean): string {
    return match(workload)
        .with('async', 'straggler', function asynchronous(kind) {
            return asynchronousCase(title, kind === 'straggler' && first);
        })
        .with('list', 'list-filtered', 'list-with-locations', function discoveryTest() {
            return `test(${title}, () => { throw new Error('Listing executed a test body'); })`;
        })
        .with('report-line-failure', 'report-github-failure', function reportingFailure() {
            const body = first
                ? [
                    "scope.assert.deepEqual({ account: { roles: ['reader'] } }, { account: { roles: ['writer'] } });",
                    'return scope.assert.collect();'
                ]
                    .join(' ')
                : passingBody;
            return `test(${title}, scope => { ${body} })`;
        })
        .with('run-control', 'run-coverage', 'run-timings', function observedTest() {
            return `test(${title}, scope => {
                scope.assert.equal(chooseValue(true), 42);
                return scope.assert.collect();
            })`;
        })
        .with('resources', function resourceTest() {
            return `test(${title}, withResource(resource, scope => { ${runtimeBodies.resources} }))`;
        })
        .with('resident', function residentResourceTest() {
            return `test(${title}, withResource(resource, async scope => {
                await new Promise(resolve => setTimeout(resolve, 40));
                scope.assert.equal(scope.resources.fixture[0], 42);
                return scope.assert.collect();
            }))`;
        })
        .with('compiler', function compilerTest() {
            return `createTestCase({
                title: ${title}, annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ],
                body(scope: TestScope) { ${runtimeBodies.compiler} }
            })`;
        })
        .otherwise(function assertionTest() {
            return `test(${title}, scope => { ${passingBody} })`;
        });
}

function propertyCase(title: string, workload: PerformanceCase['workload']): string {
    const asynchronous = workload === 'async';
    const delay = asynchronous ? 'await Promise.resolve();' : '';
    return `property({
        title: ${title},
        settings: { newTrials: ${propertyTrials}, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
        generator: gen.integer({ min: 1, max: 100 }),
        ${asynchronous ? 'async' : ''} test(value, scope) {
            ${delay}
            scope.assert.greaterThan(value, 0);
            return scope.assert.collect();
        }
    })`;
}

function innerBenchmark(title: string, workload: PerformanceCase['workload']): string {
    const kind = workload === 'artifact' ? 'bundle-size' : 'runtime';
    return `bench.benchmark(${title}, {
        kind: '${kind}', workloads: [bench.workload('fixed', { size: 4096 })],
        measurement: bench.rawMeasurement(bench.measurementStrategy([])),
        measure({ sample, workload }) {
            const measured = sample.measure(() => Buffer.alloc(workload.parameters.size).byteLength);
            return { bytes: measured.value };
        },
        diagnosticMetrics: [],
        budgets: {fixed: { bytes: { maximum: 4096, statistic: { kind: 'observed-maximum' } } }}
    }, {
        annotations: {}, controls: {},
        sampling: { ...bench.defaultSamplingPolicy, minimumSamples: ${innerSamples}, maximumSamples: ${innerSamples} },
        lifecycle: { warmupSamples: 0, cooldown: { mode: 'off' }, garbageCollection: 'off' }
    })`;
}

function resourceDeclarations(value: string): readonly string[] {
    return [
        imports.ordinary,
        imports.resources,
        `const resource = defineResource({
            name: 'fixture', scope: 'per-case', requirements: [], dependencies: {},
            acquire() { return ${value}; }, dispose() {}
        });`
    ];
}

function declarations(spec: PerformanceCase): readonly string[] {
    return match(spec)
        .with({ family: 'property' }, function propertyImports() {
            return [ imports.ordinary, imports.property ];
        })
        .with({ family: 'type-test' }, function typeTestImports() {
            return [ imports.suite, imports.engine, imports.typeTest ];
        })
        .with({ family: 'benchmark' }, function benchmarkImports() {
            return [ imports.ordinary, imports.benchmark ];
        })
        .when(function measuresObservation({ workload }) {
            return workload.startsWith('run-');
        }, function observedImports() {
            return [ imports.ordinary, "import { chooseValue } from './covered-operation.mjs';" ];
        })
        .with({ workload: 'resident' }, function residentResource() {
            return resourceDeclarations('Buffer.alloc(1024 * 1024, 42)');
        })
        .with({ workload: 'resources' }, function valueResource() {
            return resourceDeclarations('42');
        })
        .otherwise(function standardImports() {
            return [ imports.ordinary ];
        });
}

function testFile(spec: PerformanceCase, fileIndex: number): string {
    const suites = Array.from({ length: spec.suitesPerFile }, function suiteAt(_value, suiteIndex) {
        const cases = Array.from({ length: spec.casesPerSuite }, function caseAt(_entry, caseIndex) {
            const title = JSON.stringify(`case ${caseIndex}`);
            if (spec.family === 'property') {
                return propertyCase(title, spec.workload);
            }
            if (spec.family === 'benchmark') {
                return innerBenchmark(title, spec.workload);
            }
            return runtimeCase(title, spec.workload, fileIndex + suiteIndex + caseIndex === 0);
        });
        return `suite('suite ${suiteIndex}', [${cases.join(',\n')}])`;
    });
    return [ ...declarations(spec), `export const testNode = suite('file ${fileIndex}', [${suites.join(',\n')}]);` ]
        .join('\n');
}

async function writeCompilerProject(
    directory: string,
    modules: string,
    files: readonly string[]
): Promise<void> {
    await symlink(modules, join(directory, 'node_modules'), 'dir');
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                module: 'NodeNext',
                target: 'ESNext',
                lib: [ 'ESNext' ],
                strict: true,
                skipLibCheck: true,
                noEmit: true,
                allowImportingTsExtensions: true,
                types: [ 'node' ]
            },
            files
        })
    );
}

async function writeFixtureFiles(directory: string, spec: PerformanceCase, files: readonly string[]): Promise<void> {
    await Promise.all(files.map(async function (file, index) {
        return writeFile(join(directory, file), sourceImportsFrom(directory, testFile(spec, index)));
    }));
    if (spec.workload.startsWith('run-')) {
        await writeFile(
            join(directory, 'covered-operation.mjs'),
            'export function chooseValue(enabled) { return enabled ? 42 : 0; }\n'
        );
    }
}

export async function writeConsumer(
    directory: string,
    modules: string,
    spec: PerformanceCase
): Promise<void> {
    await mkdir(directory, { recursive: true });
    const files = Array.from(
        { length: spec.files },
        function (_value, index) {
            return `file-${index}.${spec.family === 'type-test' ? 'mts' : 'mjs'}`;
        }
    );
    await writeFixtureFiles(directory, spec, files);
    for (const filename of [ 'consumer-config.mjs', 'consumer-driver.mjs', 'consumer-evidence.mjs' ]) {
        await writeBenchmarkTemplate(directory, filename);
    }
    const settings = { projectConfigPath: './tsconfig.json', compiler };
    await writeFile(
        join(directory, 'definition.json'),
        JSON.stringify({
            ...spec,
            files,
            settings,
            expected: {
                cases: spec.files * spec.suitesPerFile * spec.casesPerSuite,
                failed: Number(spec.workload.endsWith('-failure')),
                propertyTrials: spec.family === 'property' ? propertyTrials : 0,
                innerSamples: spec.family === 'benchmark' ? innerSamples : 0,
                policy: spec.route === 'engine' ? null : spec.execution,
                hosted: spec.hosted
            }
        })
    );
    if (spec.family === 'type-test') {
        await writeCompilerProject(directory, modules, files);
    }
}

export async function writeStartupConsumer(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    const fixture = [
        imports.ordinary,
        `export const testNode = test('one passing case', scope => { ${passingBody} });`
    ]
        .join('\n');
    await writeFile(join(directory, 'one.mjs'), sourceImportsFrom(directory, fixture));
    const config = `import { defineConfig } from '@overkill-dev/test/config';
        export const config = defineConfig({ runtimeStateDir: './state', profiles: { microtest: {
            testFamily: 'microtest', files: { include: [ 'one.mjs' ] },
            execution: { processModel: 'in-process', scheduling: 'serial' }
        } } });`;
    await writeFile(join(directory, 'overkill.config.mjs'), sourceImportsFrom(directory, config));
}
