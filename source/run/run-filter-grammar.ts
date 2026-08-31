import type { RunFilter, RunStringFilterField } from './run-types.ts';
import { all, any, contains, equals, glob, not } from './run-selection-filters.ts';

type RunFilterOperator = ':' | '=' | '~';

type ParserState = {
    readonly expression: string;
    readonly position: number;
};

type ParseResult<Value> = {
    readonly state: ParserState;
    readonly value: Value;
};

type FilterParser = (state: ParserState) => ParseResult<RunFilter>;

const escapedCharacterOffset = 1;
const escapedCharacterWidth = 2;

const runFilterFields: ReadonlySet<string> = new Set([
    'file',
    'name',
    'owner',
    'params',
    'runtime',
    'stability',
    'suite',
    'tag'
]);

const syntaxCharacters: ReadonlySet<string> = new Set([ '(', ')', '!', '|', '=', '~', ':' ]);
const valueBoundaryCharacters: ReadonlySet<string> = new Set([ '(', ')', '|' ]);

function isRunStringFilterField(value: string): value is RunStringFilterField {
    return runFilterFields.has(value);
}

function combineAll(filters: readonly RunFilter[]): RunFilter {
    const [ firstFilter, ...remainingFilters ] = filters;

    if (firstFilter === undefined) {
        throw new TypeError('Run filter expression must include a filter term.');
    }

    return remainingFilters.length === 0 ? firstFilter : all([ firstFilter, ...remainingFilters ]);
}

function combineAny(filters: readonly RunFilter[]): RunFilter {
    const [ firstFilter, ...remainingFilters ] = filters;

    if (firstFilter === undefined) {
        throw new TypeError('Run filter expression must include a filter term.');
    }

    return remainingFilters.length === 0 ? firstFilter : any([ firstFilter, ...remainingFilters ]);
}

function parseError(state: ParserState, message: string): TypeError {
    return new TypeError(`${message} At column ${state.position + 1}.`);
}

function withPosition(state: ParserState, position: number): ParserState {
    return { ...state, position };
}

function advance(state: ParserState): ParserState {
    return withPosition(state, state.position + 1);
}

function isDone(state: ParserState): boolean {
    return state.position >= state.expression.length;
}

function currentChar(state: ParserState): string {
    return state.expression[state.position] ?? '';
}

function isWhitespace(value: string): boolean {
    return value.trim().length === 0;
}

function isSyntaxCharacter(character: string): boolean {
    return isWhitespace(character) || syntaxCharacters.has(character);
}

function isValueBoundary(character: string): boolean {
    return isWhitespace(character) || valueBoundaryCharacters.has(character);
}

function quoteName(value: string): string {
    return value === "'" ? 'single quote' : 'double quote';
}

function skipWhitespace(state: ParserState): ParserState {
    const { expression, position: startPosition } = state;
    let position = startPosition;

    while (position < expression.length && isWhitespace(expression[position] ?? '')) {
        position += 1;
    }

    return withPosition(state, position);
}

function createStringFilter(field: RunStringFilterField, operator: RunFilterOperator, value: string): RunFilter {
    if (operator === '=') {
        return equals(field, value);
    }

    if (operator === '~') {
        return contains(field, value);
    }

    return glob(field, value);
}

function readDimension(state: ParserState): ParseResult<string> {
    const { expression, position: startPosition } = state;
    let position = startPosition;

    while (position < expression.length && !isSyntaxCharacter(expression[position] ?? '')) {
        position += 1;
    }

    const value = expression.slice(startPosition, position);

    if (value.length === 0) {
        throw parseError(state, 'Expected a run filter dimension.');
    }

    return { state: withPosition(state, position), value };
}

function readOperator(state: ParserState): ParseResult<RunFilterOperator> {
    const value = currentChar(state);

    if (value !== '=' && value !== '~' && value !== ':') {
        throw parseError(state, 'Expected one of =, ~, or : after run filter dimension.');
    }

    return { state: advance(state), value };
}

function assertNonEmptyValue(state: ParserState, value: string): void {
    if (value.trim().length === 0) {
        throw parseError(state, 'Run filter value must not be empty.');
    }
}

