ALTER TABLE `profiles` ADD `name` text DEFAULT 'Primary profile' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `is_active` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `profiles` SET `is_active` = 1
WHERE `id` = (SELECT `id` FROM `profiles` ORDER BY `created_at` ASC LIMIT 1);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_uq` ON `profiles` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_active_uq` ON `profiles` (`is_active`) WHERE `is_active` = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_global_version_uq` ON `profile_versions` (`version`);
