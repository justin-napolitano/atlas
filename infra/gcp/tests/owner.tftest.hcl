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


run "owner_default_disabled" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_service.owner) == 0 && length(google_project_service.owner_iap) == 0 && length(google_iap_web_cloud_run_service_iam_binding.sole_owner) == 0
    error_message = "Default must not create owner runtime or IAP resources."
  }
}
run "owner_is_iap_only_with_private_iam_sql" {
  command = plan
  variables {
    owner_release = {
      image         = "us-central1-docker.pkg.dev/example-research-project/research/owner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      source_commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      owner_subject = "synthetic-owner-subject"
      owner_email   = "synthetic@example.invalid"
      origin        = "https://owner.example.invalid"
    }
  }
  assert {
    condition     = google_cloud_run_v2_service.owner[0].iap_enabled && !google_cloud_run_v2_service.owner[0].invoker_iam_disabled && google_cloud_run_v2_service.owner[0].deletion_protection
    error_message = "Owner ingress must require IAP and retain IAM/deletion checks."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.owner_iap_invoker[0].member == google_project_service_identity.owner_iap[0].member && google_iap_web_cloud_run_service_iam_binding.sole_owner[0].members == toset(["user:synthetic@example.invalid"])
    error_message = "Only the IAP service agent invokes; one user receives IAP access."
  }
  assert {
    condition     = google_cloud_run_v2_service.owner[0].template[0].service_account == google_service_account.runtime["owner-api"].email && google_cloud_run_v2_service.owner[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY" && length(google_cloud_run_v2_service.owner[0].template[0].containers) == 2
    error_message = "Use owner identity and private-network IAM SQL proxy."
  }
  assert {
    condition     = google_cloud_run_v2_service.owner[0].scaling[0].max_instance_count == 1 && google_cloud_run_v2_service.owner[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.owner[0].template[0].max_instance_request_concurrency == 8
    error_message = "Retain bounded scale-to-zero owner capacity."
  }
}
run "mutable_owner_image_rejected" {
  command = plan
  variables {
    owner_release = {
      image         = "us-central1-docker.pkg.dev/example-research-project/research/owner:latest"
      source_commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      owner_subject = "synthetic-owner-subject"
      owner_email   = "synthetic@example.invalid"
      origin        = "https://owner.example.invalid"
    }
  }
  expect_failures = [var.owner_release]
}
