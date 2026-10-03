output "push_cloud_run_service_uri" {
  value       = try(google_cloud_run_v2_service.push[0].uri, null)
  description = "Default push gateway service URI for pre-domain smoke tests."
}

output "push_runtime_service_account" {
  value       = try(google_service_account.push_runtime[0].email, null)
  description = "Runtime identity that holds the APNs key and sends through FCM."
}

output "push_database_name" {
  value       = try(google_sql_database.push_dedicated[0].name, null)
  description = "Database isolated for durable push gateway state."
}

output "push_dns_record" {
  value = var.push_gateway_enabled ? {
    name = local.push_fqdn
    type = "CNAME"
    data = "ghs.googlehosted.com."
  } : null
  description = "Record the stablyai/orca-cloud apps root must publish in the onorca.dev zone."
}
