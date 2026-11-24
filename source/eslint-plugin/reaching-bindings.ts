import type { TSESLint, TSESTree as Tree } from '@typescript-eslint/utils';
import { copyState, joinStates, sameState, type State } from './binding-state.ts';

type Segment = TSESLint.CodePathSegment;
type ExpressionEvent = { readonly kind: 'expression'; readonly node: Readonly<Tree.Node>; };
type IterationEvent = {
    readonly kind: 'iteration';
    readonly node: Readonly<Tree.ForInStatement | Tree.ForOfStatement>;
};
export type BindingEvent = ExpressionEvent | IterationEvent;

export type Frame = {
    readonly path: Readonly<TSESLint.CodePath>;
    readonly node: Readonly<Tree.Node>;
    readonly children: readonly Frame[];
    readonly addChild: (child: Frame) => void;
    readonly enter: (segment: Segment) => void;
    readonly leave: (segment: Segment) => void;
    readonly events: ReadonlyMap<Segment, readonly BindingEvent[]>;
    readonly record: (event: BindingEvent) => void;
};

export function createFrame(path: Readonly<TSESLint.CodePath>, node: Readonly<Tree.Node>): Frame {
    const children: Frame[] = [];
    const segments = new Set<Segment>();
    const events = new Map<Segment, BindingEvent[]>();
    return {
        path,
        node,
        children,
        events,
        addChild(child) {
            children.push(child);
        },
        enter(segment) {
            segments.add(segment);
        },
        leave(segment) {
            segments.delete(segment);
        },
        record(event) {
            for (const segment of segments) {
                const recorded = events.get(segment) ?? [];
                recorded.push(event);
                events.set(segment, recorded);
            }
        }
    };
}

type ApplyEvent = (state: State, event: Readonly<BindingEvent>) => void;
type ObserveExpression = (state: State, node: Readonly<Tree.Node>, stage: 'before' | 'after') => void;

function segmentInput(
    segment: Readonly<Segment>,
    outputs: ReadonlyMap<Segment, State>,
    entry: State | undefined
): State | undefined {
    let input = entry;
    for (const predecessor of segment.prevSegments) {
        const output = outputs.get(predecessor);
        if (output !== undefined) {
            input = input === undefined ? output : joinStates(input, output);
        }
    }
    return input;
}

function replay(
    input: State,
    events: readonly BindingEvent[],
    apply: ApplyEvent,
    observe: ObserveExpression
): State {
    const state = copyState(input);
    for (const event of events) {
        if (event.kind === 'expression') {
            observe(state, event.node, 'before');
        }
        apply(state, event);
        if (event.kind === 'expression') {
            observe(state, event.node, 'after');
        }
    }
    return state;
}

function ignoreExpression(): void {
    return undefined;
}

function widenOutput(previous: State | undefined, candidate: State): State {
    return previous === undefined ? candidate : joinStates(previous, candidate);
}

function reachingInputs(frame: Frame, entry: State, apply: ApplyEvent): ReadonlyMap<Segment, State> {
    const inputs = new Map<Segment, State>();
    const outputs = new Map<Segment, State>();
    const pending = new Set([ frame.path.initialSegment ]);

    function propagate(segment: Segment): void {
        const initial = segment === frame.path.initialSegment ? entry : undefined;
        const input = segmentInput(segment, outputs, initial);
        if (input !== undefined) {
            inputs.set(segment, input);
            const candidate = replay(input, frame.events.get(segment) ?? [], apply, ignoreExpression);
            const previous = outputs.get(segment);
            const output = widenOutput(previous, candidate);
            if (previous === undefined || !sameState(previous, output)) {
                outputs.set(segment, output);
                segment.nextSegments.forEach(function (successor) {
                    pending.add(successor);
                });
            }
        }
    }

    while (pending.size > 0) {
        const segment = pending.values().next().value;
        if (segment !== undefined) {
            pending.delete(segment);
            propagate(segment);
        }
    }
    return inputs;
}

export function reachingBindings(
    frame: Frame,
    entry: State,
    apply: ApplyEvent,
    observe: ObserveExpression
): void {
    const inputs = reachingInputs(frame, entry, apply);
    for (const [ segment, input ] of inputs) {
        replay(input, frame.events.get(segment) ?? [], apply, observe);
    }
}
