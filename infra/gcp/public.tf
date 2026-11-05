# Disabled by default. These resources do not execute a build, scan, image push,
# source-head freshness check or approval. Inspect a complete credentialed plan
# and required security/cost evidence before any separately authorized apply.
locals {
  public_service_name = "${var.prefix}-public"
}

resource "google_project_service_identity" "public_run" {
  count      = var.public_release == null ? 0 : 1
  provider   = google-beta
  project    = var.project_id
  service    = "run.googleapis.com"
  depends_on = [google_project_service.required]
}

# This is the Google-managed control-plane service agent, not the anonymous
# runtime's service account. Runtime readers still receive no KMS/SQL grants.
resource "google_kms_crypto_key_iam_member" "public_run" {
  count         = var.public_release == null ? 0 : 1
  crypto_key_id = google_kms_crypto_key.images.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_project_service_identity.public_run[0].member
}

resource "google_cloud_run_v2_service" "public" {
  count                = var.public_release == null ? 0 : 1
  project              = var.project_id
  name                 = local.public_service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  deletion_protection  = true
  invoker_iam_disabled = false
  labels               = { application = "research", visibility = "approved-public" }

  scaling {
    min_instance_count = 0
    max_instance_count = 1
  }

  template {
    service_account                  = google_service_account.runtime["reader"].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    encryption_key                   = google_kms_crypto_key.images.id
    timeout                          = "30s"
    max_instance_request_concurrency = 16
    labels = {
      build   = substr(var.public_release.build_id, 6, 40)
      release = substr(var.public_release.release_id, 8, 40)
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.public_release.image
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 1
        period_seconds        = 3
        failure_threshold     = 20
        http_get {
          path = "/health/ready"
          port = 8080
        }
      }
      liveness_probe {
        timeout_seconds   = 1
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/health/live"
          port = 8080
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
  depends_on = [google_kms_crypto_key_iam_member.public_run]
}

# Explicit public read-only product requirement. The IAM check itself remains
# enabled; only this public service may get anonymous invoker membership.
resource "google_cloud_run_v2_service_iam_member" "anonymous_public" {
  count      = var.public_release == null ? 0 : (var.public_release.anonymous ? 1 : 0)
  project    = var.project_id
  location   = var.region
  name       = local.public_service_name
  role       = "roles/run.invoker"
  member     = "allUsers"
  depends_on = [google_cloud_run_v2_service.public]
}
