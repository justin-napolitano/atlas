locals {
  services = toset([
    "compute.googleapis.com", "servicenetworking.googleapis.com", "sqladmin.googleapis.com",
    "run.googleapis.com", "artifactregistry.googleapis.com", "storage.googleapis.com",
    "iam.googleapis.com", "iamcredentials.googleapis.com", "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com"
  ])
  identities = toset(["owner-api", "migrator", "publisher", "reader", "worker"])
}

resource "google_project_service" "required" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_service_account" "runtime" {
  for_each     = local.identities
  account_id   = "${var.prefix}-${each.value}"
  display_name = "Research ${each.value}; no user-managed keys"
  depends_on   = [google_project_service.required]
}

resource "google_compute_network" "research" {
  name                    = var.prefix
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "runtime" {
  name                     = "${var.prefix}-runtime"
  ip_cidr_range            = var.subnet_cidr
  region                   = var.region
  network                  = google_compute_network.research.id
  private_ip_google_access = true
}

resource "google_compute_global_address" "database" {
  name          = "${var.prefix}-sql-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.research.id
}

resource "google_service_networking_connection" "database" {
  network                 = google_compute_network.research.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.database.name]
}

resource "google_sql_database_instance" "research" {
  name                = "${var.prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = var.database_deletion_protection
  depends_on          = [google_service_networking_connection.database]

  settings {
    tier                        = var.database_tier
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    disk_autoresize_limit       = 20
    deletion_protection_enabled = var.database_deletion_protection
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.research.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
    backup_configuration {
      enabled                        = true
      start_time                     = "03:30"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
    maintenance_window {
      day  = 7
      hour = 8
    }
    user_labels = { application = "research", environment = "initial" }
  }
}

resource "google_sql_database" "research" {
  name     = "research"
  instance = google_sql_database_instance.research.name
}

# IAM connection permission is not SQL table permission. Role bootstrap follows
# the owner-auth slice; the public reader/worker receive no database identity here.
resource "google_project_iam_member" "sql_connect" {
  for_each = {
    for pair in setproduct(["owner-api", "migrator"], ["roles/cloudsql.client", "roles/cloudsql.instanceUser"]) :
    "${pair[0]}-${pair[1]}" => { identity = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.runtime[each.value.identity].email}"
}

resource "google_sql_user" "iam" {
  for_each = toset(["owner-api", "migrator"])
  name     = trimsuffix(google_service_account.runtime[each.value].email, ".gserviceaccount.com")
  instance = google_sql_database_instance.research.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_artifact_registry_repository" "images" {
  repository_id = var.prefix
  location      = var.region
  format        = "DOCKER"
  description   = "Immutable research application release images"
  depends_on    = [google_project_service.required]
}

resource "google_storage_bucket" "publications" {
  name                        = "${var.project_id}-${var.prefix}-publications"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle_rule {
    action { type = "Delete" }
    condition {
      with_state                 = "ARCHIVED"
      days_since_noncurrent_time = 30
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "reader" {
  bucket = google_storage_bucket.publications.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime["reader"].email}"
}

resource "google_storage_bucket_iam_member" "publisher" {
  bucket = google_storage_bucket.publications.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime["publisher"].email}"
}

resource "google_billing_budget" "research" {
  billing_account = var.billing_account_id
  display_name    = "Research monthly alert; not a spending cap"
  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(floor(var.monthly_budget_usd))
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  depends_on = [google_project_service.required]
}
