import { execFile, type ExecException } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite } from '@overkill-dev/test';

import { z } from 'zod/v4';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer, type ConsumerScope } from './support/package-consumer.ts';

function cliExitCode(error: Readonly<ExecException> | null): number | null {
    if (error === null) {
        return 0;
    }
    return typeof error.code === 'number' ? error.code : null;
}

const fixture = 'attachment-smoke.test.mjs';
const configuration = 'attachment-overkill.config.js';
const reportSchema = z.object({
    status: z.literal('passed'),
    artifacts: z.array(z.object({
        id: z.object({ runtimes: z.array(z.object({ name: z.string() })) }),
        payload: z.object({
            kind: z.literal('runtime-attachment'),
            name: z.string(),
            content: z.union([
                z.object({ kind: z.literal('text'), text: z.string() }),
                z.object({ kind: z.literal('json'), value: z.json() }),
                z.object({ kind: z.literal('file'), path: z.string() })
            ])
        })
    }))
});

const fixtureScript = [
    "import { suite, test } from '@overkill-dev/test';",
    "import { defineResource, defineRuntime, withResource, withRuntime } from '@overkill-dev/test/resources';",
    'const resource = defineResource({',
    "    name: 'fixture', scope: 'per-case', requirements: [], dispose: null,",
    '    async acquire({ attachments }) {',
    "        await attachments.json({ name: 'setup', mediaType: 'application/json' }, { ready: true });",
    '        return {};',
    '    }',
    '});',
    "const runtime = defineRuntime({ name: 'runtime', dimensions: {}, requirements: [], resources: { fixture: resource } });",
    'async function capture(scope) {',
    "    const log = await scope.attachments.open({ kind: 'text', name: 'log', mediaType: 'text/plain' });",
    "    await log.write('packaged service ready');",
    '    await log.close();',
    "    const screenshot = await scope.attachments.open({ kind: 'binary', name: 'screenshot', mediaType: 'image/png' });",
    '    await screenshot.write(new Uint8Array([137, 80, 78, 71]));',
    '    const screenshotArtifact = await screenshot.close();',
    "    scope.assert.equal(screenshotArtifact.payload.content.kind, 'file');",
    '    return scope.assert.collect();',
    '}',
    "export const testNode = suite('package attachments', [",
    "    test('fixture', withResource(resource, capture)),",
    "    test('runtime', withRuntime(runtime, capture))",
    ']);'
]
    .join('\n');
const configScript = [
    "import { defineConfig } from '@overkill-dev/test/config';",
    "import { defineReporter } from '@overkill-dev/engine';",
    'export const config = defineConfig({',
    "    runtimeStateDir: 'attachment-smoke-state',",
    "    profiles: { attachments: { testFamily: 'integration', files: { include: ['attachment-smoke.test.mjs'] } } },",
    '    reporters: [defineReporter(function() { return {',
    "        kind: 'final-result', name: 'attachment-observer', dispose: null, sinks: [{kind: 'stdout-raw-primary'}],",
    '        onResult({ result }) {',
    "            if (result.status !== 'passed') process.stderr.write(JSON.stringify(result));",
    '            process.stdout.write(JSON.stringify({status: result.status, artifacts: result.artifacts}));',
    '        }',
    '    }; })]',
    '});'
]
    .join('\n');

