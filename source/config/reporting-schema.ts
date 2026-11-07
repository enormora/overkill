import { z } from 'zod/v4';
import { isReporter, type DefinedReporter } from '../engine/reporter.ts';
import { isOutputRenderer, type DefinedOutputRenderer } from '../engine/reporter-output.ts';

export type ReportingPolicy = {
    readonly reporters: readonly DefinedReporter[] | null;
    readonly outputRenderer: DefinedOutputRenderer;
};

export const reporterSchema = z.custom<DefinedReporter>(isReporter, 'must be created with defineReporter(...)');
export const outputRendererSchema = z.custom<DefinedOutputRenderer>(
    isOutputRenderer,
    'must be created with defineOutputRenderer(...)'
);
