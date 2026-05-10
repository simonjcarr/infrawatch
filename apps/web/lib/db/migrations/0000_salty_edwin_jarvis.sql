CREATE TABLE "instance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"licence_tier" text DEFAULT 'community' NOT NULL,
	"licence_key" text,
	"licence_verifier_public_key" text,
	"licence_verifier_public_key_fingerprint" text,
	"metric_retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "instance_settings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "totp_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"instance_id" text,
	"role" text DEFAULT 'engineer' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"theme" text DEFAULT 'system' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'engineer' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token" text NOT NULL,
	"instance_id" text NOT NULL,
	"invited_by_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "agent_enrolment_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"label" text NOT NULL,
	"token" text NOT NULL,
	"token_hash" text,
	"created_by_id" text NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"skip_verify" boolean DEFAULT false NOT NULL,
	"max_uses" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "agent_enrolment_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "agent_enrolment_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "agent_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"status" text NOT NULL,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"hostname" text NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" text,
	"os" text,
	"arch" text,
	"last_heartbeat_at" timestamp with time zone,
	"approved_by_id" text,
	"approved_at" timestamp with time zone,
	"enrolment_token_id" text,
	"client_cert_pem" text,
	"client_cert_serial" text,
	"client_cert_issued_at" timestamp with time zone,
	"client_cert_not_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "agents_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "agents_client_cert_serial_unique" UNIQUE("client_cert_serial")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"agent_id" text,
	"hostname" text NOT NULL,
	"display_name" text,
	"os" text,
	"os_version" text,
	"arch" text,
	"ip_addresses" jsonb,
	"cpu_percent" real,
	"memory_percent" real,
	"disk_percent" real,
	"uptime_seconds" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"tags" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "host_metrics" (
	"id" text NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"cpu_percent" real,
	"memory_percent" real,
	"disk_percent" real,
	"uptime_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_metrics_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"host_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"output" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text,
	"name" text NOT NULL,
	"check_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"query_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "alert_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"host_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"status" text DEFAULT 'firing' NOT NULL,
	"message" text NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text,
	"name" text NOT NULL,
	"condition_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_global_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "alert_silences" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text,
	"rule_id" text,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"user_id" text NOT NULL,
	"alert_instance_id" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"severity" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "certificate_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"certificate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"discovered_by_host_id" text,
	"check_id" text,
	"source" text DEFAULT 'discovered' NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"server_name" text NOT NULL,
	"common_name" text NOT NULL,
	"issuer" text NOT NULL,
	"sans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"details" jsonb NOT NULL,
	"tracked_url" text,
	"refresh_interval_seconds" integer,
	"last_refreshed_at" timestamp with time zone,
	"last_refresh_error" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "identity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"service_account_id" text,
	"ssh_key_id" text,
	"host_id" text NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"username" text NOT NULL,
	"uid" integer,
	"gid" integer,
	"home_directory" text,
	"shell" text,
	"account_type" text DEFAULT 'service' NOT NULL,
	"has_login_capability" boolean DEFAULT false NOT NULL,
	"has_running_processes" boolean DEFAULT false NOT NULL,
	"account_locked" boolean DEFAULT false NOT NULL,
	"password_expires_at" timestamp with time zone,
	"password_last_changed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"service_account_id" text,
	"key_type" text DEFAULT 'unknown' NOT NULL,
	"bit_length" integer,
	"fingerprint_sha256" text NOT NULL,
	"comment" text,
	"file_path" text NOT NULL,
	"key_source" text DEFAULT 'authorized_keys' NOT NULL,
	"associated_username" text,
	"status" text DEFAULT 'active' NOT NULL,
	"key_age_seconds" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "domain_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"password_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ldap_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 389 NOT NULL,
	"use_tls" boolean DEFAULT false NOT NULL,
	"use_start_tls" boolean DEFAULT false NOT NULL,
	"tls_certificate" text,
	"base_dn" text NOT NULL,
	"bind_dn" text NOT NULL,
	"bind_password" text NOT NULL,
	"user_search_base" text,
	"user_search_filter" text DEFAULT '(uid={{username}})' NOT NULL,
	"group_search_base" text,
	"group_search_filter" text,
	"username_attribute" text DEFAULT 'uid' NOT NULL,
	"email_attribute" text DEFAULT 'mail' NOT NULL,
	"display_name_attribute" text DEFAULT 'cn' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_login" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "host_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"group_id" text NOT NULL,
	"host_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "host_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_run_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"task_run_id" text NOT NULL,
	"host_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"exit_code" integer,
	"raw_output" text DEFAULT '' NOT NULL,
	"error_message" text,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"triggered_by" text,
	"scheduled_from_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"task_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"max_parallel" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"description" text,
	"task_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"max_parallel" integer DEFAULT 1 NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_task_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "terminal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"username" text,
	"websocket_token_hash" text,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"recording" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminal_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "saved_software_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "software_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"architecture" text,
	"publisher" text,
	"source" text NOT NULL,
	"distro_id" text,
	"distro_version_id" text,
	"distro_codename" text,
	"distro_id_like" jsonb,
	"source_name" text,
	"source_version" text,
	"package_epoch" text,
	"package_release" text,
	"repository" text,
	"origin" text,
	"install_date" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"cve_matches" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "software_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"task_run_host_id" text,
	"status" text NOT NULL,
	"source" text,
	"package_count" integer DEFAULT 0 NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_package_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"current_version" text,
	"available_version" text,
	"architecture" text,
	"repository" text,
	"package_manager" text,
	"status" text DEFAULT 'current' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_patch_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"check_id" text,
	"status" text NOT NULL,
	"last_patched_at" timestamp with time zone,
	"patch_age_days" integer,
	"max_age_days" integer DEFAULT 30 NOT NULL,
	"package_manager" text,
	"updates_supported" boolean DEFAULT false NOT NULL,
	"updates_count" integer DEFAULT 0 NOT NULL,
	"updates_truncated" boolean DEFAULT false NOT NULL,
	"warnings" jsonb,
	"error" text,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_vulnerability_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"software_package_id" text NOT NULL,
	"cve_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"package_name" text NOT NULL,
	"installed_version" text NOT NULL,
	"fixed_version" text,
	"source" text NOT NULL,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"cvss_score" real,
	"known_exploited" boolean DEFAULT false NOT NULL,
	"confidence" text DEFAULT 'confirmed' NOT NULL,
	"match_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vulnerability_cves" (
	"cve_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"cvss_score" real,
	"published_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"rejected" boolean DEFAULT false NOT NULL,
	"known_exploited" boolean DEFAULT false NOT NULL,
	"kev_due_date" timestamp with time zone,
	"kev_vendor_project" text,
	"kev_product" text,
	"kev_required_action" text,
	"source" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_network_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"network_id" text NOT NULL,
	"host_id" text NOT NULL,
	"auto_assigned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"cidr" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "note_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"note_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"note_id" text NOT NULL,
	"editor_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"note_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"tag_selector" jsonb,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"author_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "certificate_authorities" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text,
	"purpose" text NOT NULL,
	"cert_pem" text NOT NULL,
	"key_pem_encrypted" text NOT NULL,
	"source" text NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "certificate_authorities_fingerprint_sha256_unique" UNIQUE("fingerprint_sha256")
);
--> statement-breakpoint
CREATE TABLE "revoked_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"serial" text NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revoked_certificates_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "pending_cert_signings" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"csr_der" "bytea" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_throttles" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lockout_level" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_throttles_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "build_doc_asset_storage_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"provider" text DEFAULT 'filesystem' NOT NULL,
	"config" jsonb DEFAULT '{"provider":"filesystem"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"section_id" text,
	"uploaded_by_id" text NOT NULL,
	"provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_doc_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"editor_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_snippet_id" text,
	"source_snippet_version" integer,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_doc_snippets" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "build_doc_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"author_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"host_name" text,
	"customer_name" text,
	"project_name" text,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(host_name, '')), 'B') || setweight(to_tsvector('english', coalesce(customer_name, '')), 'B') || setweight(to_tsvector('english', coalesce(project_name, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_server_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"hostname" text NOT NULL,
	"process_id" integer NOT NULL,
	"version" text,
	"started_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active_requests" integer DEFAULT 0 NOT NULL,
	"messages_received_total" bigint DEFAULT 0 NOT NULL,
	"queue_depth" integer DEFAULT 0 NOT NULL,
	"queue_capacity" integer DEFAULT 0 NOT NULL,
	"goroutines" integer DEFAULT 0 NOT NULL,
	"heap_alloc_bytes" bigint DEFAULT 0 NOT NULL,
	"heap_sys_bytes" bigint DEFAULT 0 NOT NULL,
	"db_open_connections" integer DEFAULT 0 NOT NULL,
	"db_acquired_connections" integer DEFAULT 0 NOT NULL,
	"gc_pause_total_ns" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ct_cve_service_nonces" (
	"token_id" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ct_cve_service_nonces_pk" PRIMARY KEY("token_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "ct_cve_connector_settings" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"name" text DEFAULT 'Primary CT-CVE' NOT NULL,
	"base_url" text NOT NULL,
	"inventory_token_id" text NOT NULL,
	"inventory_token_secret_encrypted" text NOT NULL,
	"ct_cve_token_id" text NOT NULL,
	"ct_cve_token_secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_hosts" (
	"instance_id" text NOT NULL,
	"event_id" text NOT NULL,
	"host_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_hosts_pk" PRIMARY KEY("event_id","host_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_event_participants" (
	"instance_id" text NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_participants_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"created_by" text,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"category" text DEFAULT 'maintenance' NOT NULL,
	"recurrence_rule" jsonb,
	"series_id" text,
	"recurrence_instance_start_at" timestamp with time zone,
	"exception_type" text,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_credential" ADD CONSTRAINT "totp_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrolment_tokens" ADD CONSTRAINT "agent_enrolment_tokens_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrolment_tokens" ADD CONSTRAINT "agent_enrolment_tokens_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_enrolment_token_id_agent_enrolment_tokens_id_fk" FOREIGN KEY ("enrolment_token_id") REFERENCES "public"."agent_enrolment_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_rules" ADD CONSTRAINT "tag_rules_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_queries" ADD CONSTRAINT "agent_queries_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_queries" ADD CONSTRAINT "agent_queries_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD CONSTRAINT "alert_silences_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD CONSTRAINT "alert_silences_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD CONSTRAINT "alert_silences_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD CONSTRAINT "alert_silences_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_instance_id_alert_instances_id_fk" FOREIGN KEY ("alert_instance_id") REFERENCES "public"."alert_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_discovered_by_host_id_hosts_id_fk" FOREIGN KEY ("discovered_by_host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_ssh_key_id_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_accounts" ADD CONSTRAINT "domain_accounts_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_configurations" ADD CONSTRAINT "ldap_configurations_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_group_members" ADD CONSTRAINT "host_group_members_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_group_members" ADD CONSTRAINT "host_group_members_group_id_host_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."host_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_group_members" ADD CONSTRAINT "host_group_members_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_groups" ADD CONSTRAINT "host_groups_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_run_hosts" ADD CONSTRAINT "task_run_hosts_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_run_hosts" ADD CONSTRAINT "task_run_hosts_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_run_hosts" ADD CONSTRAINT "task_run_hosts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_software_reports" ADD CONSTRAINT "saved_software_reports_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_software_reports" ADD CONSTRAINT "saved_software_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_packages" ADD CONSTRAINT "software_packages_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_packages" ADD CONSTRAINT "software_packages_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_task_run_host_id_task_run_hosts_id_fk" FOREIGN KEY ("task_run_host_id") REFERENCES "public"."task_run_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_package_updates" ADD CONSTRAINT "host_package_updates_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_package_updates" ADD CONSTRAINT "host_package_updates_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vulnerability_findings_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vulnerability_findings_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vulnerability_findings_software_package_id_software_packages_id_fk" FOREIGN KEY ("software_package_id") REFERENCES "public"."software_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vulnerability_findings_cve_id_vulnerability_cves_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."vulnerability_cves"("cve_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_network_memberships" ADD CONSTRAINT "host_network_memberships_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_network_memberships" ADD CONSTRAINT "host_network_memberships_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_network_memberships" ADD CONSTRAINT "host_network_memberships_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_editor_id_user_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_targets" ADD CONSTRAINT "note_targets_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_targets" ADD CONSTRAINT "note_targets_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revoked_certificates" ADD CONSTRAINT "revoked_certificates_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_cert_signings" ADD CONSTRAINT "pending_cert_signings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_asset_storage_settings" ADD CONSTRAINT "build_doc_asset_storage_settings_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_asset_storage_settings" ADD CONSTRAINT "build_doc_asset_storage_settings_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_section_id_build_doc_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."build_doc_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_editor_id_user_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_source_snippet_id_build_doc_snippets_id_fk" FOREIGN KEY ("source_snippet_id") REFERENCES "public"."build_doc_snippets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_template_id_build_doc_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."build_doc_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_templates" ADD CONSTRAINT "build_doc_templates_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_templates" ADD CONSTRAINT "build_doc_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_template_version_id_build_doc_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."build_doc_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ct_cve_connector_settings" ADD CONSTRAINT "ct_cve_connector_settings_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_org_active_deleted_name_email_idx" ON "user" USING btree ("instance_id","is_active","deleted_at","name","email");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_key_value_ci_uidx" ON "tags" USING btree ("instance_id",lower("key"),lower("value"));--> statement-breakpoint
CREATE INDEX "tags_org_key_idx" ON "tags" USING btree ("instance_id","key");--> statement-breakpoint
CREATE INDEX "resource_tags_resource_idx" ON "resource_tags" USING btree ("resource_id","resource_type");--> statement-breakpoint
CREATE INDEX "resource_tags_tag_idx" ON "resource_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_tags_unique_uidx" ON "resource_tags" USING btree ("resource_id","resource_type","tag_id");--> statement-breakpoint
CREATE INDEX "host_metrics_org_host_time_idx" ON "host_metrics" USING btree ("instance_id","host_id","recorded_at");--> statement-breakpoint
CREATE INDEX "check_results_check_idx" ON "check_results" USING btree ("check_id","ran_at");--> statement-breakpoint
CREATE INDEX "check_results_instance_idx" ON "check_results" USING btree ("instance_id","ran_at");--> statement-breakpoint
CREATE INDEX "checks_org_host_idx" ON "checks" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "agent_queries_host_status_idx" ON "agent_queries" USING btree ("host_id","status");--> statement-breakpoint
CREATE INDEX "agent_queries_instance_idx" ON "agent_queries" USING btree ("instance_id","requested_at");--> statement-breakpoint
CREATE INDEX "alert_instances_org_status_idx" ON "alert_instances" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "alert_instances_rule_host_status_idx" ON "alert_instances" USING btree ("rule_id","host_id","status");--> statement-breakpoint
CREATE INDEX "alert_rules_org_host_idx" ON "alert_rules" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "alert_rules_org_enabled_idx" ON "alert_rules" USING btree ("instance_id","enabled");--> statement-breakpoint
CREATE INDEX "alert_rules_org_global_idx" ON "alert_rules" USING btree ("instance_id","is_global_default");--> statement-breakpoint
CREATE INDEX "alert_silences_org_host_idx" ON "alert_silences" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "alert_silences_org_active_idx" ON "alert_silences" USING btree ("instance_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "notification_channels_org_enabled_idx" ON "notification_channels" USING btree ("instance_id","enabled");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "notifications_org_user_idx" ON "notifications" USING btree ("instance_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_deleted_at_idx" ON "notifications" USING btree ("deleted_at") WHERE "notifications"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cert_events_cert_time_idx" ON "certificate_events" USING btree ("certificate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cert_events_org_time_idx" ON "certificate_events" USING btree ("instance_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_identity_idx" ON "certificates" USING btree ("instance_id","host","port","server_name","fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "certificates_org_expiry_idx" ON "certificates" USING btree ("instance_id","not_after");--> statement-breakpoint
CREATE INDEX "certificates_org_status_idx" ON "certificates" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "certificates_org_host_idx" ON "certificates" USING btree ("instance_id","discovered_by_host_id");--> statement-breakpoint
CREATE INDEX "certificates_refresh_due_idx" ON "certificates" USING btree ("tracked_url","last_refreshed_at");--> statement-breakpoint
CREATE INDEX "identity_events_org_time_idx" ON "identity_events" USING btree ("instance_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_account_time_idx" ON "identity_events" USING btree ("service_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_key_time_idx" ON "identity_events" USING btree ("ssh_key_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_host_time_idx" ON "identity_events" USING btree ("host_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_accounts_identity_idx" ON "service_accounts" USING btree ("instance_id","host_id","username");--> statement-breakpoint
CREATE INDEX "service_accounts_org_type_idx" ON "service_accounts" USING btree ("instance_id","account_type");--> statement-breakpoint
CREATE INDEX "service_accounts_org_status_idx" ON "service_accounts" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "service_accounts_org_host_idx" ON "service_accounts" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_keys_identity_idx" ON "ssh_keys" USING btree ("instance_id","host_id","fingerprint_sha256","file_path");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_fingerprint_idx" ON "ssh_keys" USING btree ("instance_id","fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_type_idx" ON "ssh_keys" USING btree ("instance_id","key_type");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_status_idx" ON "ssh_keys" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_host_idx" ON "ssh_keys" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "ssh_keys_account_idx" ON "ssh_keys" USING btree ("service_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_accounts_org_username_idx" ON "domain_accounts" USING btree ("instance_id","username");--> statement-breakpoint
CREATE INDEX "domain_accounts_org_status_idx" ON "domain_accounts" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "task_run_hosts_run_idx" ON "task_run_hosts" USING btree ("task_run_id");--> statement-breakpoint
CREATE INDEX "task_run_hosts_host_status_idx" ON "task_run_hosts" USING btree ("host_id","status");--> statement-breakpoint
CREATE INDEX "task_runs_instance_idx" ON "task_runs" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "task_runs_target_idx" ON "task_runs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "task_runs_scheduled_from_idx" ON "task_runs" USING btree ("scheduled_from_id");--> statement-breakpoint
CREATE INDEX "task_schedules_instance_idx" ON "task_schedules" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "task_schedules_due_idx" ON "task_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "terminal_sessions_org_host_idx" ON "terminal_sessions" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "terminal_sessions_session_id_idx" ON "terminal_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "saved_sw_reports_user_idx" ON "saved_software_reports" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sw_pkg_uniq" ON "software_packages" USING btree ("instance_id","host_id","name","version","architecture");--> statement-breakpoint
CREATE INDEX "sw_pkg_org_name_idx" ON "software_packages" USING btree ("instance_id","name");--> statement-breakpoint
CREATE INDEX "sw_pkg_source_name_idx" ON "software_packages" USING btree ("source","distro_id","distro_codename","source_name");--> statement-breakpoint
CREATE INDEX "sw_pkg_host_idx" ON "software_packages" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "sw_pkg_first_seen_idx" ON "software_packages" USING btree ("instance_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "sw_scan_host_idx" ON "software_scans" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "sw_scan_instance_idx" ON "software_scans" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_package_updates_current_uniq" ON "host_package_updates" USING btree ("instance_id","host_id","name","current_version","available_version","architecture","package_manager");--> statement-breakpoint
CREATE INDEX "host_package_updates_org_status_idx" ON "host_package_updates" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "host_package_updates_host_status_idx" ON "host_package_updates" USING btree ("host_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "host_patch_statuses_check_uniq" ON "host_patch_statuses" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "host_patch_statuses_org_status_idx" ON "host_patch_statuses" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "host_patch_statuses_host_checked_idx" ON "host_patch_statuses" USING btree ("host_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_vuln_findings_uniq" ON "host_vulnerability_findings" USING btree ("instance_id","host_id","software_package_id","cve_id");--> statement-breakpoint
CREATE INDEX "host_vuln_findings_org_status_idx" ON "host_vulnerability_findings" USING btree ("instance_id","status","severity");--> statement-breakpoint
CREATE INDEX "host_vuln_findings_host_status_idx" ON "host_vulnerability_findings" USING btree ("host_id","status");--> statement-breakpoint
CREATE INDEX "host_vuln_findings_cve_idx" ON "host_vulnerability_findings" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "host_vuln_findings_confidence_idx" ON "host_vulnerability_findings" USING btree ("instance_id","status","confidence");--> statement-breakpoint
CREATE INDEX "vulnerability_cves_severity_idx" ON "vulnerability_cves" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "vulnerability_cves_kev_idx" ON "vulnerability_cves" USING btree ("known_exploited");--> statement-breakpoint
CREATE UNIQUE INDEX "host_network_memberships_network_host_uniq" ON "host_network_memberships" USING btree ("network_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_reactions_unique_uidx" ON "note_reactions" USING btree ("note_id","user_id","reaction");--> statement-breakpoint
CREATE INDEX "note_reactions_note_idx" ON "note_reactions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_revisions_note_created_idx" ON "note_revisions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "note_targets_type_id_idx" ON "note_targets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "note_targets_note_idx" ON "note_targets" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_targets_direct_unique_uidx" ON "note_targets" USING btree ("note_id","target_type","target_id") WHERE "note_targets"."target_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_org_active_updated_idx" ON "notes" USING btree ("instance_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "notes_author_idx" ON "notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "notes_search_vector_idx" ON "notes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "cert_authorities_purpose_idx" ON "certificate_authorities" USING btree ("purpose","deleted_at");--> statement-breakpoint
CREATE INDEX "revoked_certs_instance_idx" ON "revoked_certificates" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "pending_cert_signings_requested_at_idx" ON "pending_cert_signings" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_time_idx" ON "audit_events" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_time_idx" ON "audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_asset_storage_settings_org_uidx" ON "build_doc_asset_storage_settings" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "build_doc_assets_doc_idx" ON "build_doc_assets" USING btree ("build_doc_id","deleted_at");--> statement-breakpoint
CREATE INDEX "build_doc_assets_section_idx" ON "build_doc_assets" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_assets_storage_key_uidx" ON "build_doc_assets" USING btree ("provider","storage_key");--> statement-breakpoint
CREATE INDEX "build_doc_revisions_doc_created_idx" ON "build_doc_revisions" USING btree ("build_doc_id","created_at");--> statement-breakpoint
CREATE INDEX "build_doc_sections_doc_position_idx" ON "build_doc_sections" USING btree ("build_doc_id","position");--> statement-breakpoint
CREATE INDEX "build_doc_sections_instance_idx" ON "build_doc_sections" USING btree ("instance_id","deleted_at");--> statement-breakpoint
CREATE INDEX "build_doc_sections_search_vector_idx" ON "build_doc_sections" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "build_doc_snippets_org_updated_idx" ON "build_doc_snippets" USING btree ("instance_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "build_doc_snippets_search_vector_idx" ON "build_doc_snippets" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_template_versions_template_version_uidx" ON "build_doc_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "build_doc_template_versions_instance_idx" ON "build_doc_template_versions" USING btree ("instance_id","template_id");--> statement-breakpoint
CREATE INDEX "build_doc_templates_org_active_idx" ON "build_doc_templates" USING btree ("instance_id","deleted_at","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_templates_default_uidx" ON "build_doc_templates" USING btree ("instance_id","is_default") WHERE "build_doc_templates"."is_default" = TRUE AND "build_doc_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "build_docs_org_updated_idx" ON "build_docs" USING btree ("instance_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "build_docs_template_idx" ON "build_docs" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "build_docs_status_idx" ON "build_docs" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "build_docs_search_vector_idx" ON "build_docs" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "ingest_server_snapshots_server_time_idx" ON "ingest_server_snapshots" USING btree ("server_id","observed_at");--> statement-breakpoint
CREATE INDEX "ingest_server_snapshots_observed_idx" ON "ingest_server_snapshots" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "ct_cve_service_nonces_expires_at_idx" ON "ct_cve_service_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ct_cve_connector_settings_enabled_idx" ON "ct_cve_connector_settings" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "calendar_event_hosts_org_host_idx" ON "calendar_event_hosts" USING btree ("instance_id","host_id");--> statement-breakpoint
CREATE INDEX "calendar_event_participants_org_user_idx" ON "calendar_event_participants" USING btree ("instance_id","user_id");--> statement-breakpoint
CREATE INDEX "calendar_events_org_range_idx" ON "calendar_events" USING btree ("instance_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "calendar_events_org_series_idx" ON "calendar_events" USING btree ("instance_id","series_id","recurrence_instance_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_org_client_request_idx" ON "calendar_events" USING btree ("instance_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_org_series_occurrence_idx" ON "calendar_events" USING btree ("instance_id","series_id","recurrence_instance_start_at") WHERE "calendar_events"."series_id" IS NOT NULL AND "calendar_events"."recurrence_instance_start_at" IS NOT NULL;