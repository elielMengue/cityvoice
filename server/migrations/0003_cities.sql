-- Residents belong to a city, and the sandbox also holds requests mirrored
-- from a city's live Open311 feed, marked by where they came from.

ALTER TABLE residents ADD COLUMN city TEXT NOT NULL DEFAULT 'washington-dc';

-- 'sandbox' for requests filed through CityVoice or seeded for the demo;
-- a city id, like 'san-francisco', for requests mirrored from that city.
ALTER TABLE service_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'sandbox';

CREATE INDEX service_requests_by_source ON service_requests (source, requested_datetime);
