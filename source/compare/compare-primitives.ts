import { type Primitive, detectType } from './primitive-types.js';

interface EqualResult {
    readonly isEqual: true;
    readonly leftHandSide?: undefined;
    readonly rightHandSide?: undefined;
}

interface OperandDetails {
    readonly value: unknown;
    readonly detectedType: Primitive;
}

interface NonEqualResult {
    readonly isEqual: false;
    readonly leftHandSide: OperandDetails;
    readonly rightHandSide: OperandDetails;
}

export type ComparisonResult = EqualResult | NonEqualResult;

export function compareValues(leftHandSideValue: unknown, rightHandSideValue: unknown): ComparisonResult {
    const typeOfLeftHandSideValue = detectType(leftHandSideValue);
    const typeOfRightHandSideValue = detectType(rightHandSideValue);

    if (typeOfLeftHandSideValue === typeOfRightHandSideValue && Object.is(leftHandSideValue, rightHandSideValue)) {
        return { isEqual: true };
    }

    return {
        isEqual: false,
        leftHandSide: { value: leftHandSideValue, detectedType: typeOfLeftHandSideValue },
        rightHandSide: { value: rightHandSideValue, detectedType: typeOfRightHandSideValue },
    };
}
