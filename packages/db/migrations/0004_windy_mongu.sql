CREATE TABLE `job_merge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`absorbed_job_id` text,
	`source_id` text,
	`source_job_id` text,
	`scan_run_id` text,
	`match_strategy` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `job_merge_events_job_created_idx` ON `job_merge_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_merge_events_source_idx` ON `job_merge_events` (`source_id`);--> statement-breakpoint
DROP INDEX `job_snapshots_job_hash_uq`;--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `deadline` integer;--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `source_id` text REFERENCES sources(id);--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `scan_run_id` text REFERENCES scan_runs(id);--> statement-breakpoint
ALTER TABLE `job_snapshots` ADD `changed_fields_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `job_snapshots`
SET `company` = (SELECT `company` FROM `jobs` WHERE `jobs`.`id` = `job_snapshots`.`job_id`),
    `title` = (SELECT `title` FROM `jobs` WHERE `jobs`.`id` = `job_snapshots`.`job_id`),
    `location` = (SELECT `location` FROM `jobs` WHERE `jobs`.`id` = `job_snapshots`.`job_id`),
    `deadline` = (SELECT `deadline` FROM `jobs` WHERE `jobs`.`id` = `job_snapshots`.`job_id`),
    `source_id` = (
      SELECT `source_id` FROM `job_sources`
      WHERE `job_sources`.`job_id` = `job_snapshots`.`job_id`
      ORDER BY `first_seen_at`, `source_id` LIMIT 1
    ),
    `changed_fields_json` = '["initial"]';--> statement-breakpoint
CREATE UNIQUE INDEX `job_snapshots_job_source_hash_uq` ON `job_snapshots` (`job_id`,`source_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `job_snapshots_source_fetched_idx` ON `job_snapshots` (`source_id`,`fetched_at`);--> statement-breakpoint
ALTER TABLE `job_sources` ADD `last_changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_sources` ADD `match_strategy` text DEFAULT 'new_job' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_sources` ADD `match_evidence_json` text DEFAULT '{"explanation":"Historical source link imported before deterministic merge audit."}' NOT NULL;--> statement-breakpoint
UPDATE `job_sources` SET `last_changed_at` = `last_seen_at`;--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `content_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `canonical_source_id` text REFERENCES sources(id);--> statement-breakpoint
UPDATE `jobs`
SET `last_changed_at` = `last_seen_at`,
    `canonical_source_id` = (
      SELECT `source_id` FROM `job_sources`
      WHERE `job_sources`.`job_id` = `jobs`.`id`
      ORDER BY `first_seen_at`, `source_id` LIMIT 1
    );--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `scan_runs_active_dedupe_uq` ON `scan_runs` (`dedupe_key`) WHERE "scan_runs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE `source_runs` ADD `config_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `config_version` integer DEFAULT 1 NOT NULL;
