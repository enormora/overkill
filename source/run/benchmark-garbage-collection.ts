import { resolveBenchmarkGarbageCollection } from '../engine/benchmark-garbage-collection.ts';
import type { BenchmarkGarbageCollectionPolicy } from '../engine/benchmark-result.ts';
import type { HostProcess } from '../config/types.ts';
import type { CollectedRunCase } from './run-types.ts';
import { invalidRequest } from './run-errors.ts';

type BenchmarkCases = readonly { readonly testCase: CollectedRunCase; }[];

function requiresGarbageCollection(cases: BenchmarkCases, profile: BenchmarkGarbageCollectionPolicy): boolean {
    return cases.some(function requestsCollection({ testCase }) {
        const request = testCase.benchmark?.lifecycle?.garbageCollection ?? 'off';
        return testCase.skipReason === null && resolveBenchmarkGarbageCollection(request, profile) === 'after-sample';
    });
}

function garbageCollectionArguments(nodeArguments: readonly string[]): readonly string[] {
    if (
        nodeArguments.some(function disablesGarbageCollection(argument) {
            return /^--no[-_]?expose[-_]gc$/u.test(argument);
        })
    ) {
        invalidRequest('Requested benchmark garbage collection conflicts with a GC-disable host argument.');
    }
    const exposed = nodeArguments.some(function exposesGarbageCollection(argument) {
        return argument.replaceAll('_', '-') === '--expose-gc';
    });
    return exposed ? nodeArguments : [ ...nodeArguments, '--expose-gc' ];
}

export function resolveBenchmarkGarbageCollectionHost(
    hostProcess: HostProcess,
    profile: BenchmarkGarbageCollectionPolicy,
    cases: BenchmarkCases
): HostProcess {
    if (!requiresGarbageCollection(cases, profile)) {
        return hostProcess;
    }
    return {
        kind: 'child',
        nodeArguments: garbageCollectionArguments(hostProcess.kind === 'child' ? hostProcess.nodeArguments : [])
    };
}
