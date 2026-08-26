import { Image } from 'react-native'

type Props = {
  size?: number
  unframed?: boolean
}

export function OrcaLogo({ size = 24, unframed = false }: Props) {
  return (
    <Image
      source={unframed ? require('../../assets/splash-icon.png') : require('../../assets/icon.png')}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: unframed ? 0 : Math.round(size * 0.22) }}
    />
  )
}
