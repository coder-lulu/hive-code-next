// Shared cloud values required by the Push gateway.
locals {
  cloud_shared_labels = {
    app         = "orca-cloud"
    environment = var.environment
    managed_by  = "terraform"
  }

  cloud_github_repository = "${var.github_owner}/${var.github_repo}"
  cloud_github_repository_claims = [
    "assertion.repository == '${local.cloud_github_repository}'",
    "assertion.repository_id == '${var.github_repo_id}'",
    "assertion.repository_owner_id == '${var.github_owner_id}'",
  ]
  cloud_github_accepted_repositories = concat([{
    owner                = var.github_owner
    repo                 = var.github_repo
    repo_id              = var.github_repo_id
    owner_id             = var.github_owner_id
    workflow_file_prefix = var.github_workflow_file_prefix
  }], var.github_accepted_repositories)
  cloud_github_single_repository = length(local.cloud_github_accepted_repositories) == 1
  cloud_github_workflow_ref_prefixes = [
    for repository in local.cloud_github_accepted_repositories :
    "${repository.owner}/${repository.repo}/.github/workflows/${repository.workflow_file_prefix}"
  ]
  cloud_github_accepted_repository_claims = [
    for repository in local.cloud_github_accepted_repositories :
    join(" && ", [
      "assertion.repository == '${repository.owner}/${repository.repo}'",
      "assertion.repository_id == '${repository.repo_id}'",
      "assertion.repository_owner_id == '${repository.owner_id}'"
    ])
  ]
  cloud_github_leading_repository_claims = (
    local.cloud_github_single_repository ? local.cloud_github_repository_claims : []
  )
  cloud_create_production_ops_identity = (
    var.github_owner != "" && var.github_repo != "" && var.environment == "production"
  )
  cloud_workload_identity_pool_id   = "${var.name_prefix}-github"
  cloud_workload_identity_pool_name = "projects/${data.google_project.cloud.number}/locations/global/workloadIdentityPools/${local.cloud_workload_identity_pool_id}"
}

data "google_project" "cloud" {
  project_id = var.project_id
}

data "google_artifact_registry_repository" "cloud_images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
}
