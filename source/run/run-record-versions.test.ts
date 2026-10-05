import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { runRecordVersions } from './run-record-versions.ts';

async function withMetadataDirectory<Value>(work: (directory: string) => Promise<Value>): Promise<Value> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-version-'));
    try {
        return await work(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-record-versions.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'finds verified engine package metadata without importing its module',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withMetadataDirectory(async function assertPackageMetadata(directory) {
                    const modulePath = path.join(directory, 'nested', 'engine.ts');
                    await mkdir(path.dirname(modulePath));
                    await writeFile(modulePath, 'throw new Error("Must not import metadata");');
                    await writeFile(
                        path.join(directory, 'package.json'),
                        '{"name":"fixture-engine","version":"1.2.3"}'
                    );
                    const versions = await runRecordVersions({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: pathToFileURL(modulePath).href
                    }, '26.10.0');
                    scope.assert.equal(versions.engine, '1.2.3');
                    scope.assert.equal(versions.packages['fixture-engine'], '1.2.3');
                    scope.assert.equal(versions.node, '26.10.0');
                    return scope.assert.collect();
                });
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'records absent versions for invalid metadata and non-file engines',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withMetadataDirectory(async function assertPackageMetadata(directory) {
                    const moduleUrl = pathToFileURL(path.join(directory, 'engine.ts')).href;
                    for (const manifest of [ '{"name":"fixture-engine"}', 'invalid json' ]) {
                        await writeFile(path.join(directory, 'package.json'), manifest);
                        const versions = await runRecordVersions({
                            exportKind: 'value',
                            exportName: 'engine',
                            kind: 'module',
                            moduleUrl
                        }, '26');
                        scope.assert.equal(versions.engine, null);
                    }
                    const unavailable = await runRecordVersions({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: 'virtual:engine'
                    }, '26');
                    scope.assert.equal(unavailable.engine, null);
                    const absent = await runRecordVersions({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: 'file:///engine.ts'
                    }, '26');
                    scope.assert.equal(absent.engine, null);
                    return scope.assert.collect();
                });
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
