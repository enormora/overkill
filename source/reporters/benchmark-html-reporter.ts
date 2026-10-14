import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import {
    defineReporter,
    type DefinedReporter,
    type FinalResultReporter,
    type FileSinkDeclaration,
    type RunFacts
} from '../engine/reporter.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';

export type BenchmarkHtmlReporterOptions = { readonly outputFile: string; };
export type BenchmarkHtmlReporterSinks = readonly [FileSinkDeclaration];
type BenchmarkHtmlReporterDependencies = { readonly files: FileStore; readonly readClient: () => Promise<string>; };
function validateBenchmarkFacts(facts: RunFacts): void {
    const { execution } = facts;
    if (execution === null || typeof execution !== 'object' || Reflect.get(execution, 'testFamily') !== 'benchmark') {
        throw new Error('Benchmark HTML reporter requires a benchmark profile.');
    }
}
function defineBenchmarkHtmlReporter(
    options: BenchmarkHtmlReporterOptions,
    dependencies: BenchmarkHtmlReporterDependencies
): DefinedReporter<FinalResultReporter<BenchmarkHtmlReporterSinks>> {
    const path = resolve(options.outputFile);
    if (options.outputFile.trim().length === 0) {
        throw new TypeError('Benchmark HTML report outputFile must not be blank.');
    }
    return defineReporter({
        validateRunFacts: validateBenchmarkFacts,
        createReporter() {
            return {
                kind: 'final-result',
                name: 'benchmark-html',
                dispose: null,
                sinks: [ { kind: 'file', path } ] as const,
                async onResult(result) {
                    const report = createBenchmarkHtmlReport(result);
                    const source = await dependencies.readClient();
                    await dependencies.files.write(path, renderBenchmarkHtml(report, source));
                }
            };
        }
    });
}
export function createBenchmarkHtmlReporter(
    options: BenchmarkHtmlReporterOptions
): DefinedReporter<FinalResultReporter<BenchmarkHtmlReporterSinks>> {
    const clientUrl = new URL(
        import.meta.url.endsWith('.ts')
            ? '../../target/benchmark-html/client.txt'
            : './benchmark-html-assets/client.txt',
        import.meta.url
    );
    return defineBenchmarkHtmlReporter(options, {
        files: createNodeFileStore(),
        async readClient() {
            return await readFile(clientUrl, 'utf8');
        }
    });
}
