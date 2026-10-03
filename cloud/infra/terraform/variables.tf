variable "artifact_repository_id" {
  type        = string
  description = "Artifact Registry Docker repository ID."
}

variable "environment" {
  type        = string
  description = "Deployment environment."

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "github_owner" {
  type        = string
  description = "GitHub owner allowed to deploy through Workload Identity Federation."
  default     = "stablyai"
}

variable "github_repo" {
  type        = string
  description = "GitHub repo allowed to deploy through Workload Identity Federation."
  default     = "orca"
}

# Numeric IDs survive a rename or transfer of the repository; every provider pins them next to the name.
variable "github_repo_id" {
  type        = string
  description = "Numeric GitHub repository ID of github_owner/github_repo."
  default     = "1183888342"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repo_id))
    error_message = "github_repo_id must be the numeric repository ID."
  }
}

variable "github_owner_id" {
  type        = string
  description = "Numeric GitHub owner ID of github_owner."
  default     = "127256420"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id must be the numeric owner ID."
  }
}

# Workflow filenames use the `cloud-` prefix in the public repository.
variable "github_workflow_file_prefix" {
  type        = string
  description = "Filename prefix on github_owner/github_repo's Cloud workflows."
  default     = "cloud-"

  validation {
    condition     = can(regex("^[a-z0-9-]*$", var.github_workflow_file_prefix))
    error_message = "github_workflow_file_prefix must be lowercase letters, digits, or hyphens."
  }
}

# Additional repositories whose identical workflows the same identities must accept during a
# repository move. Each entry renders its own OR arm in every provider condition, so both repos
# can run the same workflows through the same identities. `workflow_file_prefix` is the rename the
# importing repository applies to the workflow files it copies. Empty is the steady state, and is
# where the public extraction left it: stablyai/orca is now the primary and only repository.
variable "github_accepted_repositories" {
  type = list(object({
    owner                = string
    repo                 = string
    repo_id              = string
    owner_id             = string
    workflow_file_prefix = string
  }))
  description = "Extra repositories accepted alongside github_owner/github_repo during the public extraction."
  default     = []

  validation {
    condition = alltrue([
      for repository in var.github_accepted_repositories :
      can(regex("^[0-9]+$", repository.repo_id)) && can(regex("^[0-9]+$", repository.owner_id))
    ])
    error_message = "github_accepted_repositories entries must carry numeric repo_id and owner_id values."
  }

  validation {
    condition = alltrue([
      for repository in var.github_accepted_repositories :
      can(regex("^[a-z0-9-]*$", repository.workflow_file_prefix))
    ])
    error_message = "github_accepted_repositories workflow_file_prefix must be lowercase letters, digits, or hyphens."
  }
}

variable "name_prefix" {
  type        = string
  description = "Prefix used for named resources."
}

variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "GCP region for regional resources."
  default     = "us-central1"
}

variable "push_gateway_enabled" {
  type        = bool
  description = "Create the Orca mobile push gateway, its database, secrets, and identity."
  default     = false
}

variable "push_base_url" {
  type        = string
  description = "Public TLS origin of the mobile push gateway."
  default     = "https://push.onorca.dev"

  validation {
    condition     = can(regex("^https://[^/]+$", var.push_base_url))
    error_message = "push_base_url must be an HTTPS origin with no path."
  }
}

variable "push_cloud_run_service_name" {
  type        = string
  description = "Cloud Run service name for the mobile push gateway."
  default     = "orca-cloud-push"
}

variable "push_cloud_run_image" {
  type        = string
  description = "Initial image for the Terraform-created push gateway service; deploys own it after."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "push_cloud_run_cpu" {
  type        = string
  description = "CPU limit for the push gateway container."
  default     = "1"
}

variable "push_cloud_run_memory" {
  type        = string
  description = "Memory limit for the push gateway container."
  default     = "512Mi"
}

# Keep a warm instance to run durable delivery retries without incoming requests.
variable "push_min_instances" {
  type        = number
  description = "Minimum instances for the push gateway."
  default     = 1
}

variable "push_max_instances" {
  type        = number
  description = "Maximum instances for the push gateway."
  default     = 4

  validation {
    condition     = var.push_max_instances >= 1
    error_message = "The push gateway needs at least one instance."
  }
}

# The dedicated database budget counts pools across all three rollout revision resources.
variable "push_database_pool_max" {
  type        = number
  description = "Push gateway database pool size per instance; instances x pool is its Cloud SQL draw."
  default     = 2

  validation {
    condition     = var.push_database_pool_max >= 1 && var.push_database_pool_max <= 100
    error_message = "The push gateway pool must hold at least one connection and stay under the per-service bound."
  }
}

variable "push_concurrency" {
  type        = number
  description = "Cloud Run concurrency for short-lived push gateway HTTP requests."
  default     = 80
}

variable "push_request_timeout_seconds" {
  type        = number
  description = "Cloud Run timeout for push gateway requests; every route is short-lived."
  default     = 30
}

variable "manage_push_domain_mapping" {
  type        = bool
  description = "Manage the push gateway Cloud Run domain mapping; the DNS record stays in the apps root."
  default     = false
}
