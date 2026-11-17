import { createTestPlanFromTestFiles } from '../packages/engine/engine.entry-point.ts';
import type { ConfigTests, ConfigDefinition, ConfigInventory } from '../eslint-test/config-definition.ts';
import type { Suite } from '../engine/test-node.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createConfigTests, type ConfigTestOperations } from '../eslint-test/config-tests.ts';
import { configDefinition } from './eslint-config.ts';
import { createTestEngine } from './create-test-engine.ts';

export const configInventory: ConfigInventory<string> = {
    title: 'inventory',
    configs: 'all',
    target: { kind: 'declared' },
    catalog: {
        kind: 'rules',
        rules: [ { ruleId: 'plugin/active', deprecated: false }, { ruleId: 'plugin/old', deprecated: true } ]
    },
    completeness: 'all',
    deprecated: 'absent',
    exclusions: []
};
function configTestDefinition(): ConfigDefinition<string> {
    return {
        ...configDefinition([]),
        configs: { first: [], second: [] },
        inventories: [ configInventory ],
        files: [ { title: 'file', configs: [ 'second' ], filename: 'input.js', expect: { kind: 'ignored' } } ],
        fixtures: [ {
            title: 'fixture',
            configs: [ 'first' ],
            source: { kind: 'inline', filename: 'input.js', code: 'value' },
            expect: { kind: 'lint', diagnostics: { kind: 'clean' } }
        } ]
    };
}
type ConfigTestOperationsFixture = { readonly calls: readonly string[]; readonly tests: ConfigTests; };
export function configTestOperations(
    failure: Error | null,
    custom: boolean
): ConfigTestOperationsFixture {
    const calls: string[] = [];
    const operations: ConfigTestOperations = {
        async inventory(_definition, _source, entry) {
            calls.push(`inventory:${entry.title}`);
            if (failure !== null) {
                throw failure;
            }
        },
        async file(_definition, _source, entry) {
            calls.push(`file:${entry.filename}`);
            if (failure !== null) {
                throw failure;
            }
        },
        async fixture(_definition, _source, entry, scope) {
            calls.push(`fixture:${entry.source.filename}`);
            if (failure !== null) {
                throw failure;
            }
            if (custom) {
                scope.assert.equal(entry.source.filename, 'input.js');
                return scope.assert.collect();
            }
            return null;
        }
    };
    return { calls, tests: createConfigTests(configTestDefinition(), operations) };
}

export async function runAssembledConfig(node: Suite): Promise<RunResult> {
    const engine = createTestEngine();
    return await engine.execute(
        createTestPlanFromTestFiles({
            root: { title: 'config', annotations: {}, controls: {} },
            files: [ { file: 'config.test.ts', testNode: node } ]
        })
    );
}
