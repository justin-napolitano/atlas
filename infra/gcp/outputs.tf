output "database_connection_name" {
  value       = google_sql_database_instance.research.connection_name
  description = "Use a supported Cloud SQL connector with private IP and IAM authentication."
}

output "database_name" { value = google_sql_database.research.name }
output "network_id" { value = google_compute_network.research.id }
output "runtime_subnet_id" { value = google_compute_subnetwork.runtime.id }
output "publication_bucket" { value = google_storage_bucket.publications.name }
output "image_repository" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}" }
output "runtime_identities" { value = { for key, account in google_service_account.runtime : key => account.email } }
