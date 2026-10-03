project_id  = "onorca-cloud"
environment = "production"
name_prefix = "orca-cloud"
region      = "us-central1"

artifact_repository_id = "orca-cloud"

# The Push workflow lives in stablyai/orca with the `cloud-` file prefix.
# github_owner and github_owner_id keep their defaults.
github_repo                 = "orca"
github_repo_id              = "1183888342"
github_workflow_file_prefix = "cloud-"

# Mobile push gateway. Production is the only environment that runs one; the runtime account,
# the three Apple secrets, and their accessor bindings already exist and are imported once
# (see docs/push-gateway.md).
push_gateway_enabled = true
push_base_url        = "https://push.onorca.dev"
# Dedicated push pools allow three revision resources during validation and recovery.
push_max_instances         = 2
push_database_pool_max     = 6
manage_push_domain_mapping = true
