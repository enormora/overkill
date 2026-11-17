import * as ast from 'typescript-beta/ast';
import type { TestPlan, TestBodyOrigin } from '../packages/engine/engine.entry-point.ts';
import { observationPlan } from './observation-lifetime.ts';
import {
    sourceFixture,
    type SourceFixture,
    sourceSymbol,
    sourceFile,
    sourceFixtureText,
    sourceBody,
    sourceCall
} from './native-source-fixture.ts';

type OwnershipFixture = SourceFixture & {
    readonly body: ast.ArrowFunction;
    readonly call: ast.CallExpression;
    readonly plan: TestPlan;
};
export function callbackSourceRange<Node extends ast.Node>(node: Node, start: number): Node {
    Reflect.set(node, 'pos', start);
    Reflect.set(node, 'end', sourceFixtureText.length);
    node.forEachChild(function position(child) {
        callbackSourceRange(child, start);
    });
    return node;
}
export function bindAuthoringCall(
    fixture: SourceFixture,
    call: ast.CallExpression,
    name: string,
    declarationPath: string
): void {
    const declaration = ast.factory.createFunctionDeclaration(
        undefined,
        undefined,
        ast.factory.createIdentifier(name),
        undefined,
        [],
        undefined,
        ast.factory.createBlock([])
    );
    sourceFile([ declaration ], declarationPath);
    fixture.bindName(name, sourceSymbol(name, [ declaration ]));
    fixture.bindSignature(call, {
        declaration: {
            async resolve() {
                return declaration;
            }
        }
    });
}
function ownedPlan(file: ast.SourceFile): TestPlan {
    const original = observationPlan();
    const selected = {
        ...original.cases[0],
        bodyOrigin: {
            body() {
                throw new Error('Callback must stay unexecuted.');
            },
            location: { kind: 'known' as const, file: file.fileName, line: 1, column: 1 }
        }
    };
    return { ...original, cases: [ selected ], discoveredCases: [ selected ] };
}
export function ownedCallback(
    name: string,
    options: (body: ast.ArrowFunction) => readonly ast.Expression[]
): OwnershipFixture {
    const fixture = sourceFixture();
    const body = sourceBody([]);
    const call = sourceCall(ast.factory.createIdentifier(name), options(body));
    const file = callbackSourceRange(
        sourceFile([ ast.factory.createExpressionStatement(call) ], '/project/case.ts'),
        0
    );
    callbackSourceRange(body, 1);
    bindAuthoringCall(fixture, call, name, '/project/source/authoring/test.ts');
    fixture.addFile(file);
    return { ...fixture, body, call, plan: ownedPlan(file) };
}
export function callbackOrigin(fixture: OwnershipFixture): TestBodyOrigin {
    const value = fixture.plan.cases[0].bodyOrigin;
    if (value === null) {
        throw new Error('Missing owned callback.');
    }
    return value;
}
export function attachCallbackSource(fixture: OwnershipFixture, prelude: readonly ast.Statement[]): void {
    const file = callbackSourceRange(
        sourceFile([ ...prelude, ast.factory.createExpressionStatement(fixture.call) ], '/project/case.ts'),
        0
    );
    callbackSourceRange(fixture.body, 1);
    fixture.addFile(file);
}
