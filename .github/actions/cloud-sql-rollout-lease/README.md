# Cloud SQL rollout lease

This action holds a compare-and-swap lease on one Cloud Storage object while a Cloud Run
revision starts and opens its Cloud SQL connection pool. The Push deployment workflow uses it to
serialize candidate startup, health checks, and traffic shift. Its GitHub concurrency group also
prevents overlapping Push deployments in this repository.

## Push deployment

The lease step runs after `google-github-actions/auth` and `setup-gcloud`, and after checkout so
the local action is available. Building and publishing the image happens before lease acquisition;
the image build does not draw Cloud SQL connections. The workflow holds the lease across the
candidate deployment and traffic shift:

```yaml
- uses: ./.github/actions/cloud-sql-rollout-lease
  with:
    bucket: onorca-cloud-terraform-state
    object: terraform/state/push-rollout/production.lock
```

The action's `post` step releases the object. A cancelled run leaves it until its 35-minute TTL
expires; the five-minute renewer keeps a live run's lease current. A missing object is acquired
with `ifGenerationMatch: 0`; a live foreign holder, unreadable record, storage error, or
generation conflict fails closed. An expired record can be replaced using its observed generation.

The action supports `holder-key` re-entry and `release: 'false'` for multi-job workflows, although
the current Push deployment uses one lease-holding job. It obtains a token through
`gcloud auth print-access-token` and has no package dependencies.

## Tests

```sh
node --test .github/actions/cloud-sql-rollout-lease/action-contract.test.mjs .github/actions/cloud-sql-rollout-lease/storage-lease.test.mjs
```

`storage-lease.test.mjs` exercises acquisition, renewal, conflicts, and release against a local
Cloud Storage fake. No cloud resource is modified by the tests.
