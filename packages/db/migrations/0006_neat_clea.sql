CREATE TABLE `job_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`job_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`extractor_version` text NOT NULL,
	`extraction_json` text NOT NULL,
	`confidence_micros` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`invalidated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `scoring_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `job_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "job_requirements_profile_version_positive" CHECK("job_requirements"."profile_version" > 0),
	CONSTRAINT "job_requirements_confidence_range" CHECK("job_requirements"."confidence_micros" >= 0 and "job_requirements"."confidence_micros" <= 1000000)
);
--> statement-breakpoint
CREATE INDEX `job_requirements_job_created_idx` ON `job_requirements` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_requirements_task_idx` ON `job_requirements` (`task_id`);--> statement-breakpoint
CREATE TABLE `job_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`job_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`scoring_version` text NOT NULL,
	`eligible` integer NOT NULL,
	`job_active` integer NOT NULL,
	`gate_reasons_json` text NOT NULL,
	`match_score` integer,
	`ranking_score` integer,
	`ranking_factors_json` text,
	`breakdown_json` text,
	`matched_evidence_json` text NOT NULL,
	`gaps_json` text NOT NULL,
	`unknowns_json` text NOT NULL,
	`confidence_micros` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`review_state` text NOT NULL,
	`explanation` text NOT NULL,
	`ranking_as_of` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`invalidated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `scoring_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requirement_id`) REFERENCES `job_requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `job_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "job_scores_profile_version_positive" CHECK("job_scores"."profile_version" > 0),
	CONSTRAINT "job_scores_match_score_range" CHECK("job_scores"."match_score" is null or ("job_scores"."match_score" >= 0 and "job_scores"."match_score" <= 100)),
	CONSTRAINT "job_scores_ranking_score_range" CHECK("job_scores"."ranking_score" is null or ("job_scores"."ranking_score" >= 0 and "job_scores"."ranking_score" <= 100)),
	CONSTRAINT "job_scores_integer_presence" CHECK(("job_scores"."eligible" = 1 and "job_scores"."match_score" is not null and "job_scores"."ranking_score" is not null and "job_scores"."breakdown_json" is not null and "job_scores"."ranking_factors_json" is not null) or ("job_scores"."eligible" = 0 and "job_scores"."match_score" is null and "job_scores"."ranking_score" is null and "job_scores"."breakdown_json" is null and "job_scores"."ranking_factors_json" is null)),
	CONSTRAINT "job_scores_confidence_range" CHECK("job_scores"."confidence_micros" >= 0 and "job_scores"."confidence_micros" <= 1000000)
);
--> statement-breakpoint
CREATE INDEX `job_scores_job_created_idx` ON `job_scores` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_scores_current_idx` ON `job_scores` (`job_id`,`invalidated_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_scores_task_idx` ON `job_scores` (`task_id`);--> statement-breakpoint
CREATE TABLE `scoring_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`error_code` text,
	`error_summary` text,
	`output_hash` text,
	`output_bytes` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `scoring_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scoring_attempts_number_positive" CHECK("scoring_attempts"."attempt_number" > 0),
	CONSTRAINT "scoring_attempts_output_bytes_nonnegative" CHECK("scoring_attempts"."output_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_attempts_task_number_uq` ON `scoring_attempts` (`task_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `scoring_attempts_task_idx` ON `scoring_attempts` (`task_id`);--> statement-breakpoint
CREATE TABLE `scoring_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`extractor_version` text NOT NULL,
	`scoring_version` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`retry_at` integer,
	`claimed_at` integer,
	`last_error_code` text,
	`last_error_summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`invalidated_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `job_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scoring_tasks_profile_version_positive" CHECK("scoring_tasks"."profile_version" > 0),
	CONSTRAINT "scoring_tasks_attempt_count_valid" CHECK("scoring_tasks"."attempt_count" >= 0),
	CONSTRAINT "scoring_tasks_max_attempts_positive" CHECK("scoring_tasks"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_tasks_identity_uq` ON `scoring_tasks` (`job_id`,`snapshot_id`,`profile_version`,`extractor_version`,`scoring_version`);--> statement-breakpoint
CREATE INDEX `scoring_tasks_claim_idx` ON `scoring_tasks` (`status`,`invalidated_at`,`retry_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `scoring_tasks_job_created_idx` ON `scoring_tasks` (`job_id`,`created_at`);