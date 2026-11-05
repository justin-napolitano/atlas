# Null release input creates no owner service, IAP API, service agent or IAM grant.
locals {
  owner_service_name = "${var.prefix}-owner"
  sql_proxy_image    = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.26.2@sha256:e8c76356fb586300c63f0d29c8c75cfeeba33c29736f9d4afa2df2d78cd0fa19"
}
resource "google_project_service" "owner_iap" {
  count              = var.owner_release == null ? 0 : 1
  project            = var.project_id
  service            = "iap.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service_identity" "owner_iap" {
  count      = var.owner_release == null ? 0 : 1
  provider   = google-beta
  project    = var.project_id
  service    = "iap.googleapis.com"
  depends_on = [google_project_service.owner_iap]
}
resource "google_project_service_identity" "owner_run" {
  count      = var.owner_release == null ? 0 : 1
  provider   = google-beta
  project    = var.project_id
  service    = "run.googleapis.com"
  depends_on = [google_project_service.required]
}
resource "google_kms_crypto_key_iam_member" "owner_run" {
  count         = var.owner_release == null ? 0 : 1
  crypto_key_id = google_kms_crypto_key.images.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_project_service_identity.owner_run[0].member
}
resource "google_cloud_run_v2_service" "owner" {
  count                = var.owner_release == null ? 0 : 1
  project              = var.project_id
  name                 = local.owner_service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  iap_enabled          = true
  invoker_iam_disabled = false
  deletion_protection  = true
  labels               = { application = "research", visibility = "private-owner" }
  scaling {
    min_instance_count = 0
    max_instance_count = 1
  }
  template {
    service_account                  = google_service_account.runtime["owner-api"].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    encryption_key                   = google_kms_crypto_key.images.id
    timeout                          = "30s"
    max_instance_request_concurrency = 8
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.research.name
        subnetwork = google_compute_subnetwork.runtime.name
        tags       = ["research-owner"]
      }
    }
    containers {
      name       = "owner"
      image      = var.owner_release.image
      depends_on = ["sql-proxy"]
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      env {
        name  = "RESEARCH_MODE"
        value = "owner"
      }
      env {
        name  = "RESEARCH_DATABASE_URL"
        value = "host=127.0.0.1 port=5432 dbname=research user=${google_sql_user.iam["owner-api"].name} sslmode=disable connect_timeout=5"
      }
      env {
        name  = "RESEARCH_OWNER_SUBJECT"
        value = var.owner_release.owner_subject
      }
      env {
        name  = "RESEARCH_OWNER_ORIGIN"
        value = var.owner_release.origin
      }
      env {
        name  = "RESEARCH_IAP_AUDIENCE"
        value = "/projects/${data.google_project.current.number}/locations/${var.region}/services/${local.owner_service_name}"
      }
      env {
        name  = "RESEARCH_VERSION"
        value = var.owner_release.source_commit
      }
      startup_probe {
        timeout_seconds   = 2
        period_seconds    = 5
        failure_threshold = 24
        http_get {
          path = "/health/ready"
          port = 8080
        }
      }
      liveness_probe {
        timeout_seconds   = 2
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/health/live"
          port = 8080
        }
      }
    }
    containers {
      name  = "sql-proxy"
      image = local.sql_proxy_image
      args = ["--auto-iam-authn", "--private-ip", "--address=127.0.0.1", "--port=5432", "--quiet",
      "--max-connections=16", google_sql_database_instance.research.connection_name]
      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      startup_probe {
        timeout_seconds   = 1
        period_seconds    = 2
        failure_threshold = 30
        tcp_socket { port = 5432 }
      }
    }
  }
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
  depends_on = [google_kms_crypto_key_iam_member.owner_run]
}
# IAP alone invokes the origin. The app independently verifies its signed token.
resource "google_cloud_run_v2_service_iam_member" "owner_iap_invoker" {
  count    = var.owner_release == null ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.owner[0].name
  role     = "roles/run.invoker"
  member   = google_project_service_identity.owner_iap[0].member
}
resource "google_iap_web_cloud_run_service_iam_binding" "sole_owner" {
  count                  = var.owner_release == null ? 0 : 1
  project                = var.project_id
  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.owner[0].name
  role                   = "roles/iap.httpsResourceAccessor"
  members                = ["user:${var.owner_release.owner_email}"]
}
