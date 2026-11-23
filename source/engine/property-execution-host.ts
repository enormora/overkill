import type { AssertAssertionNode, AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { PropertyWitnessFile } from './witness-file.ts';
import {
    emptyPropertyCorpus,
    propertyReplayWitness as corpusReplayWitness,
    type PropertyCorpusSnapshot
} from './property-corpus.ts';
import type { PropertyTrialPosition, PropertyInvocationEvidence } from './property-failure-evidence.ts';
import type { ExecutedBody } from './body-result.ts';
import type { WorkId } from './identity.ts';
import type { PropertyPolicy } from './property-node.ts';
import type { TestBody, TestScope } from './test-scope.ts';

const propertyHost = Symbol.for('@overkill-dev/engine/PropertyExecutionHost/v1');

export type PropertyTrialResult = {
    readonly kind: 'assertion-failed';
    readonly hasAdditionalFailures: boolean;
    readonly assertion: AssertAssertionNode;
    readonly result: ExecutedBody;
} | {
    readonly kind: 'body-error';
    readonly result: ExecutedBody;
} | {
    readonly kind: 'passed';
} | {
    readonly kind: 'terminated';
    readonly result: ExecutedBody;
};

function hasPropertyReplay(context: PropertyRunContext): context is PropertyRunSeed & {
    readonly corpus: PropertyCorpusSnapshot;
    readonly replay: PropertyWitnessFile;
} {
    return Object.hasOwn(context, 'replay');
}

type PropertyRunSeed = { readonly seed: bigint; readonly projectRoot: string | null; };
type StoredPropertyRun = PropertyRunSeed & { readonly corpus: PropertyCorpusSnapshot; };
type ReplayPropertyRun = StoredPropertyRun & { readonly replay: PropertyWitnessFile; };
export type PropertyRunContext = PropertyRunSeed | ReplayPropertyRun | StoredPropertyRun;
function hasPropertyCorpus(
    context: PropertyRunContext
): context is PropertyRunSeed & { readonly corpus: PropertyCorpusSnapshot; } {
    return Object.hasOwn(context, 'corpus');
}
export function propertyCorpusSnapshot(context: PropertyRunContext): PropertyCorpusSnapshot {
    return hasPropertyCorpus(context) ? context.corpus : emptyPropertyCorpus;
}

export function propertyReplayWitness(context: PropertyRunContext): PropertyWitnessFile | null {
    return hasPropertyReplay(context) ? context.replay : corpusReplayWitness(propertyCorpusSnapshot(context));
}

export type PropertyTrialCoordinate = {
    readonly invocation: string;
    readonly position: PropertyTrialPosition;
};

type PropertyTrialArguments =
    | readonly [
        body: TestBody,
        signal: AbortSignal,
        coordinate: PropertyTrialCoordinate
    ]
    | readonly [body: TestBody, signal: AbortSignal];

type EvaluatePropertyTrial = (...input: PropertyTrialArguments) => Promise<PropertyTrialResult>;

export type PropertyExecutionHost = PropertyRunContext & {
    readonly scope: TestScope;
    readonly policy: PropertyPolicy;
    readonly workId: WorkId;
    readonly recordEvidence: (evidence: PropertyInvocationEvidence) => Promise<void>;
    readonly evaluateTrial: EvaluatePropertyTrial;
    readonly recordBoundary: (
        evaluate: () => Promise<AssertAssertionNode>,
        signal: AbortSignal
    ) => Promise<AssertionResult>;
};

type PropertyScope = TestScope & { readonly [propertyHost]: PropertyExecutionHost; };

export function propertyScope(scope: TestScope, host: PropertyExecutionHost): TestScope {
    const injected: PropertyScope = { ...scope, [propertyHost]: host };
    return injected;
}

function hasPropertyHost(scope: Pick<TestScope, 'cleanup' | 'signal'>): scope is PropertyScope {
    return Object.hasOwn(scope, propertyHost);
}

export function readPropertyExecutionHost(scope: Pick<TestScope, 'cleanup' | 'signal'>): PropertyExecutionHost {
    if (!hasPropertyHost(scope)) {
        throw new TypeError('Property execution requires an engine property scope and resolved collection policy.');
    }
    return scope[propertyHost];
}
