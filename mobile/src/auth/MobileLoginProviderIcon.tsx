import { LogIn } from 'lucide-react-native'
import { Image, type ImageSourcePropType } from 'react-native'

type MobileLoginProviderIconProps = {
  readonly backgroundColor: string
  readonly color: string
  readonly providerId: string
  readonly size?: number
}

const providerAssets: Record<string, ImageSourcePropType> = {
  github: require('../../assets/auth-icons/github.png'),
  wechat: require('../../assets/auth-icons/wechat.png'),
  qq: require('../../assets/auth-icons/qq.png')
}

export function MobileLoginProviderIcon({
  color,
  providerId,
  size = 24
}: MobileLoginProviderIconProps) {
  const asset = providerAssets[providerId]
  if (asset) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={asset}
        style={{ width: size, height: size }}
      />
    )
  }
  return <LogIn color={color} size={size} strokeWidth={2} />
}
