export type MobileLoginProviderId = 'github' | 'wechat' | 'qq'

export type MobileLoginProvider = {
  readonly id: MobileLoginProviderId
  readonly enabled: boolean
  readonly accessibilityLabel: string
  readonly authorizationPath: string
}

export type MobileLoginConfiguration = {
  readonly registrationEnabled: boolean
  readonly providers: readonly MobileLoginProvider[]
}

export type MobileLoginAction =
  | { readonly kind: 'phone' }
  | { readonly kind: 'register' }
  | { readonly kind: 'provider'; readonly providerId: string }

export const mobileLoginFallbackConfiguration: MobileLoginConfiguration = {
  registrationEnabled: false,
  providers: []
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
