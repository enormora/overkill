import { suite, test } from '../packages/test/test.entry-point.ts';
import { processMeasurement, type ProcessRequest } from '../packages/bench/bench.entry-point.ts';
import { benchmarkDefinitionSchema } from '../run/benchmark-definition-schema.ts';
import { testNode as moduleContractsTestNode } from './module-contracts.test.ts';
import { parseProcessRequest, processRequestSchema } from './process-command.ts';
import { processOutput } from './process-output.ts';

const command = {
    command: [ 'node', 'cli.js' ],
    cwd: '/fixture',
    env: null,
    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
} as const;

export const testNode = suite('external process contracts', [
    moduleContractsTestNode,
    test('rejects incompatible stream selectors and terminal-only steps on pipes', function (scope) {
        scope.assert.false(
            processRequestSchema
                .safeParse({
                    ...command,
                    kind: 'pipes',
                    completion: { kind: 'ready', marker: { stream: 'terminal', text: 'Ready' } }
                })
                .success
        );
        scope.assert.false(
            processRequestSchema
                .safeParse({
                    ...command,
                    kind: 'pipes',
                    completion: { ...command.completion, steps: [ { kind: 'resize', columns: 80, rows: 24 } ] }
                })
                .success
        );
        return scope.assert.collect();
    }),
    test('requires a final output checkpoint and unique interaction names', function (scope) {
        const step = {
            kind: 'interaction',
            name: 'lookup',
            input: 'find\n',
            marker: { stream: 'stdout', text: 'done' }
        } as const;
        const request: ProcessRequest = {
            ...command,
            io: { kind: 'pipes' },
            completion: { kind: 'interaction', readiness: null, steps: [ step, step ] }
        };
        scope.assert.throws(function () {
            return parseProcessRequest(request);
        }, { message: /unique names/u });
        scope.assert.false(
            processRequestSchema
                .safeParse({
                    ...command,
                    kind: 'pipes',
                    completion: { kind: 'interaction', readiness: null, steps: [] }
                })
                .success
        );
        return scope.assert.collect();
    }),
    test('snapshots command arguments and environment without freezing caller data', function (scope) {
        const environment = { MODE: 'original' };
        const requestedCommand: [string, string] = [ 'node', 'cli.js' ];
        const input: ProcessRequest = {
            ...command,
            command: requestedCommand,
            env: environment,
            io: { kind: 'pipes' }
        };
        const parsed = parseProcessRequest(input);
        environment.MODE = 'changed';
        requestedCommand[1] = 'changed.js';
        scope.assert.equal(parsed.env?.MODE, 'original');
        scope.assert.deepEqual(parsed.command, [ 'node', 'cli.js' ]);
        scope.assert.true(Object.isFrozen(processMeasurement({ instrumentation: 'off' })));
        return scope.assert.collect();
    }),
    test('retains readable bounded output while counting bytes and matching later output', async function (scope) {
        const output = processOutput('pipes', 3);
        output.append('stdout', Buffer.from('éé'));
        const ready = output.expect({ stream: 'stdout', text: 'Ready' }, 'readiness');
        output.append('stdout', Buffer.from('Re'));
        output.append('stdout', Buffer.from('ady'));
        await ready;
        scope.assert.deepEqual(output.snapshot(), {
            kind: 'pipes',
            stdout: { text: 'é', bytes: 9, truncated: true },
            stderr: { text: '', bytes: 0, truncated: false }
        });
        return scope.assert.collect();
    }),
    test('matches readiness independently of script consumption', async function (scope) {
        const output = processOutput('pty', 0);
        output.append('terminal', Buffer.from('Ready\r\n'));
        await output.expect({ stream: 'terminal', text: 'Ready' }, 'script');
        const readiness = await output.expect({ stream: 'terminal', text: 'Ready' }, 'readiness');
        scope.assert.equal(typeof readiness, 'bigint');
        scope.assert.partialDeepEqual(output.snapshot(), { kind: 'terminal', terminal: { bytes: 7, truncated: true } });
        return scope.assert.collect();
    }),
    test('does not accept an old prompt as the response to new input', async function (scope) {
        const output = processOutput('pipes', 100);
        output.append('stdout', Buffer.from('Ready'));
        const response = output.expect({ stream: 'stdout', text: 'Ready' }, 'response');
        const beforeInput = await Promise.race([ response, Promise.resolve('pending') ]);
        scope.assert.equal(beforeInput, 'pending');
        output.append('stdout', Buffer.from('Ready'));
        const afterInput = await response;
        scope.assert.equal(typeof afterInput, 'bigint');
        return scope.assert.collect();
    }),
    test('rejects pending markers when the process output closes', async function (scope) {
        const output = processOutput('pipes', 100);
        const pending = output.expect({ stream: 'stdout', text: 'missing' }, 'readiness');
        output.finish(new Error('process closed'));
        await scope.assert.rejects(async function () {
            return pending;
        }, { message: 'process closed' });
        return scope.assert.collect();
    }),
    test('accepts process strategies in serialized benchmark definitions', function (scope) {
        const result = benchmarkDefinitionSchema.safeParse({
            kind: 'startup',
            lifecycle: null,
            workloads: [],
            diagnostics: [],
            budgets: {},
            measurement: processMeasurement({ instrumentation: 'node' }),
            policy: {
                confidenceLevel: 0.95,
                relativePrecision: 0.1,
                absolutePrecision: {},
                minimumSamples: 2,
                maximumSamples: 2
            }
        });
        scope.assert.true(result.success);
        return scope.assert.collect();
    })
]);
