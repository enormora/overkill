/* eslint no-bitwise: "off" -- SplitMix64 is defined by bitwise mixing and shifts. */
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

export type SplitMixGenerator = RandomGenerator & { readonly split: () => SplitMixGenerator; };
type BitMixing = {
    readonly shifts: readonly [bigint, bigint, bigint];
    readonly multipliers: readonly [bigint, bigint];
};
const valueFirstShift = 30n;
const valueSecondShift = 27n;
const valueFinalShift = 31n;
const gammaShift = 33n;
const valueFirstMultiplier = 0xBF_58_47_6D_1C_E4_E5_B9n;
const valueSecondMultiplier = 0x94_D0_49_BB_13_31_11_EBn;
const gammaFirstMultiplier = 0xFF_51_AF_D7_ED_55_8C_CDn;
const gammaSecondMultiplier = 0xC4_CE_B9_FE_1A_85_EC_53n;
const valueMix: BitMixing = {
    shifts: [ valueFirstShift, valueSecondShift, valueFinalShift ],
    multipliers: [ valueFirstMultiplier, valueSecondMultiplier ]
};
const gammaMix: BitMixing = {
    shifts: [ gammaShift, gammaShift, gammaShift ],
    multipliers: [ gammaFirstMultiplier, gammaSecondMultiplier ]
};
const stateBits = 64;
const binaryRadix = 2;
const leastSignificantBit = 1n;
const wordBits = 32n;
const wordMask = 0xFF_FF_FF_FFn;
const signedWordOffset = 0x80_00_00_00n;
const goldenGamma = 0x9E_37_79_B9_7F_4A_7C_15n;
const alternatingBits = 0xAA_AA_AA_AA_AA_AA_AA_AAn;
const minimumTransitions = 24;

function unsigned(value: bigint): bigint {
    return BigInt.asUintN(stateBits, value);
}

function mix(value: bigint, mixing: BitMixing): bigint {
    const [ firstShift, secondShift, finalShift ] = mixing.shifts;
    const [ firstMultiplier, secondMultiplier ] = mixing.multipliers;
    const first = unsigned((value ^ value >> firstShift) * firstMultiplier);
    const second = unsigned((first ^ first >> secondShift) * secondMultiplier);
    return second ^ second >> finalShift;
}

function splitGamma(value: bigint): bigint {
    const gamma = mix(value, gammaMix) | leastSignificantBit;
    const transitions = (gamma ^ gamma >> leastSignificantBit).toString(binaryRadix).replaceAll('0', '').length;
    return transitions < minimumTransitions ? gamma ^ alternatingBits : gamma;
}

function generator(seed: bigint, gamma: bigint): SplitMixGenerator {
    let state = unsigned(seed);
    function advance(): bigint {
        state = unsigned(state + gamma);
        return state;
    }
    return {
        next() {
            return Number((mix(advance(), valueMix) >> wordBits) - signedWordOffset);
        },
        clone() {
            return generator(state, gamma);
        },
        getState() {
            return [ state >> wordBits, state & wordMask, gamma >> wordBits, gamma & wordMask ].map(Number);
        },
        split() {
            return generator(mix(advance(), valueMix), splitGamma(advance()));
        }
    };
}

export function createSplitMix(seed: bigint): SplitMixGenerator {
    return generator(seed, goldenGamma);
}
