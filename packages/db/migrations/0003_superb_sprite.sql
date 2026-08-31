DROP INDEX `sources_type_name_uq`;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_error_category` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sources_type_name_uq` ON `sources` (`type`,`name`) WHERE "sources"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE `job_sources` ADD `source_metadata_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `error_category` text;