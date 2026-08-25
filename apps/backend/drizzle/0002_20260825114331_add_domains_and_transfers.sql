CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registry` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`auth_info` text NOT NULL,
	`owner_user_id` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_name_unique` ON `domains` (`name`);--> statement-breakpoint
CREATE INDEX `domains_owner_user_id_idx` ON `domains` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`registry` text NOT NULL,
	`status` text DEFAULT 'pendingTransfer' NOT NULL,
	`gaining_user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`gaining_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transfers_domain_id_idx` ON `transfers` (`domain_id`);--> statement-breakpoint
CREATE INDEX `transfers_gaining_user_id_idx` ON `transfers` (`gaining_user_id`);