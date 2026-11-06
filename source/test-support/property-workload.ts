import { z } from 'zod/v4';
import { Random } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { gen } from '../property/generators.ts';
import { generateInput, type GeneratedInput } from '../property/generator-input.ts';
import type { Generator as PropertyGenerator } from '../property/generator.ts';
import type { GeneratorContext } from '../property/generator-backend.ts';

export const propertyWorkloads = [ 'dependent', 'recursive', 'repeated', 'impossible' ] as const;
export type PropertyWorkload = typeof propertyWorkloads[number];
type Tree = readonly Tree[] | null;
const maximumWork = 10_000;
const checkpointInterval = 128;
const maximumTrials = 64;
const maximumShrinkWork = 1000;
const seed = 42;
const branchWidth = 2;

function workloadGenerator(workload: PropertyWorkload, size: number, depth: number): PropertyGenerator<unknown> {
    const generators = {
        dependent() {
            return gen
                .array(gen.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: size })
                .flatMap(function indexed(values) {
                    return gen.integer({ min: 0, max: values.length - 1 }).map<unknown>(function index(value) {
                        return { values, index: value };
                    });
                });
        },
        recursive() {
            return gen
                .recursive<Tree>({
                    leaf: gen.constant(null),
                    maxDepth: depth,
                    branch(child) {
                        return gen.array(child, { minLength: 0, maxLength: 2 }).map<Tree>(function tree(value) {
                            return value;
                        });
                    }
                })
                .map<unknown>(function (value) {
                    return value;
                });
        },
        repeated() {
            return gen.integer({ min: 0, max: 1000 }).map<unknown>(function () {
                return { value: 'same' };
            });
        },
        impossible() {
            return gen
                .constant(0)
                .map<unknown>(function input(value) {
                    return value;
                })
                .filter(function () {
                    return false;
                });
        }
    };
    return generators[workload]();
}

function treeDepth(value: unknown): number {
    if (value === null) {
        return 0;
    }
    if (!Array.isArray(value) || value.length > branchWidth) {
        throw new Error('Invalid recursive input.');
    }
    return 1 + Math.max(0, ...value.map(treeDepth));
}

function validateIndex(value: unknown, size: number): void {
    const input = z
        .object({ values: z.array(z.number()).min(1).max(size), index: z.number().int().nonnegative() })
        .parse(value);
    if (input.index >= input.values.length) {
        throw new Error('Invalid dependent index.');
    }
    if (typeof value !== 'object' || value === null) {
        throw new Error('Missing input.');
    }
    Reflect.set(value, 'values', []);
}
function validateRepeated(value: unknown): void {
    z.object({ value: z.literal('same') }).parse(value);
    if (typeof value !== 'object' || value === null) {
        throw new Error('Missing input.');
    }
    Reflect.set(value, 'value', 'mutated');
}
function validateInput(workload: PropertyWorkload, value: unknown, size: number, depth: number): void {
    const validators = {
        recursive() {
            if (treeDepth(value) > depth) {
                throw new Error('Recursive depth exceeded.');
            }
        },
        dependent() {
            validateIndex(value, size);
        },
        repeated() {
            validateRepeated(value);
        },
        impossible() {
            throw new Error('Impossible filter reached its body.');
        }
    };
    validators[workload]();
}

type HeapReading = {
    readonly checkpoints: number;
    readonly baselineHeapBytes: number;
    readonly maximumCheckpointHeapBytes: number;
    readonly maximumCheckpointHeapDeltaBytes: number;
};
type HeapObservation = { readonly checkpoint: () => void; readonly read: () => HeapReading; };
function observeHeap(): HeapObservation {
    if (globalThis.gc === undefined) {
        throw new Error('Property measurements require --expose-gc.');
    }
    const collect = globalThis.gc;
    collect();
    const baselineHeapBytes = process.memoryUsage().heapUsed;
    let maximumCheckpointHeapBytes = baselineHeapBytes;
    let checkpoints = 0;
    return {
        checkpoint() {
            collect();
            checkpoints += 1;
            maximumCheckpointHeapBytes = Math.max(maximumCheckpointHeapBytes, process.memoryUsage().heapUsed);
        },
        read() {
            return {
                checkpoints,
                baselineHeapBytes,
                maximumCheckpointHeapBytes,
                maximumCheckpointHeapDeltaBytes: maximumCheckpointHeapBytes - baselineHeapBytes
            };
        }
    };
}

