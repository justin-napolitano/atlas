mock_provider "google" {
  override_during = plan
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_service_account" {
    defaults = { email = "synthetic-runtime@example-research-project.iam.gserviceaccount.com" }
  }
  mock_resource "google_kms_key_ring" {
    defaults = { id = "projects/example-research-project/locations/us-central1/keyRings/research-images" }
  }
  mock_resource "google_kms_crypto_key" {
    defaults = { id = "projects/example-research-project/locations/us-central1/keyRings/research-images/cryptoKeys/images" }
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

run "no_runtime_without_verified_release_input" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_service.public) == 0 && length(google_cloud_run_v2_service_iam_member.anonymous_public) == 0
    error_message = "The default foundation must not deploy a runtime or enable anonymous access."
  }
  assert {
    condition     = length(google_project_service_identity.public_run) == 0 && length(google_kms_crypto_key_iam_member.public_run) == 0
    error_message = "Disabled runtime must not add its service agent or key grants."
  }
}

run "private_candidate_uses_only_scanned_digest_and_reader_identity" {
  command = plan
  variables {
    public_release = {
      image      = "us-central1-docker.pkg.dev/example-research-project/research/public@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      build_id   = "build-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      release_id = "release-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }
  assert {
    condition     = length(google_cloud_run_v2_service.public) == 1 && length(google_cloud_run_v2_service_iam_member.anonymous_public) == 0 && !google_cloud_run_v2_service.public[0].invoker_iam_disabled
    error_message = "A candidate stays authenticated until anonymous publication is explicitly selected."
  }
  assert {
    condition     = google_cloud_run_v2_service.public[0].template[0].service_account == google_service_account.runtime["reader"].email
    error_message = "Public runtime cannot use owner, publisher, migrator or default compute credentials."
  }
  assert {
    condition     = length(google_cloud_run_v2_service.public[0].template[0].volumes) == 0 && length(google_cloud_run_v2_service.public[0].template[0].vpc_access) == 0 && length(google_cloud_run_v2_service.public[0].template[0].containers[0].env) == 0 && length(google_cloud_run_v2_service.public[0].template[0].containers[0].volume_mounts) == 0
    error_message = "Public runtime must contain no SQL/VPC mount, secret or application credential injection."
  }
  assert {
    condition     = google_cloud_run_v2_service.public[0].template[0].containers[0].image == var.public_release.image && google_cloud_run_v2_service.public[0].template[0].encryption_key == google_kms_crypto_key.images.id
    error_message = "The reviewed immutable image and image encryption key must remain bound to the revision."
  }
}

run "public_runtime_cost_and_health_contract" {
  command = plan
  variables {
    public_release = {
      image      = "us-central1-docker.pkg.dev/example-research-project/research/public@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      build_id   = "build-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      release_id = "release-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      anonymous  = true
    }
  }
  assert {
    condition     = google_cloud_run_v2_service.public[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.public[0].scaling[0].max_instance_count == 1 && google_cloud_run_v2_service.public[0].template[0].max_instance_request_concurrency == 16 && google_cloud_run_v2_service.public[0].template[0].timeout == "30s"
    error_message = "Public runtime must retain scale-to-zero and bounded concurrency/timeout."
  }
  assert {
    condition     = google_cloud_run_v2_service.public[0].template[0].containers[0].resources[0].limits == tomap({ cpu = "1", memory = "256Mi" }) && google_cloud_run_v2_service.public[0].template[0].containers[0].resources[0].cpu_idle && !google_cloud_run_v2_service.public[0].template[0].containers[0].resources[0].startup_cpu_boost
    error_message = "Public runtime must keep its reviewed initial compute profile."
  }
  assert {
    condition     = google_cloud_run_v2_service.public[0].template[0].containers[0].startup_probe[0].http_get[0].path == "/health/ready" && google_cloud_run_v2_service.public[0].template[0].containers[0].liveness_probe[0].http_get[0].path == "/health/live"
    error_message = "Cloud Run must use explicit runtime health routes."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.anonymous_public[0].member == "allUsers" && google_cloud_run_v2_service_iam_member.anonymous_public[0].role == "roles/run.invoker" && google_cloud_run_v2_service_iam_member.anonymous_public[0].name == google_cloud_run_v2_service.public[0].name && !google_cloud_run_v2_service.public[0].invoker_iam_disabled
    error_message = "Explicit anonymous access may target only the public read-only service and cannot disable IAM checks."
  }
}

run "mutable_public_image_is_rejected" {
  command = plan
  variables {
    public_release = {
      image      = "us-central1-docker.pkg.dev/example-research-project/research/public:latest"
      build_id   = "build-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      release_id = "release-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }
  expect_failures = [var.public_release]
}

run "foreign_repository_is_rejected" {
  command = plan
  variables {
    public_release = {
      image      = "us-central1-docker.pkg.dev/example-research-project/research/owner-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      build_id   = "build-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      release_id = "release-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }
  expect_failures = [var.public_release]
}
