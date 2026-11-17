import ts from 'typescript';
import { Diagnostic, DiagnosticOrigin } from 'tstyche/api';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { checkerDiagnostic, checkerDiagnosticText, type DiagnosticContext } from './checker-diagnostics.ts';

type DiagnosticCoordinates = { readonly line: number; readonly column: number; };
function expectedCoordinates(mapped: boolean, originalAvailable: boolean): DiagnosticCoordinates {
    return { line: mapped && originalAvailable ? 2 : 1, column: mapped && !originalAvailable ? 6 : 1 };
}
const originalPath = '/project/original.ts';
const generatedPath = '/project/diagnostic.ts';
const originalText = 'one\r\ntwo';
const generatedText = 'const value = 1;';
function context(mapped: boolean, originalAvailable: boolean): DiagnosticContext {
    const range = { start: 0, end: generatedText.length };
    const mappings = [ { kind: 'anchored' as const, original: { start: 5, end: 8 }, generated: range } ];
    return {
        check: {
            inputs: {
                modules: [ {
                    kind: 'ready',
                    path: generatedPath,
                    provenance: {
                        originalPath,
                        generatedPath,
                        originalFingerprint: 'original',
                        generatedFingerprint: 'generated',
                        mappings,
                        repairs: [],
                        limitations: []
                    }
                } ],
                mapRange() {
                    return mapped ? [ { start: 5, end: 6 }, { start: 7, end: 8 } ] : [];
                }
            }
        },
        translation: {
            sites: [],
            modules: originalAvailable
                ? [ {
                    path: originalPath,
                    originalText,
                    text: generatedText,
                    mappings
                } ]
                : []
        }
    };
}
function diagnostic(): Diagnostic {
    const file = ts.createSourceFile(generatedPath, generatedText, ts.ScriptTarget.Latest, true);
    const statement = file.statements[0];
    if (statement === undefined) {
        throw new Error('Expected diagnostic source statement.');
    }
    return Diagnostic.error('Type mismatch', DiagnosticOrigin.fromNode(statement)).add({ code: 'TS2322' });
}
export const testNode = suite('checker diagnostic source positions', [
    ...[ false, true ].flatMap(function mapping(mapped) {
        return [ false, true ].map(function originalSource(originalAvailable) {
            return test(
                `maps diagnostics with ranges ${mapped} and original source ${originalAvailable}`,
                function (scope: TestScope) {
                    const result = checkerDiagnostic(context(mapped, originalAvailable), diagnostic());
                    const start = mapped ? 5 : 0;
                    const { line, column } = expectedCoordinates(mapped, originalAvailable);
                    scope.assert.deepEqual(result, {
                        code: 'TS2322',
                        text: 'Type mismatch',
                        related: [],
                        location: {
                            file: originalPath,
                            start,
                            end: mapped ? 8 : generatedText.length,
                            line,
                            column
                        }
                    });
                    scope.assert.equal(
                        checkerDiagnosticText(result),
                        `${originalPath}:${line}:${column}: Type mismatch`
                    );
                    return scope.assert.collect();
                }
            );
        });
    }),
    test('retains generated locations when no module provenance is available', function (scope: TestScope) {
        const source = context(false, false);
        const result = checkerDiagnostic(
            { ...source, check: { inputs: { ...source.check.inputs, modules: [] } } },
            diagnostic()
        );
        scope.assert.deepEqual({ location: result.location }, {
            location: {
                file: generatedPath,
                start: 0,
                end: generatedText.length,
                line: 1,
                column: 1
            }
        });
        return scope.assert.collect();
    }),
    test('preserves related diagnostic locations and multiline text', function (scope: TestScope) {
        const detail = diagnostic();
        const parent = Diagnostic.error([ 'Invalid', 'assertion' ]).add({ related: [ detail ] });
        const result = checkerDiagnostic(context(true, true), parent);
        scope.assert.equal(checkerDiagnosticText(result), `Invalid\nassertion\n${originalPath}:2:1: Type mismatch`);
        scope.assert.equal(result.related.length, 1);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
