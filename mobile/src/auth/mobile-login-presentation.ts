export type MobileLoginProvider = {
  readonly id: string
  readonly enabled: boolean
  readonly accessibilityLabel: string
}

export type MobileLoginConfiguration = {
  readonly registrationEnabled: boolean
  readonly providers: readonly MobileLoginProvider[]
}

export type MobileLoginAction =
  | { readonly kind: 'phone' }
  | { readonly kind: 'register' }
  | { readonly kind: 'provider'; readonly providerId: string }

// The renderer consumes the server-shaped configuration and never owns provider order.
export const mobileLoginMockupConfiguration: MobileLoginConfiguration = {
  registrationEnabled: false,
  providers: [
    { id: 'github', enabled: true, accessibilityLabel: '使用 GitHub 登录' },
    { id: 'wechat', enabled: true, accessibilityLabel: '使用微信登录' },
    { id: 'qq', enabled: true, accessibilityLabel: '使用 QQ 登录' }
  ]
}

export function enabledMobileLoginProviders(
  configuration: MobileLoginConfiguration
): readonly MobileLoginProvider[] {
  return configuration.providers.filter((provider) => provider.enabled)
}

export function mobileLoginAttemptAllowed(agreed: boolean): boolean {
  return agreed
}

export function mobileLoginActionKey(action: MobileLoginAction): string {
  return action.kind === 'provider' ? `provider:${action.providerId}` : action.kind
}