const failureFixture = 'failure-artifact-smoke.test.mjs';
const failureConfiguration = 'failure-artifact-overkill.config.js';
const failureArtifactSchema = reportSchema.shape.artifacts.element.extend({
    id: reportSchema.shape.artifacts.element.shape.id.extend({ subtype: z.string() }),
    source: z.string()
});
const failureReportSchema = z.object({
    status: z.literal('failed'),
    runnerErrors: z.array(z.unknown()),
    artifacts: z.array(failureArtifactSchema)
});
const witnessSchema = z.object({
    version: z.literal(1),
    seed: z.null(),
    kind: z.literal('simulation'),
    producedBy: z.object({ library: z.literal('@overkill-dev/resources'), libraryVersion: z.literal('0.0.0') }),
    simulation: z.object({
        name: z.literal('api'),
        payload: z.object({ version: z.literal(1), interactions: z.array(z.unknown()) })
    })
});
const failureScript = [
    "import {suite, test} from '@overkill-dev/test';",
    "import {createSimulatedHttpServerResource, withResource} from '@overkill-dev/test/resources';",
    "import {defineSimulatedHttpServer} from '@overkill-dev/test/simulation';",
    "const api = createSimulatedHttpServerResource({address: {kind: 'loopback', port: 0}, simulation: defineSimulatedHttpServer({name: 'api', scenarios: {default: {title: 'ready'}}, handle() {return Response.json({ready: true});}})});",
    "export const testNode = suite('native evidence', [test('failed HTTP interaction', withResource(api, async (scope) => {const response = await fetch(scope.resources.api.baseUrl); await response.json(); scope.assert.fail(); return scope.assert.collect();}))]);"
]
    .join('\n');

