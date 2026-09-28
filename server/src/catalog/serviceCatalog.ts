/** One choice for a question, with the words a resident might use for it. */
export interface AttributeOption {
    readonly key: string;
    /** How the answer reads in a sentence, for example "in the road". */
    readonly phrase: string;
    readonly synonyms: readonly string[];
}

/**
 * A question the city needs answered before it accepts a report. Maps to an
 * Open311 GeoReport v2 attribute. Without options, any non-empty answer counts.
 */
export interface ServiceAttribute {
    readonly code: string;
    readonly question: string;
    readonly required: boolean;
    readonly options?: readonly AttributeOption[];
}

export interface ServiceType {
    readonly code: string;
    /** Singular, as spoken: "a pothole report", "your pothole". */
    readonly name: string;
    /** Plural, as spoken: "the city usually handles potholes within...". */
    readonly pluralName: string;
    readonly synonyms: readonly string[];
    readonly typicalBusinessDays: number;
    readonly attributes: readonly ServiceAttribute[];
}

/** Service types for the Washington DC pilot, modelled on its 311 catalogue. */
export const SERVICE_TYPES: readonly ServiceType[] = [
    {
        code: "POTHOLE",
        name: "pothole",
        pluralName: "potholes",
        synonyms: ["pothole", "pot hole", "hole in the road", "hole in the street", "crater", "road damage"],
        typicalBusinessDays: 3,
        attributes: [
            {
                code: "position",
                question: "Is it in the road or in a crosswalk?",
                required: true,
                options: [
                    { key: "road", phrase: "in the road", synonyms: ["road", "street", "lane", "traffic", "roadway"] },
                    { key: "crosswalk", phrase: "in a crosswalk", synonyms: ["crosswalk", "crossing", "zebra"] },
                ],
            },
        ],
    },
    {
        code: "STREETLIGHT",
        name: "streetlight out",
        pluralName: "streetlight repairs",
        synonyms: [
            "streetlight",
            "street light",
            "street lamp",
            "streetlamp",
            "light pole",
            "lamp post",
            "lamppost",
            "light is out",
            "light out",
            "lights out",
        ],
        typicalBusinessDays: 5,
        attributes: [
            {
                code: "condition",
                question: "Is the light completely out, or is it flickering?",
                required: true,
                options: [
                    {
                        key: "out",
                        phrase: "completely out",
                        synonyms: ["out", "dark", "off", "not working", "broken", "completely"],
                    },
                    {
                        key: "flickering",
                        phrase: "flickering",
                        synonyms: ["flickering", "flicker", "blinking", "flashing", "on and off"],
                    },
                ],
            },
        ],
    },
    {
        code: "MISSED_TRASH",
        name: "missed trash pickup",
        pluralName: "missed pickups",
        synonyms: ["trash", "garbage", "rubbish", "missed pickup", "not picked up", "collection", "recycling"],
        typicalBusinessDays: 2,
        attributes: [
            {
                code: "stream",
                question: "Was it the trash or the recycling that was missed?",
                required: true,
                options: [
                    { key: "trash", phrase: "trash", synonyms: ["trash", "garbage", "rubbish", "regular"] },
                    { key: "recycling", phrase: "recycling", synonyms: ["recycling", "recycle", "recyclables"] },
                ],
            },
        ],
    },
    {
        code: "GRAFFITI",
        name: "graffiti",
        pluralName: "graffiti reports",
        synonyms: ["graffiti", "tagging", "tagged", "spray paint", "spray painted", "vandalism"],
        typicalBusinessDays: 7,
        attributes: [
            {
                code: "surface",
                question: "Is it on public property, like a sign or a bridge, or on a private building?",
                required: true,
                options: [
                    {
                        key: "public",
                        phrase: "on public property",
                        synonyms: ["public", "sign", "bridge", "bench", "pole", "mailbox", "bus stop", "wall"],
                    },
                    {
                        key: "private",
                        phrase: "on a private building",
                        synonyms: ["private", "house", "building", "store", "shop", "home"],
                    },
                ],
            },
        ],
    },
    {
        code: "ILLEGAL_DUMPING",
        name: "illegal dumping",
        pluralName: "illegal dumping reports",
        synonyms: ["dumping", "dumped", "mattress", "couch", "sofa", "furniture", "junk", "debris", "tires"],
        typicalBusinessDays: 5,
        attributes: [{ code: "items", question: "What was dumped?", required: true }],
    },
    {
        code: "SIDEWALK",
        name: "sidewalk damage",
        pluralName: "sidewalk repairs",
        synonyms: ["sidewalk", "pavement", "cracked sidewalk", "broken sidewalk", "uneven", "trip hazard"],
        typicalBusinessDays: 10,
        attributes: [],
    },
    {
        code: "ABANDONED_VEHICLE",
        name: "abandoned vehicle",
        pluralName: "abandoned vehicles",
        synonyms: [
            "abandoned car",
            "abandoned vehicle",
            "hasn't moved",
            "has not moved",
            "junk car",
            "flat tires",
            "parked for weeks",
        ],
        typicalBusinessDays: 5,
        attributes: [{ code: "vehicle", question: "What color and make is the vehicle?", required: true }],
    },
    {
        code: "TREE_HAZARD",
        name: "tree hazard",
        pluralName: "tree hazards",
        synonyms: ["tree", "branch", "limb", "fallen tree", "dead tree", "leaning tree"],
        typicalBusinessDays: 3,
        attributes: [
            {
                code: "blocking",
                question: "Is it blocking the road or the sidewalk right now?",
                required: true,
                options: [
                    { key: "yes", phrase: "blocking the way", synonyms: ["yes", "blocking", "blocked", "in the way"] },
                    { key: "no", phrase: "not blocking anything", synonyms: ["no", "not blocking", "not really"] },
                ],
            },
        ],
    },
];

