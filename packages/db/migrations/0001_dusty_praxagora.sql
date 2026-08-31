CREATE TABLE `profile_evidence_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`original_filename` text,
	`content_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_evidence_sources_profile_idx` ON `profile_evidence_sources` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profile_facts` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`source_id` text NOT NULL,
	`confirmation_status` text NOT NULL,
	`evidence_excerpt` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `profile_evidence_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_facts_version_id_uq` ON `profile_facts` (`version_id`,`id`);--> statement-breakpoint
CREATE INDEX `profile_facts_version_kind_idx` ON `profile_facts` (`version_id`,`kind`);--> statement-breakpoint
CREATE INDEX `profile_facts_version_status_idx` ON `profile_facts` (`version_id`,`confirmation_status`);--> statement-breakpoint
CREATE INDEX `profile_facts_source_idx` ON `profile_facts` (`source_id`);--> statement-breakpoint
CREATE TABLE `profile_preferences` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`version_id` text NOT NULL,
	`data` text NOT NULL,
	`source_id` text NOT NULL,
	`confirmation_status` text NOT NULL,
	`evidence_excerpt` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `profile_evidence_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_preferences_version_id_unique` ON `profile_preferences` (`version_id`);--> statement-breakpoint
CREATE INDEX `profile_preferences_source_idx` ON `profile_preferences` (`source_id`);--> statement-breakpoint
CREATE TABLE `profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`change_summary` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_versions_version_positive" CHECK("profile_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_profile_version_uq` ON `profile_versions` (`profile_id`,`version`);--> statement-breakpoint
CREATE INDEX `profile_versions_profile_created_idx` ON `profile_versions` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`current_version_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
