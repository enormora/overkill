const iterations = 2_000_000;
const multiplier = 1_664_525;
const increment = 1_013_904_223;
const integerRange = 4_294_967_296;

export function referenceChecksum(): number {
    let checksum = 1;
    for (let index = 0; index < iterations; index += 1) {
        checksum = Math.abs(Math.imul(checksum + index, multiplier) + increment) % integerRange;
    }
    return checksum;
}
