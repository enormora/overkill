import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlainOutputRenderer, createSuite, createTestCase } from '../../packages/engine/engine.entry-point.ts';
import { normalizeConfig, orchestrator, type FrozenRunCommand } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '#test-runner';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const bootstrapKey = 'overkillLifecycleBootstrap';
const importCountKey = 'overkillLifecycleImports';

async function bootstrapCommand(cwd: string): Promise<FrozenRunCommand> {
    const authored = {
        profiles: {
            microtest: {
                testFamily: 'microtest' as const,
                files: { include: [ 'test.mjs' ] as const },
                execution: { processModel: 'in-process' as const, scheduling: 'serial' as const }
            }
        }
    };
    await writeFile(
        join(cwd, 'overkill.config.mjs'),
        `
if (globalThis.${bootstrapKey} !== 'ready') throw new Error('config imported before bootstrap');
export const config = ${JSON.stringify(authored)};
`
    );
    const engineUrl = import.meta.resolve('../../packages/engine/engine.entry-point.ts');
    await writeFile(
        join(cwd, 'test.mjs'),
        `
import { createSuite, createTestCase } from ${JSON.stringify(engineUrl)};
if (globalThis.${bootstrapKey} !== 'ready') throw new Error('test imported before bootstrap');
globalThis.${importCountKey} = (globalThis.${importCountKey} ?? 0) + 1;
const metadata = {annotations: {}, controls: {}, definitionLocations: [{kind: 'unknown'}]};
export const testNode = createSuite({...metadata, title: 'bootstrap', children: [createTestCase({
    ...metadata, title: 'passes', body(scope) { scope.assert.equal(1, 1); return scope.assert.collect(); }
})]});
`
    );
    const policy = await orchestrator.freezePolicy({
        command: { config: normalizeConfig(authored), cwd, engine: { kind: 'default' }, request: defaultRunRequest() },
        moduleBoundary: null,
        source: {
            kind: 'config-file',
            request: { cwd, configPath: 'overkill.config.mjs' },
            resolvedPath: join(cwd, 'overkill.config.mjs')
        }
    });
    return {
        kind: 'frozen-policy',
        policy,
        invocation: { seed: { value: 42n }, selection: { kind: 'all' } },
        reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
    };
}

async function staleErrorProbe(): Promise<string> {
    return new Promise(function executeProbe(resolve, reject) {
        execFile(process.execPath, [ 'source/integration-tests/run/fixtures/collected-stale-error-probe.test.ts' ], {
            cwd: process.cwd(),
            timeout: 10_000
        }, function probeResult(error, stdout, stderr) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(`${error.message}\n${stderr}\n${stdout}`, { cause: error }));
            }
        });
    });
}

export const testNode = createSuite({
    ...metadata,
    title: 'public collected runner lifecycle',
    children: [
        createTestCase({
            ...metadata,
            title: 'caller bootstrap precedes configuration and test imports',
            async body(scope) {
                const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-collected-bootstrap-')));
                scope.cleanup(async function removeBootstrapProject() {
                    Reflect.deleteProperty(globalThis, bootstrapKey);
                    Reflect.deleteProperty(globalThis, importCountKey);
                    await rm(cwd, { recursive: true, force: true });
                });
                const initialized = await orchestrator.initialize(await bootstrapCommand(cwd));
                scope.assert.undefined(Reflect.get(globalThis, importCountKey));
                Reflect.set(globalThis, bootstrapKey, 'ready');
                const collected = await initialized.collect();
                const results = [
                    await collected.run({ selection: { kind: 'all' } }),
                    await collected.run({ selection: { kind: 'all' } })
                ];
                scope.assert.deepEqual({
                    imports: Number(Reflect.get(globalThis, importCountKey)),
                    statuses: results.map(function resultStatus(result) {
                        return result.status;
                    })
                }, { imports: 1, statuses: [ 'passed', 'passed' ] });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'late failures retain safe attribution and a surviving process remains reusable',
            async body(scope) {
                scope.assert.equal(await staleErrorProbe(), 'collected late error attribution passed\n');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
