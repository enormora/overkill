import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
async function executeNode(nodeArguments: readonly string[]): Promise<string> {
    return new Promise(function runPackagedCli(resolve, reject) {
        execFile(process.execPath, nodeArguments, { cwd: directory }, function cliCompleted(error, stdout) {
            if (error instanceof Error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}
const binary = path.join(directory, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js');
const fixture = 'attachment-smoke.test.mjs';
const configuration = 'attachment-overkill.config.js';
const reportSchema = z.object({
    status: z.literal('passed'),
    artifacts: z.array(z.object({
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
type PackagedAttachmentReport = { readonly artifacts: readonly z.infer<typeof reportSchema>['artifacts'][number][]; };
const fixtureScript = [
    "import { test } from '@overkill-dev/test';",
    "import { defineResource, withResource } from '@overkill-dev/test/resources';",
    'const resource = defineResource({',
    "    name: 'fixture', scope: 'per-case', requirements: [], dispose: null,",
    '    async acquire({ attachments }) {',
    "        await attachments.json({ name: 'setup', mediaType: 'application/json' }, { ready: true });",
    '        return {};',
    '    }',
    '});',
    "export const testNode = test('package attachments', withResource(resource, async (scope) => {",
    "    const log = await scope.attachments.open({ kind: 'text', name: 'log', mediaType: 'text/plain' });",
    "    await log.write('packaged service ready');",
    '    await log.close();',
    "    const screenshot = await scope.attachments.open({ kind: 'binary', name: 'screenshot', mediaType: 'image/png' });",
    '    await screenshot.write(new Uint8Array([137, 80, 78, 71]));',
    '    const screenshotArtifact = await screenshot.close();',
    "    scope.assert.equal(screenshotArtifact.payload.content.kind, 'file');",
    '    return scope.assert.collect();',
    '}));'
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
    '        onResult(result) { process.stdout.write(JSON.stringify({status: result.status, artifacts: result.artifacts})); }',
    '    }; })]',
    '});'
]
    .join('\n');
async function assertPackagedContent(scope: TestScope, report: PackagedAttachmentReport): Promise<void> {
    for (const artifact of report.artifacts) {
        const { content } = artifact.payload;
        if (content.kind === 'text') {
            scope.assert.equal(content.text, 'packaged service ready');
        } else if (content.kind === 'file') {
            scope.assert.deepEqual(Array.from(await readFile(path.join(directory, content.path))), [ 137, 80, 78, 71 ]);
        }
    }
}
async function assertPackagedAttachments(scope: TestScope): Promise<void> {
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
    ]);
    const value: unknown = JSON.parse(output);
    const report = reportSchema.parse(value);
    scope.assert.equal(report.artifacts.length, 3);
    await assertPackagedContent(scope, report);
}
export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/test-binary-attachments.test.ts',
    children: [
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged fixtures and wrapped bodies share runner attachments',
            async body(scope: TestScope) {
                await assertPackagedAttachments(scope);
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
