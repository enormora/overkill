import { AST_NODE_TYPES as NodeType, TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import { type BindingOrigin, isFunction, sameOrigin } from './binding-origin.ts';
import {
    type Allocation,
    allocationsOf,
    alternatives,
    emptyState,
    originValue,
    sameValue,
    type State,
    type Value,
    type Variable
} from './binding-state.ts';
import { bindIteration, bindPattern, transfer } from './binding-transfer.ts';
import { type BindingEvent, createFrame, type Frame, reachingBindings } from './reaching-bindings.ts';

type Node = Readonly<Tree.Node>;
type Query = (site: Node) => readonly Node[];

export type BindingAnalysis = {
    readonly originsWithin: (value: Node, at: Node) => readonly BindingOrigin[];
    readonly allocationsAt: (value: Node, at: Node) => readonly Allocation[];
    readonly originOf: (use: Readonly<Tree.Node>) => BindingOrigin | null;
};

function namedExport(node: Readonly<Tree.ImportSpecifier>): string {
    return node.imported.type === NodeType.Identifier ? node.imported.name : node.imported.value;
}

function importValue(definition: Readonly<TSESLint.Scope.Definition>): Value | undefined {
    if (
        definition.type !== TSESLint.Scope.DefinitionType.ImportBinding ||
        definition.parent.type !== NodeType.ImportDeclaration ||
        definition.parent.importKind === 'type'
    ) {
        return undefined;
    }
    const root = { kind: 'import' as const, source: definition.parent.source.value };
    return match(definition.node)
        .with({ type: NodeType.ImportSpecifier }, function (node) {
            return node.importKind === 'type' ? undefined : originValue(root, [ namedExport(node) ]);
        })
        .with({ type: NodeType.ImportDefaultSpecifier }, function () {
            return originValue(root, [ 'default' ]);
        })
        .with({ type: NodeType.ImportNamespaceSpecifier }, function () {
            return originValue(root, []);
        })
        .otherwise(function () {
            return undefined;
        });
}

function readsOnly(variable: Readonly<Variable>): boolean {
    return variable.references.every(function (reference) {
        return !reference.isWrite();
    });
}

type LexicalBindings = {
    readonly entry: (frame: Frame, captures: ReadonlyMap<Variable, Value>, trackAlternatives: boolean) => State;
    readonly apply: (state: State, event: Readonly<BindingEvent>) => void;
    readonly constants: ReadonlyMap<Readonly<Tree.VariableDeclarator>, readonly Variable[]>;
};

function canIndex(variable: Readonly<Variable>): boolean {
    return variable.references.every(function (reference) {
        return reference.from.variableScope === variable.scope.variableScope || !reference.isWrite();
    });
}

function isCaptured(variable: Readonly<Variable>): boolean {
    return variable.references.some(function (reference) {
        return reference.from.variableScope !== variable.scope.variableScope;
    });
}

function initializeParameters(
    state: State,
    references: ReadonlyMap<Readonly<Tree.Node>, Variable>,
    node: Readonly<Tree.Node>
): void {
    if (isFunction(node)) {
        for (const [ index, parameter ] of node.params.entries()) {
            const value = originValue({ kind: 'parameter', owner: node, index }, []);
            bindPattern(state, references, parameter, value);
        }
    }
}

function lexicalBindings(sourceCode: Readonly<TSESLint.SourceCode>): LexicalBindings {
    const index = {
        references: new Map<Readonly<Tree.Node>, Variable>(),
        imports: new Map<Variable, Value>(),
        captured: new Set<Variable>(),
        constants: new Map<Readonly<Tree.VariableDeclarator>, readonly Variable[]>(),
        declarations: new Map<Readonly<Tree.Node>, ReadonlyMap<Variable, Value>>()
    };
    const scopes = sourceCode.scopeManager?.scopes ?? [];

    function indexDefinition(variable: Variable, definition: Readonly<TSESLint.Scope.Definition>): void {
        const imported = importValue(definition);
        if (imported !== undefined) {
            index.imports.set(variable, imported);
        }
        if (
            definition.type === TSESLint.Scope.DefinitionType.Variable &&
            definition.parent.kind === 'const' &&
            index.captured.has(variable)
        ) {
            const declared = index.constants.get(definition.node) ?? [];
            index.constants.set(definition.node, declared.concat(variable));
        }
    }

    function indexFunction(variable: Variable, definition: Readonly<TSESLint.Scope.Definition>): void {
        if (definition.type === TSESLint.Scope.DefinitionType.FunctionName && isFunction(definition.node)) {
            const frame = variable.scope.variableScope.block;
            const declared = new Map(index.declarations.get(frame));
            declared.set(variable, originValue({ kind: 'function', node: definition.node }, []));
            index.declarations.set(frame, declared);
        }
    }

    function indexVariable(variable: Variable): void {
        if (isCaptured(variable)) {
            index.captured.add(variable);
        }
        for (const identifier of variable.identifiers) {
            index.references.set(identifier, variable);
        }
        for (const reference of variable.references) {
            index.references.set(reference.identifier, variable);
        }
        for (const definition of variable.defs) {
            indexDefinition(variable, definition);
            indexFunction(variable, definition);
        }
    }

    for (const scope of scopes) {
        scope.variables.filter(canIndex).forEach(indexVariable);
    }

    return {
        constants: index.constants,
        entry(frame, inherited, trackAlternatives) {
            const state = emptyState(trackAlternatives);
            const declared = index.declarations.get(frame.node) ?? [];
            const entries = Array.from(index.imports).concat(Array.from(inherited), Array.from(declared));
            for (const [ variable, value ] of entries) {
                state.bindings.store(variable, value);
            }
            initializeParameters(state, index.references, frame.node);
            return state;
        },
        apply(state, event) {
            if (event.kind === 'iteration') {
                bindIteration(state, index.references, event.node);
            } else {
                transfer(state, index.references, index.captured, event.node);
            }
        }
    };
}

function scalarCapture(value: Value | undefined): Value | null {
    return value?.kind === 'origin' || value?.kind === 'key' ? value : null;
}

function agreeingValue(previous: Value | null | undefined, value: Value | null): Value | null {
    if (previous === undefined) {
        return value;
    }
    return previous !== null && value !== null && sameValue(previous, value) ? value : null;
}

type CaptureObservations = {
    readonly observe: (state: State, node: Readonly<Tree.Node>) => void;
    readonly proven: () => ReadonlyMap<Variable, Value>;
};

function observeCaptures(
    bindings: LexicalBindings,
    entry: State,
    inherited: ReadonlyMap<Variable, Value>
): CaptureObservations {
    const captures = new Map<Variable, Value | null>(inherited);
    for (const [ variable, value ] of entry.bindings) {
        if (readsOnly(variable)) {
            captures.set(variable, value);
        }
    }
    return {
        observe(state, node) {
            if (node.type === NodeType.VariableDeclarator) {
                const constants = bindings.constants.get(node) ?? [];
                for (const variable of constants) {
                    const value = scalarCapture(state.bindings.get(variable));
                    captures.set(variable, agreeingValue(captures.get(variable), value));
                }
            }
        },
        proven() {
            const result = new Map<Variable, Value>();
            for (const [ variable, value ] of captures) {
                if (value !== null) {
                    result.set(variable, value);
                }
            }
            return result;
        }
    };
}

function agreeingOrigin(
    previous: BindingOrigin | null | undefined,
    origin: BindingOrigin | null
): BindingOrigin | null {
    if (previous === undefined) {
        return origin;
    }
    return previous !== null && origin !== null && sameOrigin(previous, origin) ? origin : null;
}

type ValueFacts = {
    readonly origins: readonly BindingOrigin[];
    readonly allocations: ReadonlySet<Allocation>;
    readonly addOrigin: (origin: BindingOrigin) => void;
    readonly addAllocation: (allocation: Allocation) => void;
};

function createValueFacts(): ValueFacts {
    const origins: BindingOrigin[] = [];
    const allocations = new Set<Allocation>();
    return {
        origins,
        allocations,
        addOrigin(origin) {
            if (
                origins.every(function (other) {
                    return !sameOrigin(origin, other);
                })
            ) {
                origins.push(origin);
            }
        },
        addAllocation(allocation) {
            allocations.add(allocation);
        }
    };
}

function addReachableOrigins(state: State, value: Value | undefined, facts: ValueFacts): void {
    const seen = new Set<Allocation>();
    const pending = new Set([ value ]);

    function addFields(allocation: Allocation): void {
        if (!seen.has(allocation)) {
            seen.add(allocation);
            const fields = state.objects.get(allocation);
            fields?.forEach(function (field) {
                pending.add(field);
            });
        }
    }

    for (const current of pending) {
        for (const candidate of alternatives(current)) {
            if (candidate.kind === 'origin') {
                facts.addOrigin(candidate.origin);
            }
        }
        const allocations = allocationsOf(current);
        for (const allocation of allocations) {
            addFields(allocation);
        }
    }
}

function valueFacts(state: State, value: Value | undefined, facts: ValueFacts): void {
    for (const allocation of allocationsOf(value)) {
        facts.addAllocation(allocation);
    }
    addReachableOrigins(state, value, facts);
}

function analyzeBindings(bindings: LexicalBindings, root: Frame, query: Query | null): BindingAnalysis {
    const origins = new Map<Node, BindingOrigin | null>();
    const facts = new Map<Node, Map<Node, ValueFacts>>();

    function observeValue(state: State, site: Node, expression: Node): void {
        const values = facts.get(site) ?? new Map<Node, ValueFacts>();
        const result = values.get(expression) ?? createValueFacts();
        valueFacts(state, state.expressions.get(expression), result);
        values.set(expression, result);
        facts.set(site, values);
    }

    function observeValues(state: State, site: Node, stage: 'after' | 'before'): void {
        const expressions = query?.(site) ?? [];
        for (const expression of expressions) {
            const afterExpression = expression === site;
            if (afterExpression === (stage === 'after')) {
                observeValue(state, site, expression);
            }
        }
    }

    function analyze(frame: Frame, inherited: ReadonlyMap<Variable, Value>, trackAlternatives: boolean): void {
        const entry = bindings.entry(frame, inherited, trackAlternatives);
        const captures = observeCaptures(bindings, entry, inherited);
        reachingBindings(frame, entry, bindings.apply, function (state, node, stage) {
            if (trackAlternatives) {
                observeValues(state, node, stage);
            }
            if (stage === 'after') {
                if (!trackAlternatives) {
                    const value = state.expressions.get(node);
                    const origin = value?.kind === 'origin' ? value.origin : null;
                    origins.set(node, agreeingOrigin(origins.get(node), origin));
                }
                captures.observe(state, node);
            }
        });
        const captured = captures.proven();
        for (const child of frame.children) {
            analyze(child, captured, trackAlternatives);
        }
    }

    analyze(root, new Map(), false);
    if (query !== null) {
        analyze(root, new Map(), true);
    }
    return {
        originOf(use) {
            return origins.get(use) ?? null;
        },
        originsWithin(value, at) {
            return facts.get(at)?.get(value)?.origins ?? [];
        },
        allocationsAt(value, at) {
            return Array.from(facts.get(at)?.get(value)?.allocations ?? []);
        }
    };
}

const iterationTypes: ReadonlySet<NodeType> = new Set([ NodeType.ForInStatement, NodeType.ForOfStatement ]);

function isIteration(node: Readonly<Tree.Node>): node is Readonly<Tree.ForInStatement | Tree.ForOfStatement> {
    return iterationTypes.has(node.type);
}

function iterationBody(node: Readonly<Tree.Node>): Readonly<Tree.ForInStatement | Tree.ForOfStatement> | undefined {
    if (node.type === NodeType.Program) {
        return undefined;
    }
    const { parent } = node;
    return isIteration(parent) && parent.body === node ? parent : undefined;
}

export function bindingAnalysis(
    sourceCode: Readonly<TSESLint.SourceCode>,
    complete: (analysis: BindingAnalysis) => void,
    observation: { readonly query: Query; readonly visit: (node: Node) => void; } | null
): TSESLint.RuleListener {
    const frames: Frame[] = [];
    const query = observation?.query ?? null;
    return {
        onCodePathStart(...[ path, node ]: readonly [never] | readonly [TSESLint.CodePath, Tree.Node]) {
            if (node !== undefined) {
                const frame = createFrame(path, node);
                frames.at(-1)?.addChild(frame);
                frames.push(frame);
            }
        },
        onCodePathSegmentStart(segment: TSESLint.CodePathSegment) {
            frames.at(-1)?.enter(segment);
        },
        onCodePathSegmentEnd(segment: TSESLint.CodePathSegment) {
            frames.at(-1)?.leave(segment);
        },
        '*'(node: Readonly<Tree.Node>) {
            observation?.visit(node);
            const loop = iterationBody(node);
            if (loop !== undefined) {
                frames.at(-1)?.record({ kind: 'iteration', node: loop });
            }
        },
        '*:exit'(node: Readonly<Tree.Node>) {
            if (!isFunction(node)) {
                frames.at(-1)?.record({ kind: 'expression', node });
            }
        },
        onCodePathEnd() {
            const frame = frames.pop();
            if (frame !== undefined && isFunction(frame.node)) {
                frames.at(-1)?.record({ kind: 'expression', node: frame.node });
            }
            if (frame?.node.type === NodeType.Program) {
                complete(analyzeBindings(lexicalBindings(sourceCode), frame, query));
            }
        }
    };
}