const consumerFacade = packageConsumer('Installed attachment support', function consumerFixture(consumerDirectory) {
    const directory = fileURLToPath(pathToFileURL(`${consumerDirectory}/`));
    async function executeNode(nodeArguments: readonly string[], expectedExit: 0 | 1): Promise<string> {
        return new Promise(function runPackagedCli(resolve, reject) {
            execFile(process.execPath, [ '--disable-warning=PERM0004', ...nodeArguments ], {
                env: consumerEnvironment(directory),
                cwd: directory
            }, function cliCompleted(error, stdout, stderr) {
                if (cliExitCode(error) === expectedExit) {
                    resolve(stdout);
                } else {
                    reject(
                        new Error([ error?.message ?? 'Unexpected CLI exit code.', stdout, stderr ].join('\n'), {
                            cause: error
                        })
                    );
                }
            });
        });
    }
    const binary = path.join(directory, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js');

    const assertPackagedWitness = defineCompositeAssertion({
        name: 'packaged witness',
        async assert(check, artifact: Readonly<z.infer<typeof failureArtifactSchema>>) {
            const { content } = artifact.payload;
            if (content.kind !== 'file') {
                throw new Error('Expected packaged witness file.');
            }
            const value: unknown = JSON.parse(await readFile(path.resolve(directory, content.path), 'utf8'));
            const witness = witnessSchema.parse(value);
            await writeFile(
                path.join(directory, failureFixture),
                failureScript.replace(
                    'await response.json(); scope.assert.fail();',
                    'scope.assert.deepEqual(await response.json(), {ready: true});'
                )
            );
            const replay = await executeNode([
                binary,
                'replay-witness',
                content.path,
                '--profile',
                'attachments',
                '--config',
                failureConfiguration
            ], 0);
            return check.group([
                check.equal(artifact.source, 'native'),
                check.equal(witness.simulation.payload.interactions.length, 1),
                check.true(content.path.includes('witnesses/')),
                check.equal(reportSchema.parse(JSON.parse(replay)).status, 'passed')
            ]);
        }
    });
    return { directory, executeNode, binary, assertPackagedWitness };
});
const { test } = consumerFacade;

const sharedAttachmentEvidence = defineCompositeAssertion({
    name: 'fixtures and bodies retain their runtime attachments',
    async assert(check, report: Readonly<z.infer<typeof reportSchema>>, directory: string) {
        const textArtifacts = report.artifacts.flatMap(function textContent(artifact) {
            return artifact.payload.content.kind === 'text' ? [ artifact.payload.content.text ] : [];
        });
        const fileBytes = await Promise.all(report.artifacts.flatMap(function fileContent(artifact) {
            return artifact.payload.content.kind === 'file'
                ? [ readFile(path.join(directory, artifact.payload.content.path)) ]
                : [];
        }));
        return check.group([
            check.equal(report.artifacts.length, 6),
            check.equal(
                report
                    .artifacts
                    .filter(function belongsToRuntime(artifact) {
                        return artifact.id.runtimes.some(function fixtureRuntime(runtime) {
                            return runtime.name === 'runtime';
                        });
                    })
                    .length,
                3
            ),
            ...textArtifacts.map(function serviceMessage(text) {
                return check.equal(text, 'packaged service ready');
            }),
            ...fileBytes.map(function pngHeader(bytes) {
                return check.deepEqual(Array.from(bytes), [ 137, 80, 78, 71 ]);
            })
        ]);
    }
});

export const testNode = suite('Installed attachment support', [
    test('published runner and simulation packages share transcript attribution', async function (scope) {
        const { executeNode } = scope.resources.consumer;

        const script = [
            "import {runWithTranscriptScope} from '@overkill-dev/run/transcript-store';",
            "import {createHttpTranscriptRecorder} from '@overkill-dev/simulation/transcript';",
            'const recorder = createHttpTranscriptRecorder(); const owner = {case: "first"};',
            'await runWithTranscriptScope(owner, async () => { if (recorder.currentScope() !== owner) {throw new Error("Transcript attribution drifted.");} recorder.recordCaptureError("custom", "first", recorder.currentScope()); });',
            'await runWithTranscriptScope({case: "second"}, async () => {if (recorder.transcript.entryCount !== 0) {throw new Error("Transcript borrowed another attempt.");} await runWithTranscriptScope(null, async () => {if (recorder.transcript.entryCount !== 1) {throw new Error("Lifetime transcript evidence was lost.");}});});',
            'console.log("isolated");'
        ]
            .join('\n');
        scope.assert.equal(await executeNode([ '--input-type=module', '-e', script ], 0), 'isolated\n');
        return scope.assert.collect();
    }),
    test(
        'integration resources retain native witnesses with their producer version',
        async function (scope: ConsumerScope<typeof consumerFacade>) {
            const { directory, executeNode, binary, assertPackagedWitness } = scope.resources.consumer;

            const failureConfigScript = configScript
                .replaceAll(fixture, function () {
                    return failureFixture;
                })
                .replaceAll('attachment-smoke-state', 'failure-artifact-smoke-state')
                .replace(
                    'artifacts: result.artifacts',
                    'artifacts: result.artifacts, runnerErrors: result.runnerErrors'
                );
            await Promise.all([
                writeFile(path.join(directory, failureFixture), failureScript),
                writeFile(path.join(directory, failureConfiguration), failureConfigScript)
            ]);
            const output = await executeNode(
                [ binary, 'run', '--profile', 'attachments', '--config', failureConfiguration ],
                1
            );
            const report = failureReportSchema.parse(JSON.parse(output));
            scope.assert(
                defineCompositeAssertion({
                    name: 'integration resources retain native witnesses with their producer version',
                    assert(check) {
                        return check.group([
                            check.deepEqual(report.runnerErrors, []),
                            check.equal(report.artifacts.length, 2)
                        ]);
                    }
                })
            );
            const artifact = report.artifacts.find(function nativeWitness(entry) {
                return entry.id.subtype === 'witness';
            });
            scope.require.defined(artifact);
            await scope.assert(assertPackagedWitness, artifact);

            return scope.assert.collect();
        }
    ),
    test('fixtures and wrapped bodies share runner attachments', async function (scope) {
        const { directory, executeNode, binary } = scope.resources.consumer;

        await Promise.all([
            writeFile(path.join(directory, fixture), fixtureScript),
            writeFile(path.join(directory, configuration), configScript)
        ]);
        const output = await executeNode([
            binary,
            'run',
            '--profile',
            'attachments',
            '--config',
            configuration
        ], 0);
        const value: unknown = JSON.parse(output);
        const report = reportSchema.parse(value);
        await scope.assert(sharedAttachmentEvidence, report, directory);

        return scope.assert.collect();
    })
]);
