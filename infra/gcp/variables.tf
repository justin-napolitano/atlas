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
