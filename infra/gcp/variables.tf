variable "project_id" {
  type        = string
  description = "Existing GCP project. No project or billing account is created implicitly."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use an existing Google Cloud project ID."
  }
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "Review data location and all regional prices before provisioning."
  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "Use a Google Cloud region name such as us-central1."
  }
}

variable "prefix" {
  type    = string
  default = "research"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,15}$", var.prefix))
    error_message = "Use a lowercase 3–16 character resource prefix."
  }
}

variable "database_tier" {
  type        = string
  default     = "db-f1-micro"
  description = "Initial low-cost shared-core tier; no Cloud SQL SLA. Review memory limits before launch."
  validation {
    condition     = contains(["db-f1-micro", "db-g1-small"], var.database_tier)
    error_message = "Select one of the reviewed small-instance profiles. A larger tier requires a cost/config review."
  }
}

variable "billing_account_id" {
  type        = string
  description = "Billing account for budget alerts; injected through private environment configuration."
  validation {
    condition     = can(regex("^[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}$", var.billing_account_id))
    error_message = "Use the billing account linked to the target project."
  }
}

variable "monthly_budget_usd" {
  type        = number
  default     = 25
  description = "Alert threshold, not a spending cap. Adjust after reviewing the cost worksheet."
  validation {
    condition     = var.monthly_budget_usd >= 10 && var.monthly_budget_usd <= 100
    error_message = "Review a monthly alert budget between USD 10 and 100 for this initial profile."
  }
}

variable "database_deletion_protection" {
  type        = bool
  default     = true
  description = "Disable only as an explicitly reviewed teardown step after a verified backup."
}

variable "subnet_cidr" {
  type    = string
  default = "10.81.0.0/24"
}

variable "public_release" {
  description = "Null creates no runtime. Supply a verified/scanned immutable public image only after plan/security/cost review. Anonymous visibility is a separate explicit choice."
  type = object({
    image      = string
    build_id   = string
    release_id = string
    anonymous  = optional(bool, false)
  })
  default = null
  validation {
    condition = var.public_release == null ? true : (
      can(regex("^${var.region}-docker\\.pkg\\.dev/${var.project_id}/${var.prefix}/public@sha256:[a-f0-9]{64}$", var.public_release.image)) &&
      can(regex("^build-[a-f0-9]{64}$", var.public_release.build_id)) &&
      can(regex("^release-[a-f0-9]{64}$", var.public_release.release_id))
    )
    error_message = "Public releases require the dedicated regional public image path pinned by digest and complete verified build/release IDs; mutable tags or other repositories are refused."
  }
}

variable "owner_release" {
  description = "Null creates no owner runtime. Requires reviewed image and one exact IAP owner. Personal projects require one-time Console OAuth setup."
  type = object({
    image         = string
    source_commit = string
    owner_subject = string
    owner_email   = string
    origin        = string
  })
  default = null
  validation {
    condition = var.owner_release == null ? true : (
      can(regex("^${var.region}-docker\\.pkg\\.dev/${var.project_id}/${var.prefix}/owner@sha256:[a-f0-9]{64}$", var.owner_release.image)) &&
      can(regex("^[a-f0-9]{40}$", var.owner_release.source_commit)) &&
      can(regex("^[^[:space:][:cntrl:]]{1,500}$", var.owner_release.owner_subject)) &&
      can(regex("^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.owner_release.owner_email)) &&
      can(regex("^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?$", var.owner_release.origin))
    )
    error_message = "Use an immutable dedicated owner image, full commit, stable verified subject, one user email, and exact HTTPS origin without a path."
  }
}
