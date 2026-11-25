import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import { scopeParameters } from './authoring-contracts.ts';
import type { BindingAnalysis } from './binding-analysis.ts';
import type { BindingOrigin } from './binding-origin.ts';

type Node = Readonly<Tree.Node>;
type Call = Readonly<Tree.CallExpression>;
type Reference = TSESLint.Scope.Reference;

type Use = 'forward' | 'assert' | 'unknown';

function wrapper(parent: Node, node: Node): boolean {
    return match(parent)
        .with(
            { type: NodeType.TSAsExpression },
            { type: NodeType.TSInstantiationExpression },
            { type: NodeType.TSNonNullExpression },
            { type: NodeType.TSSatisfiesExpression },
            { type: NodeType.TSTypeAssertion },
            { type: NodeType.ChainExpression },
            function (expression) {
                return expression.expression === node;
            }
        )
        .otherwise(function () {
            return false;
        });
}

function exported(node: Node): boolean {
    return node.parent?.type === NodeType.ExportNamedDeclaration ||
        node.parent?.type === NodeType.ExportDefaultDeclaration;
}

function localBindingTarget(node: Node, bindings: ReadonlyMap<Node, Reference>): boolean {
    if (node.type === NodeType.Identifier) {
        return hasDeclaration(bindings.get(node));
    }
    if (node.type === NodeType.ObjectPattern) {
        return node.properties.every(function (property) {
            return property.type === NodeType.Property && localBindingTarget(property.value, bindings);
        });
    }
    if (node.type === NodeType.ArrayPattern) {
        return node.elements.every(function (element) {
            return element === null || localBindingTarget(element, bindings);
        });
    }
    return false;
}

function hasDeclaration(reference: Reference | undefined): boolean {
    return (reference?.resolved?.defs.length ?? 0) > 0;
}

function localAssignment(
    assignment: Readonly<Tree.AssignmentExpression>,
    analysis: BindingAnalysis,
    bindings: ReadonlyMap<Node, Reference>
): boolean {
    if (assignment.operator !== '=') {
        return false;
    }
    const { left } = assignment;
    return left.type === NodeType.MemberExpression
        ? (!left.computed || left.property.type === NodeType.Literal) &&
            analysis.allocationsAt(left.object, assignment).length === 1
        : localBindingTarget(left, bindings);
}

function carriesReference(parent: Node, value: Node, analysis: BindingAnalysis): boolean {
    return match(parent)
        .with({ type: NodeType.Property }, function (property) {
            return property.value === value && property.parent.type === NodeType.ObjectExpression;
        })
        .with({ type: NodeType.ObjectExpression }, function () {
            return value.type === NodeType.Property && analysis.allocationsAt(parent, parent).length === 1;
        })
        .with({ type: NodeType.ArrayExpression }, function () {
            return analysis.allocationsAt(parent, parent).length === 1;
        })
        .otherwise(function () {
            return wrapper(parent, value);
        });
}

function readsLocalProperty(parent: Node, value: Node, analysis: BindingAnalysis): boolean {
    return parent.type === NodeType.MemberExpression && parent.object === value && !parent.optional &&
        (!parent.computed || parent.property.type === NodeType.Literal) &&
        analysis.allocationsAt(value, value).length === 1;
}

function terminalUse(parent: Node, value: Node, analysis: BindingAnalysis): Use {
    return match(parent)
        .with({ type: NodeType.VariableDeclarator }, function (declaration) {
            return declaration.init === value && !exported(declaration.parent) ? 'forward' : 'unknown';
        })
        .with({ type: NodeType.ExpressionStatement }, function () {
            return value.type === NodeType.AssignmentExpression ? 'forward' : 'unknown';
        })
        .otherwise(function () {
            return readsLocalProperty(parent, value, analysis) ? 'forward' : 'unknown';
        });
}

function aliasesOnWrite(parent: Node, value: Node, analysis: BindingAnalysis, bindings: ReadonlyMap<Node, Reference>): boolean {
    return parent.type === NodeType.AssignmentExpression && parent.right === value &&
        localAssignment(parent, analysis, bindings);
}

function disposition(
    node: Node,
    analysis: BindingAnalysis,
    bindings: ReadonlyMap<Node, Reference>,
    assertions: ReadonlySet<Node>
): Use {
    let value = node;
    for (let parent = value.parent; parent !== undefined; parent = value.parent) {
        if (assertions.has(value) && parent.type === NodeType.CallExpression) {
            return 'assert';
        }
        if (!aliasesOnWrite(parent, value, analysis, bindings) && !carriesReference(parent, value, analysis)) {
            return terminalUse(parent, value, analysis);
        }
        value = parent;
    }
    return 'unknown';
}

function factoryOf(origin: BindingOrigin | null, factories: ReadonlySet<Call>): Call | null {
    return origin?.root.kind === 'call' && origin.path.length === 0 && factories.has(origin.root.node)
        ? origin.root.node
        : null;
}

