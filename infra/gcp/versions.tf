terraform {
  required_version = "= 1.16.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "= 8.7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
