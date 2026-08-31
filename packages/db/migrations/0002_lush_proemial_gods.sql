CREATE TABLE `job_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`description_text` text NOT NULL,
	`description_html` text,
	`raw_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_snapshots_job_hash_uq` ON `job_snapshots` (`job_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `job_snapshots_job_fetched_idx` ON `job_snapshots` (`job_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `job_sources` (
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_job_id` text NOT NULL,
	`source_url` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_seen_scan_run_id` text NOT NULL,
	`consecutive_misses` integer DEFAULT 0 NOT NULL,
	`active` integer NOT NULL,
	PRIMARY KEY(`job_id`, `source_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_seen_scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_sources_source_job_uq` ON `job_sources` (`source_id`,`source_job_id`);--> statement-breakpoint
CREATE INDEX `job_sources_job_idx` ON `job_sources` (`job_id`);--> statement-breakpoint
CREATE INDEX `job_sources_source_active_idx` ON `job_sources` (`source_id`,`active`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_key` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text NOT NULL,
	`remote_mode` text NOT NULL,
	`employment_type` text,
	`published_at` integer,
	`deadline` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`active` integer NOT NULL,
	`closed_at` integer,
	`canonical_url` text NOT NULL,
	`current_snapshot_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_canonical_key_uq` ON `jobs` (`canonical_key`);--> statement-breakpoint
CREATE INDEX `jobs_active_published_idx` ON `jobs` (`active`,`published_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_title_idx` ON `jobs` (`company`,`title`);--> statement-breakpoint
CREATE INDEX `jobs_deadline_idx` ON `jobs` (`deadline`);--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`profile_version` integer NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`unchanged_count` integer DEFAULT 0 NOT NULL,
	`closed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`cancel_requested_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "scan_runs_profile_version_positive" CHECK("scan_runs"."profile_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `scan_runs_created_idx` ON `scan_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `scan_runs_status_idx` ON `scan_runs` (`status`);--> statement-breakpoint
CREATE TABLE `source_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`queries_json` text NOT NULL,
	`result_set_complete` integer,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`unchanged_count` integer DEFAULT 0 NOT NULL,
	`closed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_runs_scan_source_uq` ON `source_runs` (`scan_run_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `source_runs_scan_idx` ON `source_runs` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `source_runs_source_created_idx` ON `source_runs` (`source_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`enabled` integer NOT NULL,
	`config_json` text NOT NULL,
	`last_success_at` integer,
	`last_error` text,
	`health_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_type_name_uq` ON `sources` (`type`,`name`);--> statement-breakpoint
CREATE INDEX `sources_enabled_idx` ON `sources` (`enabled`);