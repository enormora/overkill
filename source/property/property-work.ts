import type {
    PropertyPolicy,
    PropertyInvocationSummary,
    PropertyTrialPosition
} from '../packages/engine/engine.entry-point.ts';
import type { GeneratorContext } from './generator-backend.ts';

const initialPhaseCounts = {
    'checked-in-corpus': { executed: 0, rejected: 0 },
    'local-cache': { executed: 0, rejected: 0 },
    examples: { executed: 0, rejected: 0 },
    'automatic-edges': { executed: 0, rejected: 0 },
    exhaustive: { executed: 0, rejected: 0 },
    exploration: { executed: 0, rejected: 0 },
    confirmation: { executed: 0, rejected: 0 },
    shrinking: { executed: 0, rejected: 0 },
    witness: { executed: 0, rejected: 0 }
};
export type PropertyPhase = keyof typeof initialPhaseCounts;
export type PropertyAccounting = PropertyInvocationSummary['accounting'];

export type PropertyWork = {
    readonly context: GeneratorContext;
    readonly enterPhase: (phase: PropertyPhase) => void;
    readonly execute: () => void;
    readonly phase: () => PropertyPhase;
    readonly snapshot: () => PropertyAccounting;
};

const workExhausted = new Error('Property work exhausted.');
const domainExhausted = new Error('Property domain exhausted.');

export function propertyExhaustion(error: unknown): 'generation-exhausted' | 'work-exhausted' | null {
    if (error === workExhausted) {
        return 'work-exhausted';
    }
    return error === domainExhausted ? 'generation-exhausted' : null;
}

export function createPropertyWork(
    policy: Pick<PropertyPolicy, 'maxDepth' | 'maxShrinkWork' | 'maxSize' | 'maxWork'>,
    signal: AbortSignal
): PropertyWork {
    let phase: PropertyPhase = 'checked-in-corpus';
    let workConsumed = 0;
    let shrinkWork = 0;
    const phases = { ...initialPhaseCounts };
    return {
        phase() {
            return phase;
        },
        context: {
            maxSize: policy.maxSize,
            maxDepth: policy.maxDepth,
            consumeWork() {
                signal.throwIfAborted();
                if (workConsumed === policy.maxWork) {
                    throw workExhausted;
                }
                if (phase === 'shrinking' || phase === 'confirmation') {
                    if (shrinkWork === policy.maxShrinkWork) {
                        throw workExhausted;
                    }
                    shrinkWork += 1;
                }
                workConsumed += 1;
            },
            rejectInput() {
                phases[phase] = { ...phases[phase], rejected: phases[phase].rejected + 1 };
            },
            exhaustDomain() {
                throw domainExhausted;
            }
        },
        enterPhase(value) {
            phase = value;
        },
        execute() {
            phases[phase] = { ...phases[phase], executed: phases[phase].executed + 1 };
        },
        snapshot() {
            return Object.freeze({
                phases: Object.freeze({
                    'checked-in-corpus': Object.freeze({ ...phases['checked-in-corpus'] }),
                    'local-cache': Object.freeze({ ...phases['local-cache'] }),
                    examples: Object.freeze({ ...phases.examples }),
                    'automatic-edges': Object.freeze({ ...phases['automatic-edges'] }),
                    exhaustive: Object.freeze({ ...phases.exhaustive }),
                    confirmation: Object.freeze({ ...phases.confirmation }),
                    shrinking: Object.freeze({ ...phases.shrinking }),
                    witness: Object.freeze({ ...phases.witness }),
                    exploration: Object.freeze({ ...phases.exploration })
                }),
                workConsumed
            });
        }
    };
}

export function propertyTrialPosition(work: PropertyWork): PropertyTrialPosition | null {
    const phase = work.phase();
    const index = work.snapshot().phases[phase].executed;
    return index === 0 ? null : { phase, index };
}
