CREATE TABLE IF NOT EXISTS `forge_master_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text,
	`profiles_json` text NOT NULL,
	`active_profile_id` text,
	`updated_at` text NOT NULL
);
