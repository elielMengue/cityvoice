/**
 * Places the way people say them. A full address is right on a screen and in
 * a readback, where every word counts. In a sentence about several reports it
 * is a mouthful: neighbors say "14th and U", "on T Street", "at your home".
 */

const QUADRANT = / (Northwest|Northeast|Southwest|Southeast)$/;
const INTERSECTION = /^(.+) and (.+)$/;
const STREET_ADDRESS = /^\d+[A-Z]? (.+)$/;

/** "14th Street and U Street Northwest" becomes "14th and U"; "1520 T Street Northwest" becomes "T Street". */
export function shortPlace(address: string): string {
    const plain = address.replace(QUADRANT, "");
    const intersection = INTERSECTION.exec(plain);
    if (intersection !== null) {
        const [first = "", second = ""] = [intersection[1], intersection[2]];
        // "14th Street and U Street": both are streets, so the word adds nothing.
        return first.endsWith(" Street") && second.endsWith(" Street")
            ? `${first.slice(0, -" Street".length)} and ${second.slice(0, -" Street".length)}`
            : `${first} and ${second}`;
    }
    return STREET_ADDRESS.exec(plain)?.[1] ?? plain;
}

/** "at your home", "at 14th and U", "on T Street": the place with the word that goes before it. */
export function spokenPlace(address: string, homeAddress?: string): string {
    if (address === homeAddress) {
        return "at your home";
    }
    const short = shortPlace(address);
    return INTERSECTION.test(short) ? `at ${short}` : `on ${short}`;
}
