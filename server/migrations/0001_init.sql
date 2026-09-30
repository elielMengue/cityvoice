-- CityVoice schema for Cloudflare D1 (SQLite).
-- Times are ISO 8601 strings in UTC, which sort correctly as text.

CREATE TABLE residents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    home_address TEXT NOT NULL,
    home_lat REAL NOT NULL,
    home_lng REAL NOT NULL
);

CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    resident_id TEXT NOT NULL,
    location_json TEXT NOT NULL,
    service_code TEXT NOT NULL,
    description TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    submitted_request_id TEXT,
    submission_claimed_at TEXT
);

CREATE INDEX drafts_by_expiry ON drafts (expires_at);

-- Links a resident to a report they filed or support. The primary key is
-- what makes support count once per person.
CREATE TABLE my_reports (
    resident_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('author', 'supporter')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (resident_id, request_id)
);

-- The Open311 sandbox. Columns follow GeoReport v2 field names.
CREATE TABLE service_requests (
    service_request_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    status_notes TEXT,
    service_name TEXT NOT NULL,
    service_code TEXT NOT NULL,
    description TEXT,
    requested_datetime TEXT NOT NULL,
    updated_datetime TEXT,
    expected_datetime TEXT,
    address TEXT,
    lat REAL NOT NULL,
    long REAL NOT NULL,
    supporters INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX service_requests_by_code_status ON service_requests (service_code, status);

CREATE TABLE counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
