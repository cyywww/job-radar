CREATE TABLE `job_triage` (
	`job_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `job_triage_status_updated_idx` ON `job_triage` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `score_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`score_id` text,
	`type` text NOT NULL,
	`original_score` integer,
	`suggested_score` integer,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`score_id`) REFERENCES `job_scores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "score_feedback_original_score_range" CHECK("score_feedback"."original_score" is null or ("score_feedback"."original_score" >= 0 and "score_feedback"."original_score" <= 100)),
	CONSTRAINT "score_feedback_suggested_score_range" CHECK("score_feedback"."suggested_score" is null or ("score_feedback"."suggested_score" >= 0 and "score_feedback"."suggested_score" <= 100)),
	CONSTRAINT "score_feedback_reason_present" CHECK(length(trim("score_feedback"."reason")) > 0)
);
--> statement-breakpoint
CREATE INDEX `score_feedback_job_created_idx` ON `score_feedback` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `score_feedback_score_idx` ON `score_feedback` (`score_id`);--> statement-breakpoint
CREATE TABLE `score_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`score_id` text NOT NULL,
	`previous_state` text NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`score_id`) REFERENCES `job_scores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "score_review_events_reason_present" CHECK(length(trim("score_review_events"."reason")) > 0)
);
--> statement-breakpoint
CREATE INDEX `score_review_events_job_created_idx` ON `score_review_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `score_review_events_score_created_idx` ON `score_review_events` (`score_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `stage` text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
UPDATE `scan_runs` SET `stage` = 'complete' WHERE `status` IN ('succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE `source_runs` ADD `stage` text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
UPDATE `source_runs` SET `stage` = 'complete' WHERE `status` IN ('succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE `source_runs` ADD `failure_stage` text;
