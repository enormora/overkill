import type { TestNode } from '../engine/test-node.ts';
import type { RunTestPlanInput } from '../run/run-test-plan.ts';
import type { DirectEntrypointRunCollectionSource, DiscoveredRunFile } from '../run/run-types.ts';
import { createTestEngine } from './create-test-engine.ts';
import { deterministicDiscoveredFile } from './deterministic-run-fixtures.ts';

type PlanCollectionFixture = {
    readonly input: RunTestPlanInput;
    readonly file: DiscoveredRunFile;
    readonly source: DirectEntrypointRunCollectionSource;
};
export function runPlanCollection(invalid: boolean): PlanCollectionFixture {
    const engine = createTestEngine();
    const child = engine.createTestCase({
        title: 'case',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        body() {
            throw new Error('Collection must not execute bodies.');
        }
    });
    const testNode: TestNode = invalid
        ? engine.createSuite({
            title: 'duplicates',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            children: [ child, child ]
        })
        : child;
    const file = deterministicDiscoveredFile('/project', 'case.ts');
    const root = { title: 'root', annotations: {}, controls: {} };
    return {
        file,
        source: { kind: 'direct-entrypoint', configuration: { kind: 'memory' }, root, testNode },
        input: {
            engine,
            replay: null,
            cwd: '/project',
            definitionLocationCapture: 'disabled',
            async discoverRunFiles() {
                return [ file ];
            },
            async loadRunTestModules() {
                return [ { file: file.file, testNode } ];
            },
            paths: [ file.file ],
            root,
            testFamily: 'microtest'
        }
    };
}
