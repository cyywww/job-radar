-- Job collection data is reproducible. If the database contains a removed
-- source types, reset only collection state so no unsupported configuration or orphaned
-- provenance survives the Sweden-first source contraction. Profile history is untouched.
DELETE FROM job_merge_events
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM job_snapshots
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM job_sources
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM jobs
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM source_runs
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM scan_runs
WHERE EXISTS (SELECT 1 FROM sources WHERE type NOT IN ('jobtech', 'generic_web'));
--> statement-breakpoint
DELETE FROM sources WHERE type NOT IN ('jobtech', 'generic_web');
--> statement-breakpoint
UPDATE sources
SET config_json = json_set(
      config_json,
      '$.occupationField', 'apaJ_2ja_LuF',
      '$.pageSize', 100,
      '$.maxPages', 20
    ),
    config_version = config_version + 1,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE type = 'jobtech'
  AND (
    json_extract(config_json, '$.occupationField') IS NOT 'apaJ_2ja_LuF'
    OR json_extract(config_json, '$.pageSize') IS NOT 100
    OR json_extract(config_json, '$.maxPages') IS NOT 20
  );