function readBareValue(state: ParserState): ParseResult<string> {
    const { expression, position: startPosition } = state;
    let position = startPosition;

    while (position < expression.length && !isValueBoundary(expression[position] ?? '')) {
        position += 1;
    }

    const value = expression.slice(startPosition, position);
    const nextState = withPosition(state, position);

    assertNonEmptyValue(nextState, value);

    return { state: nextState, value };
}

function readQuotedCharacter(state: ParserState, quote: string): ParseResult<string | null> {
    const value = currentChar(state);

    if (value === quote) {
        return { state: advance(state), value: null };
    }

    if (value === '\\' && state.position + escapedCharacterOffset < state.expression.length) {
        return {
            state: withPosition(state, state.position + escapedCharacterWidth),
            value: state.expression[state.position + escapedCharacterOffset] ?? ''
        };
    }

    return { state: advance(state), value };
}

function readQuotedValue(state: ParserState, quote: string): ParseResult<string> {
    let currentState = advance(state);
    let value = '';

    while (!isDone(currentState)) {
        const character = readQuotedCharacter(currentState, quote);

        currentState = character.state;

        if (character.value === null) {
            assertNonEmptyValue(currentState, value);

            return { state: currentState, value };
        }

        value += character.value;
    }

    throw parseError(currentState, `Unterminated ${quoteName(quote)} string.`);
}

function readValue(state: ParserState): ParseResult<string> {
    const valueState = skipWhitespace(state);
    const quote = currentChar(valueState);

    return quote === "'" || quote === '"'
        ? readQuotedValue(valueState, quote)
        : readBareValue(valueState);
}

function parseComparison(state: ParserState): ParseResult<RunFilter> {
    const field = readDimension(state);
    const operator = readOperator(skipWhitespace(field.state));
    const value = readValue(operator.state);

    if (!isRunStringFilterField(field.value)) {
        throw parseError(value.state, `Unknown run filter dimension: ${field.value}`);
    }

    return {
        state: value.state,
        value: createStringFilter(field.value, operator.value, value.value)
    };
}

function parseParenthesized(state: ParserState, parseExpression: FilterParser): ParseResult<RunFilter> {
    const expression = parseExpression(advance(state));
    const closeState = skipWhitespace(expression.state);

    if (currentChar(closeState) !== ')') {
        throw parseError(closeState, 'Expected closing parenthesis.');
    }

    return { state: advance(closeState), value: expression.value };
}

function parseTerm(state: ParserState, parseExpression: FilterParser): ParseResult<RunFilter> {
    const termState = skipWhitespace(state);

    if (isDone(termState)) {
        throw parseError(termState, 'Expected a filter term.');
    }

    if (currentChar(termState) === '!') {
        const term = parseTerm(advance(termState), parseExpression);

        return { state: term.state, value: not(term.value) };
    }

    return currentChar(termState) === '('
        ? parseParenthesized(termState, parseExpression)
        : parseComparison(termState);
}

function isAndBoundary(state: ParserState): boolean {
    return isDone(state) || currentChar(state) === ')' || currentChar(state) === '|';
}

function parseAnd(state: ParserState, parseExpression: FilterParser): ParseResult<RunFilter> {
    let term = parseTerm(state, parseExpression);
    const filters: RunFilter[] = [ term.value ];

    while (!isAndBoundary(skipWhitespace(term.state))) {
        term = parseTerm(term.state, parseExpression);
        filters.push(term.value);
    }

    return { state: term.state, value: combineAll(filters) };
}

function parseOr(state: ParserState): ParseResult<RunFilter> {
    let term = parseAnd(state, parseOr);
    const filters: RunFilter[] = [ term.value ];

    while (currentChar(skipWhitespace(term.state)) === '|') {
        term = parseAnd(advance(skipWhitespace(term.state)), parseOr);
        filters.push(term.value);
    }

    return { state: term.state, value: combineAny(filters) };
}

export function parseRunFilterExpression(expression: string): RunFilter {
    const initialState = skipWhitespace({ expression, position: 0 });

    if (isDone(initialState)) {
        throw new TypeError('Run filter expression must not be empty.');
    }

    const parsed = parseOr(initialState);
    const endState = skipWhitespace(parsed.state);

    if (!isDone(endState)) {
        throw parseError(endState, `Unexpected token: ${currentChar(endState)}`);
    }

    return parsed.value;
}