export const MAX_RANKED_SERVICES = 5;

export function findServiceType(code: string): ServiceType | undefined {
    return SERVICE_TYPES.find((service) => service.code === code);
}

function normalize(text: string): string {
    return ` ${text
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
    return normalizedText.includes(normalize(phrase));
}

export interface RankedService {
    readonly service: ServiceType;
    /** Number of words from matching synonyms. Only meaningful compared with other scores. */
    readonly score: number;
}

/**
 * Ranks service types by how well their synonyms match the description.
 * Longer matching phrases weigh more, so "abandoned car" beats a bare "car".
 */
export function rankServiceTypes(description: string): readonly RankedService[] {
    const text = normalize(description);
    return SERVICE_TYPES.map((service) => ({
        service,
        score: service.synonyms
            .filter((synonym) => containsPhrase(text, synonym))
            .reduce((total, synonym) => total + synonym.split(" ").length, 0),
    }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RANKED_SERVICES);
}

/**
 * True when the first service is so far ahead that asking the resident to
 * choose would only waste a turn. "A tree branch is blocking the sidewalk"
 * is a tree hazard, not sidewalk damage. A tie, like "graffiti on the trash
 * can", is left to the resident.
 */
export function hasClearWinner(ranked: readonly RankedService[]): boolean {
    const [first, second] = ranked;
    return first !== undefined && (second === undefined || first.score >= 2 * second.score);
}

/**
 * Maps a free answer ("the right lane", "yeah it's blocking") to an option
 * key. Returns undefined when the answer fits no option, so the question is
 * asked again rather than guessed.
 */
export function matchAttributeAnswer(attribute: ServiceAttribute, answer: string): string | undefined {
    const text = normalize(answer);
    if (attribute.options === undefined) {
        return text.trim().length > 0 ? answer.trim() : undefined;
    }
    const direct = attribute.options.find((option) => option.key === answer.trim().toLowerCase());
    if (direct !== undefined) {
        return direct.key;
    }
    const matches = attribute.options.filter((option) =>
        option.synonyms.some((synonym) => containsPhrase(text, synonym)),
    );
    return matches.length === 1 ? matches[0]?.key : undefined;
}
