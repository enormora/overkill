import { runSupervisedChild } from '../run/supervised-child.ts';
import {
    createChildRun,
    supervisedChildCommand,
    supervisedChildDependencies,
    type ChildRunFixture
} from './supervised-child-fixture.ts';
import {
    loadDeterministicRunTestModules,
    createDeterministicProcessUsageTracker
} from './deterministic-run-fixtures.ts';
import { createVirtualRunDiscovery } from './virtual-run-discovery.ts';

const file = 'source/integration-tests/runtime/fixtures/passing.test.ts';
type MemoryChild = ChildRunFixture & { readonly execute: () => Promise<void>; };
export function memorySupervisedChild(mode: 'collect' | 'run', selected: boolean, restricted: boolean): MemoryChild {
    const environment = {};
    const command = supervisedChildCommand(mode, file);
    const discovery = createVirtualRunDiscovery({ cwd: '/project', directories: [], files: [ file ], realpaths: {} });
    const fixture = createChildRun({
        command: { ...command, capabilityRestrictions: { mode: restricted ? 'enabled' : 'disabled' } },
        assignment: {
            kind: 'assign',
            implementations: null,
            attachmentEndpoint: null,
            assignedCases: selected ? [ { file, params: null, suite: [ 'fixture' ], title: 'passes' } ] : []
        },
        discoverRunFiles: discovery.discoverRunFiles,
        loadRunTestModules: loadDeterministicRunTestModules,
        readEnvironment() {
            return environment;
        }
    });
    return {
        ...fixture,
        async execute() {
            await runSupervisedChild(fixture.host, {
                ...supervisedChildDependencies(),
                createProcessUsageTracker: createDeterministicProcessUsageTracker
            });
        }
    };
}
