import type { KnownSourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import {
    defineOutputRenderer,
    type DefinedOutputRenderer,
    type OutputLineIntent
} from '../engine/reporter-output.ts';
import type { ReportingContext } from '../engine/reporting-context.ts';

type RenderableLocation = KnownSourceLocation & {
    readonly line: number;
};

function escapeCommandValue(value: string): string {
    return value
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
}

function escapeCommandProperty(value: string): string {
    return escapeCommandValue(value)
        .replaceAll(':', '%3A')
        .replaceAll(',', '%2C');
}

function renderProperty(name: string, value: string | null): string | null {
    return value === null ? null : `${name}=${escapeCommandProperty(value)}`;
}

function renderableLocation(annotation: OutputLineIntent['annotation']): RenderableLocation | null {
    const location = annotation?.location ?? null;

    if (location === null || location.kind === 'unknown' || location.line === null) {
        return null;
    }

    return {
        ...location,
        line: location.line
    };
}

function renderGitHubAnnotation(intent: OutputLineIntent, context: ReportingContext): string | null {
    const { annotation } = intent;
    const location = renderableLocation(annotation);

    if (annotation === null || location === null) {
        return null;
    }

    const column = location.column === null ? null : String(location.column);
    const properties = [
        `file=${escapeCommandProperty(context.relativizeLocationPath(location))}`,
        `line=${location.line}`,
        renderProperty('col', column),
        renderProperty('title', annotation.title)
    ]
        .filter(function isProperty(property): property is string {
            return property !== null;
        })
        .join(',');

    return `::${annotation.severity} ${properties}::${escapeCommandValue(intent.text)}`;
}

export function createGithubActionsOutputRenderer(): DefinedOutputRenderer {
    return defineOutputRenderer(function createGithubActionsRuntimeOutputRenderer(context) {
        return {
            render(intent) {
                return renderGitHubAnnotation(intent, context) ?? intent.text;
            }
        };
    });
}
