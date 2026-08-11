import { Image } from 'react-native'

type Props = {
  size?: number
}

export function OrcaLogo({ size = 24 }: Props) {
  return (
    <Image
      source={require('../../assets/icon.png')}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
    />
  )
}
