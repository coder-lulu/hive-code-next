project_id  = "onorca-cloud-staging"
environment = "staging"
name_prefix = "orca-cloud-staging"
region      = "us-central1"

artifact_repository_id = "orca-cloud"

# The Push workflow lives in stablyai/orca with the `cloud-` file prefix.
# github_owner and github_owner_id keep their defaults.
github_repo                 = "orca"
github_repo_id              = "1183888342"
github_workflow_file_prefix = "cloud-"

# Push is currently provisioned only in production.
push_gateway_enabled = false
