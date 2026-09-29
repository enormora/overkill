import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import {
    createOpenTelemetryReporter as createReporter,
    type OpenTelemetryReporterOptions
} from '../../reporters/opentelemetry-reporter.ts';

export type { OpenTelemetryReporterOptions } from '../../reporters/opentelemetry-reporter.ts';

const spanIdByteLength = 8;
const traceIdByteLength = 16;
const hexCharactersPerByte = 2;

async function writeOpenTelemetryFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
}

function randomHexId(byteLength: number): string {
    const invalidId = '0'.repeat(byteLength * hexCharactersPerByte);
    let id = invalidId;

    while (id === invalidId) {
        id = randomBytes(byteLength).toString('hex');
    }

    return id;
}

export function createOpenTelemetryReporter(
    options: OpenTelemetryReporterOptions
): DefinedReporter<FinalResultReporter> {
    return createReporter(
        {
            createSpanId() {
                return randomHexId(spanIdByteLength);
            },
            createTraceId() {
                return randomHexId(traceIdByteLength);
            },
            writeFile: writeOpenTelemetryFile
        },
        options
    );
}
