export interface GeoPoint {
    readonly lat: number;
    readonly lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

/** Great-circle distance in meters (haversine). Accurate to well under a meter at city scale. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export interface BoundingBox {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
}

export function isInside(point: GeoPoint, box: BoundingBox): boolean {
    return point.lat >= box.south && point.lat <= box.north && point.lng >= box.west && point.lng <= box.east;
}
