# Cloud Terraform

This root now declares the Push gateway and its dedicated database. HiveRelay runs from the HiveCloud and `hive-relay-cell` repositories; this root does not deploy an Orca Relay service.

The `production.tfvars` file keeps the Push gateway enabled. `staging.tfvars` keeps it disabled. The Push deployment identity is bound to the exact `cloud-push-deploy.yml` workflow and the accepted repository claims. `push-shared.tf` contains only values used by Push.

Existing Orca Relay resources may still be present in the remote Terraform state. Removing their declarations from this repository is a source change, not a cloud teardown. Any plan against that state must be reviewed as a separate decommission operation before apply. Do not use an ordinary Push deployment to destroy or migrate Relay resources.

See [Push gateway operations](../../docs/push-gateway.md) for service, database, and credential details.