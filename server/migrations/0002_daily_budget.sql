-- Daily usage counters. KV on the free plan allows 1,000 writes a day, and
-- the OAuth routes write to it, so their use is counted here, exactly.

CREATE TABLE daily_usage (
    day TEXT NOT NULL,
    name TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (day, name)
);
