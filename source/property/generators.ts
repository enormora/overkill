import { array, choice, record, recursive, tuple } from './generator-composition.ts';
import { bigint, boolean, bytes, constant, integer, number, string } from './generator-primitives.ts';

export const gen = Object.freeze({
    array,
    bigint,
    boolean,
    bytes,
    choice,
    constant,
    integer,
    number,
    record,
    recursive,
    string,
    tuple
});
