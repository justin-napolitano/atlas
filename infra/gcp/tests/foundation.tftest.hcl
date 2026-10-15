mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_service_account" {
    defaults = { email = "synthetic-runtime@example-research-project.iam.gserviceaccount.com" }
  }
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
    condition     = google_sql_database_instance.research.settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY"
    error_message = "Database clients must use encrypted connections."
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
    condition     = length(google_sql_user.iam) == 2 && !contains(keys(google_sql_user.iam), "reader") && !contains(keys(google_sql_user.iam), "worker")
    error_message = "Public readers/workers must not receive a database login in the foundation."
  }
  assert {
    condition     = google_storage_bucket.publications.public_access_prevention == "enforced"
    error_message = "A publication runtime may read curated objects; the bucket itself is not anonymous."
  }
  assert {
    condition     = google_storage_bucket_iam_member.reader.role == "roles/storage.objectViewer"
    error_message = "The public viewer cannot write publication objects."
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
