import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';

export type OutputIntentRole = 'primary' | 'supplemental';
export type OutputIntentSeverity = 'error' | 'notice' | 'warning';

export type OutputIntentAnnotation = {
    readonly location: SourceLocation | null;
    readonly severity: OutputIntentSeverity;
    readonly title: string | null;
};

export type OutputLineIntent = {
    readonly annotation: OutputIntentAnnotation | null;
    readonly kind: 'stderr-line' | 'stdout-line';
    readonly role: OutputIntentRole;
    readonly text: string;
};

export type ReporterOutput = readonly OutputLineIntent[];
export type OptionalReporterOutput = ReporterOutput | undefined;

export type OutputRenderer = {
    readonly render: (intent: OutputLineIntent) => string;
};

export type OutputLineWriter = {
    readonly writeLine: (line: string) => void;
};

export function createPlainOutputRenderer(): OutputRenderer {
    return {
        render(intent) {
            return intent.text;
        }
    };
}
