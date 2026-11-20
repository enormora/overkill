import type { Linter } from 'eslint';
import { type TestNode, createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';

import type { ConfigDefinition, VirtualConfigProject } from '../packages/eslint-test/eslint-test.entry-point.ts';

export const emptyConfigProject: VirtualConfigProject = { kind: 'virtual', files: {}, dependencies: { kind: 'none' } };
export function configDefinition(configs: readonly Linter.Config[]): ConfigDefinition<'basic'> {
    return {
        name: 'config contracts',
        configs: { basic: configs },
        project: emptyConfigProject,
        inventories: [],
        files: [],
        fixtures: [],
        generation: []
    };
}
export async function executeConfigNode(node: TestNode): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(
        createTestPlan(createRoot({ title: 'config contracts', children: [ node ], annotations: {}, controls: {} }))
    );
}