type WorkCounts = { readonly workConsumed: number; readonly rejectedInputs: number; };
type WorkObservation = {
    readonly context: GeneratorContext;
    readonly exhausted: Error;
    readonly read: () => WorkCounts;
};
function observeWork(size: number, depth: number, heap: HeapObservation): WorkObservation {
    const exhausted = new Error('Work exhausted.');
    let workConsumed = 0;
    let rejectedInputs = 0;
    return {
        exhausted,
        context: {
            maxSize: size,
            maxDepth: depth,
            consumeWork() {
                if (workConsumed === maximumWork) {
                    throw exhausted;
                }
                workConsumed += 1;
                if (workConsumed % checkpointInterval === 0) {
                    heap.checkpoint();
                }
            },
            rejectInput() {
                rejectedInputs += 1;
            },
            exhaustDomain(): never {
                throw exhausted;
            }
        },
        read() {
            return { workConsumed, rejectedInputs };
        }
    };
}

type EvaluationCounts = {
    readonly candidatesProduced: number;
    readonly reconstructions: number;
    readonly bodyEvaluations: number;
};
type EvaluationObserver = {
    readonly produced: () => void;
    readonly evaluate: (input: GeneratedInput<unknown>) => void;
    readonly read: () => EvaluationCounts;
};
function observeEvaluations(validate: (value: unknown) => void): EvaluationObserver {
    let candidatesProduced = 0;
    let reconstructions = 0;
    let bodyEvaluations = 0;
    return {
        produced() {
            candidatesProduced += 1;
        },
        evaluate(input) {
            const value = input.reconstruct();
            reconstructions += 1;
            bodyEvaluations += 1;
            validate(value);
        },
        read() {
            return { candidatesProduced, reconstructions, bodyEvaluations };
        }
    };
}
function evaluateShrinks(root: GeneratedInput<unknown>, observer: EvaluationObserver, work: WorkObservation): void {
    const start = work.read().workConsumed;
    for (const candidate of root.shrink()) {
        observer.produced();
        observer.evaluate(candidate);
        if (work.read().workConsumed - start >= maximumShrinkWork) {
            return;
        }
    }
}
type WorkloadRun = { readonly workload: PropertyWorkload; readonly size: number; readonly depth: number; };
function evaluateWorkload(
    run: WorkloadRun,
    work: WorkObservation,
    heap: HeapObservation,
    observer: EvaluationObserver
): void {
    const generator = workloadGenerator(run.workload, run.size, run.depth);
    const random = new Random(xoroshiro128plus(seed));
    for (let trial = 0; trial < maximumTrials; trial += 1) {
        const root = generateInput(generator, random, undefined, work.context);
        observer.evaluate(root);
        evaluateShrinks(root, observer, work);
        heap.checkpoint();
    }
}
export type PropertyWorkloadMeasurement = HeapReading & Readonly<EvaluationCounts> & WorkCounts & {
    readonly workload: PropertyWorkload;
    readonly seed: string;
    readonly nodeVersion: string;
    readonly size: number;
    readonly depth: number;
};
export function measurePropertyWorkload(
    workload: PropertyWorkload,
    size: number,
    depth: number
): PropertyWorkloadMeasurement {
    const heap = observeHeap();
    const work = observeWork(size, depth, heap);
    const observer = observeEvaluations(function validate(value) {
        validateInput(workload, value, size, depth);
    });
    try {
        evaluateWorkload({ workload, size, depth }, work, heap, observer);
    } catch (error: unknown) {
        if (error !== work.exhausted) {
            throw error;
        }
    }
    heap.checkpoint();
    return {
        workload,
        seed: String(seed),
        nodeVersion: process.versions.node,
        size,
        depth,
        ...observer.read(),
        ...work.read(),
        ...heap.read()
    };
}
