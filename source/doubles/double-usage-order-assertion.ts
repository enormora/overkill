import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
import type { ChronologyOrder } from './double-chronology.ts';
import {
    type AssertionCheck,
    type AssertionChild,
    type AssertionResult,
    groupChildren,
    modeNoun,
    type OrderArguments,
    type UsageAssertionReference,
    type UsageMode
} from './double-usage-contract.ts';
import {
    chronologyFor,
    inspectedDouble,
    type ValidDoubleInspection
} from './double-usage-inspection.ts';

type OrderCheckInput = {
    readonly check: AssertionCheck;
    readonly doubles: readonly unknown[];
    readonly mode: UsageMode;
};

type InspectedDoubles = {
    readonly inspections: readonly ValidDoubleInspection[];
    readonly valid: true;
} | {
    readonly result: AssertionResult;
    readonly valid: false;
};

const minimumOrderedDoubles = 2;

function inspectDoubles(check: AssertionCheck, doubles: readonly unknown[]): InspectedDoubles {
    const inspections: ValidDoubleInspection[] = [];
    const failures: AssertionChild[] = [];

    for (const double of doubles) {
        const inspection = inspectedDouble(check, double);

        if (inspection.valid) {
            inspections.push(inspection);
        } else {
            failures.push(inspection.failure);
        }
    }

    return failures.length === 0
        ? {
            inspections,
            valid: true
        }
        : {
            result: groupChildren(check, failures, 'double usage'),
            valid: false
        };
}

function hasMixedScope(inspections: readonly ValidDoubleInspection[]): boolean {
    const firstScope = inspections[0]?.chronology.scope;

    return inspections.some(function hasDifferentScope(inspection) {
        return inspection.chronology.scope !== firstScope;
    });
}

function sharedScopeFailure(check: AssertionCheck): AssertionResult {
    return check.fromThrowable('double usage scope', function expectedSharedScope() {
        throw new TypeError('Expected ordered doubles to belong to the same double scope.');
    });
}

function eventGroupsFor(
    inspections: readonly ValidDoubleInspection[],
    mode: UsageMode
): readonly (readonly ChronologyOrder[])[] {
    return inspections.map(function eventsFor(inspection) {
        return chronologyFor(inspection.chronology, mode);
    });
}

function missingEventChecks(
    check: AssertionCheck,
    eventGroups: readonly (readonly ChronologyOrder[])[],
    mode: UsageMode
): readonly AssertionChild[] {
    return eventGroups.flatMap(function missingEvents(events, index) {
        return events.length === 0 ? [ check.annotated(`${modeNoun(mode)} ${index}`).notEmpty(events) ] : [];
    });
}

function orderChecks(
    check: AssertionCheck,
    eventGroups: readonly (readonly ChronologyOrder[])[],
    mode: UsageMode
): readonly AssertionChild[] {
    return eventGroups.slice(0, -1).flatMap(function pairOrder(previousEvents, index) {
        const nextEvents = eventGroups[index + 1] ?? [];
        const previousLast = previousEvents.at(-1);
        const nextFirst = nextEvents[0];

        return previousLast === undefined || nextFirst === undefined ? [] : [
            check
                .annotated(`${modeNoun(mode)} order ${index} before ${index + 1}`)
                .lessThan(previousLast.order, nextFirst.order)
        ];
    });
}

function orderAssertion(input: OrderCheckInput): AssertionResult {
    if (input.doubles.length < minimumOrderedDoubles) {
        return input.check.fromThrowable('double usage order', function expectedDoubleOrder() {
            throw new TypeError('Expected at least two doubles.');
        });
    }

    const inspected = inspectDoubles(input.check, input.doubles);

    if (!inspected.valid) {
        return inspected.result;
    }

    if (hasMixedScope(inspected.inspections)) {
        return sharedScopeFailure(input.check);
    }

    const eventGroups = eventGroupsFor(inspected.inspections, input.mode);
    const children = [
        ...missingEventChecks(input.check, eventGroups, input.mode),
        ...orderChecks(input.check, eventGroups, input.mode)
    ];

    return groupChildren(input.check, children, `${modeNoun(input.mode)} order`);
}

export function orderReference(name: string, mode: UsageMode): UsageAssertionReference<OrderArguments> {
    return defineCompositeAssertion<OrderArguments, AssertionResult>({
        assert(check, doubles) {
            return orderAssertion({ check, doubles, mode });
        },
        formatSummary() {
            return `Expected double ${modeNoun(mode)} order to match.`;
        },
        name
    });
}
