mock_provider "google" {
  override_during = plan
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_service_account" {
    defaults = { email = "synthetic-runtime@example-research-project.iam.gserviceaccount.com" }
  }
  mock_resource "google_kms_key_ring" {
    override_during = plan
    defaults        = { id = "projects/example-research-project/locations/us-central1/keyRings/research-images" }
  }
  mock_resource "google_kms_crypto_key" {
    override_during = plan
    defaults        = { id = "projects/example-research-project/locations/us-central1/keyRings/research-images/cryptoKeys/images" }
  }
}
mock_provider "google-beta" {
  override_during = plan
  mock_resource "google_project_service_identity" {
    defaults = { member = "serviceAccount:service-123456789012@gcp-sa-artifactregistry.iam.gserviceaccount.com" }
  }
}

override_resource {
  target          = google_service_account.runtime["reader"]
  values          = { email = "research-reader@example-research-project.iam.gserviceaccount.com" }
  override_during = plan
}

variables {
  project_id         = "example-research-project"
  billing_account_id = "000000-000000-000000"
}

run "private_database_and_backup_contract" {
  command = plan
  assert {
    condition     = google_sql_database_instance.research.settings[0].ip_configuration[0].ipv4_enabled == false
    error_message = "The database must not expose a public IP."
  }
  assert {
    condition     = google_sql_database_instance.research.settings[0].ip_configuration[0].ssl_mode == "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    error_message = "Database clients must use TLS with trusted client certificates."
  }
  assert {
    condition     = google_sql_database_instance.research.settings[0].backup_configuration[0].point_in_time_recovery_enabled
    error_message = "Point-in-time recovery must remain enabled."
  }
  assert {
    condition     = google_sql_database_instance.research.deletion_protection && google_sql_database_instance.research.settings[0].deletion_protection_enabled
    error_message = "Both Terraform and API deletion protection must default to enabled."
  }
}

run "public_reader_has_no_database_identity" {
  command = plan
  assert {
    condition     = length(google_sql_user.iam) == 3 && !contains(keys(google_sql_user.iam), "reader") && !contains(keys(google_sql_user.iam), "worker")
    error_message = "Public readers/workers must not receive a database login in the foundation."
  }
  assert {
    condition     = contains(keys(google_sql_user.iam), "publisher")
    error_message = "Only the publisher build identity may read approved SQL snapshots for public images."
  }
  assert {
    condition     = alltrue([for binding in google_project_iam_member.sql_connect : binding.member != "serviceAccount:${google_service_account.runtime["reader"].email}"])
    error_message = "The public runtime cannot connect to authoring storage."
  }
}

run "cost_and_capacity_limits" {
  command = plan
  assert {
    condition     = google_sql_database_instance.research.settings[0].disk_autoresize_limit == 20 && google_sql_database_instance.research.settings[0].availability_type == "ZONAL"
    error_message = "The initial deployment must keep its explicit storage/availability tradeoff."
  }
  assert {
    condition     = length(google_billing_budget.research.threshold_rules) == 3
    error_message = "Billing requires the reviewed alert thresholds."
  }
}

run "unreviewed_database_tier_is_rejected" {
  command = plan
  variables { database_tier = "db-custom-64-262144" }
  expect_failures = [var.database_tier]
}

run "operational_logging_and_redaction_contract" {
  command = plan
  assert {
    condition = alltrue([
      for name, value in { log_statement  = "ddl", log_min_duration_statement = "-1", log_parameter_max_length = "0",
        log_parameter_max_length_on_error = "0", log_error_verbosity = "terse", "cloudsql.pgaudit_mask_literals" = "on",
      "pgaudit.log" = "ddl,role", "pgaudit.log_parameter" = "off" } :
      contains([for flag in google_sql_database_instance.research.settings[0].database_flags : "${flag.name}=${flag.value}"], "${name}=${value}")
    ])
    error_message = "SQL operations must retain parameter redaction, terse errors, and DDL/role-only auditing."
  }
  assert {
    condition     = google_compute_subnetwork.runtime.log_config[0].flow_sampling == 0.1 && google_compute_firewall.deny_ingress.direction == "INGRESS"
    error_message = "Network flow logging and explicit default-deny ingress must remain configured."
  }
}

run "immutable_encrypted_images" {
  command = plan
  assert {
    condition     = google_artifact_registry_repository.images.kms_key_name == google_kms_crypto_key.images.id && google_artifact_registry_repository.images.docker_config[0].immutable_tags
    error_message = "Public release images must retain their CMEK and immutable tags."
  }
  assert {
    condition     = google_kms_crypto_key_iam_member.artifact_registry.role == "roles/cloudkms.cryptoKeyEncrypterDecrypter" && google_kms_crypto_key_iam_member.artifact_registry.crypto_key_id == google_kms_crypto_key.images.id
    error_message = "Only the Artifact Registry service agent receives encryption use on this image key."
  }
}