function assertionArguments(
    source: Readonly<TSESLint.SourceCode>,
    analysis: BindingAnalysis,
    calls: readonly Call[]
): ReadonlySet<Node> {
    const owners = scopeParameters(source, analysis, calls);
    return new Set(calls.flatMap(function (call) {
        const first = call.arguments[0];
        if (first === undefined || first.type === NodeType.SpreadElement) {
            return [];
        }
        const origin = analysis.originOf(call.callee);
        return assertionReceiver(origin, owners) ? [ first ] : [];
    }));
}

function assertionReceiver(origin: BindingOrigin | null, owners: ReturnType<typeof scopeParameters>): boolean {
    if (origin?.root.kind !== 'parameter' || origin.path.length !== 1 || origin.path[0] !== 'assert') {
        return false;
    }
    const { owner, index } = origin.root;
    return owners.some(function (parameter) {
        return parameter.body === owner && parameter.index === index;
    });
}

function sourceBindings(source: Readonly<TSESLint.SourceCode>): ReadonlyMap<Node, Reference> {
    const bindings = new Map<Node, Reference>();
    for (const scope of source.scopeManager?.scopes ?? []) {
        for (const variable of scope.variables) {
            variable.references.forEach(function (reference) {
                if (reference.resolved === variable) {
                    bindings.set(reference.identifier, reference);
                }
            });
        }
    }
    return bindings;
}

function isExportReference(node: Node): boolean {
    return node.parent?.type === NodeType.ExportSpecifier ||
        node.parent?.type === NodeType.ExportDefaultDeclaration ||
        node.parent?.type === NodeType.TSExportAssignment;
}

function unprovenRead(reference: Reference, analysis: BindingAnalysis): boolean {
    const node = reference.identifier;
    return isExportReference(node) ||
        !analysis.observed(node) || reference.from.variableScope !== reference.resolved?.scope.variableScope;
}

type ReferenceUses = {
    readonly recordBinding: (reference: Reference, node: Node) => void;
    readonly recordMember: (node: Readonly<Tree.MemberExpression>) => void;
    readonly recordDefinition: (factory: Call) => void;
    readonly hasOneUse: (factory: Call) => boolean;
};

function countReferenceUses(
    analysis: BindingAnalysis,
    bindings: ReadonlyMap<Node, Reference>,
    assertions: ReadonlySet<Node>,
    factories: ReadonlySet<Call>
): ReferenceUses {
    const unsafe = new Set<Call>();
    const uses = new Map<Call, number>();

    function possibleFactories(node: Node): readonly Call[] {
        return analysis.originsWithin(node, node).flatMap(function (origin) {
            const factory = factoryOf(origin, factories);
            return factory === null ? [] : [ factory ];
        });
    }

    function record(node: Node, candidates: readonly Call[]): void {
        if (candidates.length === 0) {
            return;
        }
        const use = disposition(node, analysis, bindings, assertions);
        const proven = factoryOf(analysis.originOf(node), factories);
        candidates.forEach(function (candidate) {
            if (use === 'assert' && proven === candidate) {
                uses.set(candidate, (uses.get(candidate) ?? 0) + 1);
            } else if (use !== 'forward') {
                unsafe.add(candidate);
            }
        });
    }

    function recordUnresolved(reference: Reference): void {
        for (const { writeExpr = null } of reference.resolved?.references ?? []) {
            if (writeExpr !== null) {
                possibleFactories(writeExpr).forEach(function (factory) {
                    unsafe.add(factory);
                });
            }
        }
    }

    function recordBinding(reference: Reference, node: Node): void {
        if (!reference.isRead()) {
            return;
        }
        const candidates = possibleFactories(node);
        record(node, candidates);
        if (candidates.length === 0 && unprovenRead(reference, analysis)) {
            recordUnresolved(reference);
        }
    }

    function recordMember(node: Readonly<Tree.MemberExpression>): void {
        if (node.parent?.type !== NodeType.AssignmentExpression || node.parent.left !== node) {
            record(node, possibleFactories(node));
        }
    }

    return {
        recordBinding,
        recordMember,
        recordDefinition(factory: Call) {
            record(factory, [ factory ]);
        },
        hasOneUse(factory: Call) {
            return !unsafe.has(factory) && uses.get(factory) === 1;
        }
    };
}

export function singleAssertionUses(
    source: Readonly<TSESLint.SourceCode>,
    analysis: BindingAnalysis,
    sites: { readonly calls: readonly Call[]; readonly members: readonly Readonly<Tree.MemberExpression>[]; },
    factories: ReadonlySet<Call>
): ReadonlySet<Call> {
    const assertions = assertionArguments(source, analysis, sites.calls);
    const bindings = sourceBindings(source);
    const uses = countReferenceUses(analysis, bindings, assertions, factories);
    bindings.forEach(uses.recordBinding);
    sites.members.forEach(uses.recordMember);
    factories.forEach(uses.recordDefinition);
    return new Set(Array.from(factories).filter(uses.hasOneUse));
}
