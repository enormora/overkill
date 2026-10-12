import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createWorkloadTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { workload, type Workload } from '../../../packages/bench/bench.entry-point.ts';
import {
    createLocalHttpServiceResource,
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    withResource,
    withRuntime,
    type WorkloadParameters,
    type RuntimeDefinition,
    type RuntimeTestScope
} from '../../../packages/test/resources.entry-point.ts';
import type { WorkloadTestCaseVariant, TestScope } from '../../../packages/engine/engine.entry-point.ts';

type PackageParameters = { readonly packages: number; };

function parsePackages(parameters: WorkloadParameters): PackageParameters {
    if (typeof parameters.packages !== 'number') {
        throw new TypeError('Expected a package count.');
    }
    return { packages: parameters.packages };
}

const registry = createLocalHttpServiceResource({
    address: { kind: 'loopback', port: 0 },
    dependencies: {},
    name: 'registry',
    requirements: [],
    scope: 'per-run',
    createServer() {
        return createServer(function serveRegistry(_request, response) { response.end('registry'); });
    },
    handle(service) { return { url: service.baseUrl }; },
    async dispose(_server, { attachments }) {
        await attachments.json({ name: 'registry-disposal', mediaType: 'application/json' }, { closed: true });
    },
    serializeHandle(handle) { return handle.url; },
    deserializeHandle(url: string) { return { url }; }
});

const workspace = defineResource({
    name: 'workspace', scope: 'per-run', requirements: [], workload: parsePackages,
    acquire() { return mkdtemp(join(tmpdir(), 'overkill-workload-')); },
    async dispose(cwd) { await rm(cwd, {recursive: true, force: true}); },
    serializeHandle(cwd) { return cwd; },
    deserializeHandle(cwd: string) { return cwd; }
});

const fixture = defineResource({
    name: 'publish-fixture',
    scope: 'per-run',
    requirements: [ { kind: 'capacity-weight', weight: 1 } ],
    dependencies: { registry, workspace },
    workload: parsePackages,
    async acquire({ workload: input, dependencies, attachments }) {
        const cwd = dependencies.workspace;
        await writeFile(join(cwd, 'packages.json'), JSON.stringify(input.parameters));
        const response = await fetch(dependencies.registry.url, {headers: {connection: 'close'}});
        if (await response.text() !== 'registry') {
            throw new Error('Registry fixture is unavailable.');
        }
        await attachments.json({ name: 'fixture-acquisition', mediaType: 'application/json' }, input.parameters);
        return { cwd, packages: input.parameters.packages };
    },
    async dispose(_handle, { attachments, workload: input }) {
        await attachments.json({ name: 'fixture-disposal', mediaType: 'application/json' }, input.parameters);
    },
    serializeHandle(handle) { return handle; },
    deserializeHandle(handle: { readonly cwd: string; readonly packages: number; }) { return handle; }
});

const variants: Readonly<Record<string, RuntimeDefinition>> = {
    left: defineRuntime({ name: 'left', dimensions: { flavor: 'left' }, resources: {}, requirements: [] }),
    right: defineRuntime({ name: 'right', dimensions: { flavor: 'right' }, resources: {}, requirements: [] })
};
const runtime = defineRuntimeMatrix({ name: 'node', variants });

function workloadBody(input: Workload<string, PackageParameters>): WorkloadTestCaseVariant {
    return {
        id: input.id,
        parameters: input.parameters,
        body: withRuntime<typeof runtime, TestScope>(
            runtime,
            withResource<typeof fixture, RuntimeTestScope<typeof runtime>>(fixture, async (scope) => {
                scope.assert.equal(scope.resources['publish-fixture'].packages, input.parameters.packages);
                scope.assert.equal(await readFile(join(scope.resources['publish-fixture'].cwd, 'packages.json'), 'utf8'), JSON.stringify(input.parameters));
                await scope.attachments.json({ name: 'duration', mediaType: 'application/json' }, input.parameters.packages);
                return scope.assert.collect();
            })
        )
    };
}

export const testNode = createWorkloadTestCase({
    annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ], title: 'publish',
    workloads: [ workloadBody(workload('small', { packages: 5 })), workloadBody(workload('large', { packages: 50 })) ]
});
