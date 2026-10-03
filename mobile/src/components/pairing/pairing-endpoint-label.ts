export function pairingEndpointLabel(endpoint: string): string {
  try {
    const parsed = new URL(endpoint)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return '已验证的桌面连接地址'
  }
}
