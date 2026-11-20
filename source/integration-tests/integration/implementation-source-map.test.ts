import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type TestNode, table, suite, test } from '@overkill-dev/test';

import convertSourceMap from 'convert-source-map';
import { createTemporaryDirectoryResource, startResources } from '../../packages/resources/resources.entry-point.ts';

import { deliverImplementationSource } from '../../implementation-source-map.ts';
import {
    defineImplementationReference,
    prepareImplementation,
    type PreparedImplementation
} from '../../packages/engine/engine.entry-point.ts';

const probeTimeoutMilliseconds = 30_000;

function probeScript(directory: string): string {
    const graphUrl = new URL('../../implementation-graph.ts', import.meta.url);
    const bodyUrl = pathToFileURL(join(directory, 'body.mjs')).href;
    const mapUrl = pathToFileURL(join(directory, 'maps/body.map')).href;
    return [
        `import { prepareImplementationGraph, withImplementationGraph } from ${JSON.stringify(graphUrl.href)};`,
        "import { writeFile } from 'node:fs/promises';",
        `const module = { moduleUrl: ${JSON.stringify(bodyUrl)}, exportName: 'body' };`,
        "const facts = { module, realm: 'host', version: '1', input: null, dynamicModules: [] };",
        'const graph = await prepareImplementationGraph([ facts ]);',
        `await writeFile(new URL(${JSON.stringify(mapUrl)}), JSON.stringify({`,
        "version: 3, sources: [ '../source/changed.ts' ], names: [], mappings: 'AAAA' }));",
        'await withImplementationGraph(graph, async function inspect(load) {',
        'const {namespace} = await load(module.moduleUrl);',
        'console.log(namespace.body.implementation());',
        '});'
    ]
        .join('\n');
}

async function executeProbe(directory: string, signal: Readonly<AbortSignal>): Promise<string> {
    return await new Promise<string>(function runProbe(resolve, reject) {
        execFile(
            process.execPath,
            [ '--enable-source-maps', '--input-type=module', '--eval', probeScript(directory) ],
            { timeout: probeTimeoutMilliseconds, signal },
            function completed(error, stdout) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error('Native source-map probe failed.', { cause: error }));
                }
            }
        );
    });
}

function templateWithDirective(value: string): string {
    return `${value} //# sourceMappingURL=missing.map`;
}

const inlineMap = {
    version: 3,
    sources: [ 'original.ts' ],
    sourcesContent: [ 'export const original = 42;' ],
    names: [],
    mappings: 'AAAA'
} as const;
const inlineMapContent = JSON.stringify(inlineMap);
function inlineMapUrl(encoding: 'base64' | 'percent-encoded'): string {
    return encoding === 'base64'
        ? `data:application/json;base64,${Buffer.from(inlineMapContent).toString('base64')}`
        : `data:application/json,${encodeURIComponent(inlineMapContent)}`;
}
async function prepareInlineImplementation(
    directory: string,
    reference: string,
    signal: AbortSignal
): Promise<PreparedImplementation> {
    await writeFile(
        join(directory, 'body.mjs'),
        [
            'export const body={version:"1",implementation:42};',
            `/*# sourceMappingURL=${reference} */`
        ]
            .join('\n')
    );
    return await prepareImplementation({
        reference: defineImplementationReference({
            module: { moduleUrl: pathToFileURL(join(directory, 'body.mjs')).href, exportName: 'body' },
            realm: 'host',
            version: '1',
            input: null,
            dynamicModules: [],
            parseInput() {
                return null;
            }
        }),
        context: { projectRoot: directory },
        signal
    });
}

export const testNode: TestNode = suite('immutable source-map delivery', [
    test(
        'ignores ordinary comments and map directives embedded in template literals',
        async function (scope) {
            const source = `// ordinary comment\n${templateWithDirective.toString()}\n/* ordinary block comment */`;
            const delivered = await deliverImplementationSource(source, 'file:///project/body.mjs');
            scope.assert.equal(delivered.source, source);
            scope.assert.equal(delivered.sourceMap, null);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'freezes inline maps with original source contents',
        cases: [ 'base64', 'percent-encoded' ] as const,
        caseTitle(encoding) {
            return encoding;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            await using session = await startResources({
                resources: { directory: createTemporaryDirectoryResource('directory') },
                signal: scope.signal
            });
            const reference = inlineMapUrl(scope.parameters);
            const prepared = await prepareInlineImplementation(
                session.context.directory.path,
                reference,
                scope.signal
            );
            const module = prepared.graph.modules[0];
            require.defined(module);
            require.notNull(module.sourceMap);
            scope.assert.deepEqual(module.sourceMap, { url: reference, source: inlineMapContent });
            scope.assert.deepEqual<unknown, unknown>(convertSourceMap.fromSource(module.source)?.toObject(), {
                ...inlineMap,
                ignoreList: [],
                sourceRoot: '',
                sources: [ URL.parse('original.ts', module.url)?.href ]
            });
            return scope.assert.collect();
        }
    }),
    test('renders the frozen map when external map bytes change after admission', async function (scope) {
        await using session = await startResources({
            resources: { directory: createTemporaryDirectoryResource('directory') },
            signal: scope.signal
        });
        const { path: directory } = session.context.directory;
        await mkdir(join(directory, 'maps'));
        await writeFile(
            join(directory, 'body.mjs'),
            [
                "export const body = { version: '1', implementation() { return new Error('mapped').stack; } };",
                '//# sourceMappingURL=maps/body.map',
                ''
            ]
                .join('\n')
        );
        await writeFile(
            join(directory, 'maps/body.map'),
            JSON.stringify({
                version: 3,
                sources: [ '../source/original-a.ts' ],
                names: [],
                mappings: 'AAAA'
            })
        );
        const output = await executeProbe(directory, scope.signal);
        scope.assert.true(output.includes('/source/original-a.ts'));
        scope.assert.false(output.includes('/source/changed.ts'));
        return scope.assert.collect();
    })
]);
