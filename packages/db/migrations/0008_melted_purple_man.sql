PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scoring_attempts` (
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
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`reasoning_output_tokens` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `scoring_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scoring_attempts_number_positive" CHECK("__new_scoring_attempts"."attempt_number" > 0),
	CONSTRAINT "scoring_attempts_output_bytes_nonnegative" CHECK("__new_scoring_attempts"."output_bytes" >= 0),
	CONSTRAINT "scoring_attempts_usage_nonnegative" CHECK(("__new_scoring_attempts"."input_tokens" is null or "__new_scoring_attempts"."input_tokens" >= 0) and ("__new_scoring_attempts"."cached_input_tokens" is null or "__new_scoring_attempts"."cached_input_tokens" >= 0) and ("__new_scoring_attempts"."output_tokens" is null or "__new_scoring_attempts"."output_tokens" >= 0) and ("__new_scoring_attempts"."reasoning_output_tokens" is null or "__new_scoring_attempts"."reasoning_output_tokens" >= 0)),
	CONSTRAINT "scoring_attempts_usage_complete" CHECK(("__new_scoring_attempts"."input_tokens" is null and "__new_scoring_attempts"."cached_input_tokens" is null and "__new_scoring_attempts"."output_tokens" is null and "__new_scoring_attempts"."reasoning_output_tokens" is null) or ("__new_scoring_attempts"."input_tokens" is not null and "__new_scoring_attempts"."cached_input_tokens" is not null and "__new_scoring_attempts"."output_tokens" is not null and "__new_scoring_attempts"."reasoning_output_tokens" is not null)),
	CONSTRAINT "scoring_attempts_cached_within_input" CHECK("__new_scoring_attempts"."cached_input_tokens" is null or "__new_scoring_attempts"."cached_input_tokens" <= "__new_scoring_attempts"."input_tokens"),
	CONSTRAINT "scoring_attempts_reasoning_within_output" CHECK("__new_scoring_attempts"."reasoning_output_tokens" is null or "__new_scoring_attempts"."reasoning_output_tokens" <= "__new_scoring_attempts"."output_tokens")
);
--> statement-breakpoint
INSERT INTO `__new_scoring_attempts`("id", "task_id", "attempt_number", "outcome", "provider", "model", "error_code", "error_summary", "output_hash", "output_bytes", "started_at", "finished_at") SELECT "id", "task_id", "attempt_number", "outcome", "provider", "model", "error_code", "error_summary", "output_hash", "output_bytes", "started_at", "finished_at" FROM `scoring_attempts`;--> statement-breakpoint
DROP TABLE `scoring_attempts`;--> statement-breakpoint
ALTER TABLE `__new_scoring_attempts` RENAME TO `scoring_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_attempts_task_number_uq` ON `scoring_attempts` (`task_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `scoring_attempts_task_idx` ON `scoring_attempts` (`task_id`);
