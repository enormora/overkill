import type { PropertyPolicy } from '../packages/engine/engine.entry-point.ts';
import type { GeneratorContext } from './generator-backend.ts';

export type PropertyPhase = 'automatic-edges' | 'checked-in-corpus' | 'examples' | 'exploration' | 'local-cache';
type PhaseCounts = { readonly executed: number; readonly rejected: number; };
export type PropertyAccounting = {
    readonly phases: Readonly<Record<PropertyPhase, PhaseCounts>>;
    readonly workConsumed: number;
};

export type PropertyWork = {
    readonly context: GeneratorContext;
    readonly enterPhase: (phase: PropertyPhase) => void;
    readonly execute: () => void;
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

export function createPropertyWork(policy: PropertyPolicy): PropertyWork {
    let phase: PropertyPhase = 'checked-in-corpus';
    let workConsumed = 0;
    const phases: Record<PropertyPhase, { readonly executed: number; readonly rejected: number; }> = {
        'checked-in-corpus': { executed: 0, rejected: 0 },
        'local-cache': { executed: 0, rejected: 0 },
        examples: { executed: 0, rejected: 0 },
        'automatic-edges': { executed: 0, rejected: 0 },
        exploration: { executed: 0, rejected: 0 }
    };
    return {
        context: {
            maxSize: policy.maxSize,
            maxDepth: policy.maxDepth,
            consumeWork() {
                if (workConsumed === policy.maxWork) {
                    throw workExhausted;
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
                    exploration: Object.freeze({ ...phases.exploration })
                }),
                workConsumed
            });
        }
    };
}
