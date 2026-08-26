import { LogIn } from 'lucide-react-native'
import Svg, { Circle, Path } from 'react-native-svg'

type MobileLoginProviderIconProps = {
  readonly backgroundColor: string
  readonly color: string
  readonly providerId: string
  readonly size?: number
}

export function MobileLoginProviderIcon({
  backgroundColor,
  color,
  providerId,
  size = 24
}: MobileLoginProviderIconProps) {
  if (providerId === 'github') {
    return <GithubGlyph color={color} size={size} />
  }
  if (providerId === 'wechat') {
    return <WechatGlyph color={color} size={size} />
  }
  if (providerId === 'qq') {
    return <QqGlyph backgroundColor={backgroundColor} color={color} size={size} />
  }
  return <LogIn color={color} size={size} strokeWidth={2} />
}

function GithubGlyph({ color, size }: { readonly color: string; readonly size: number }) {
  return (
    <Svg accessibilityIgnoresInvertColors width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12 1.8a10.3 10.3 0 0 0-3.3 20c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.7.1-.7.1-.7 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1.1a9.7 9.7 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.4 4.8-4.7 5.1.4.3.7 1 .7 2v2.7c0 .3.2.6.7.5A10.3 10.3 0 0 0 12 1.8Z"
      />
    </Svg>
  )
}

function WechatGlyph({ color, size }: { readonly color: string; readonly size: number }) {
  return (
    <Svg accessibilityIgnoresInvertColors width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M9.2 3.2c-4.3 0-7.7 2.8-7.7 6.3 0 2 1.1 3.8 3 5l-.8 2.4 2.8-1.4c.9.3 1.8.4 2.7.4h.6a5.6 5.6 0 0 1-.3-1.8c0-3.5 3.2-6.3 7.2-6.3h.2C16 5.1 13 3.2 9.2 3.2Zm-2.8 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
      />
      <Path
        fill={color}
        d="M22.5 14.1c0-2.9-2.7-5.2-5.9-5.2s-5.9 2.3-5.9 5.2 2.7 5.2 5.9 5.2c.7 0 1.4-.1 2.1-.3l2.2 1.1-.6-1.9c1.4-1 2.2-2.5 2.2-4.1Zm-7.9-.8a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Zm4.2 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Z"
      />
    </Svg>
  )
}

function QqGlyph({
  backgroundColor,
  color,
  size
}: {
  readonly backgroundColor: string
  readonly color: string
  readonly size: number
}) {
  return (
    <Svg accessibilityIgnoresInvertColors width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M7.1 10.2C5.7 8.8 5.6 6.3 6.5 4.3 7.4 2.2 9.2 1 12 1s4.6 1.2 5.5 3.3c.9 2 .8 4.5-.6 5.9 1.8 1.5 2.9 3.9 2.9 6.4 0 2.7-1.4 4.9-3.3 5.8-1.3.6-2.9.9-4.5.9s-3.2-.3-4.5-.9c-1.9-.9-3.3-3.1-3.3-5.8 0-2.5 1.1-4.9 2.9-6.4Z"
        fill={color}
      />
      <Path
        d="M7.4 12.5c-2.4.5-4.2 2.1-4.7 3.7-.3.9.1 1.5.8 1.5 1.1 0 2.7-1 3.7-2.4l1.2-1.8-1-1Z"
        fill={color}
      />
      <Path
        d="M16.6 12.5c2.4.5 4.2 2.1 4.7 3.7.3.9-.1 1.5-.8 1.5-1.1 0-2.7-1-3.7-2.4l-1.2-1.8 1-1Z"
        fill={color}
      />
      <Path
        d="M8.6 19.9c-1.3.1-2.6.6-3.1 1.4-.3.5.1 1 1 1 1.3 0 2.8-.4 3.8-1.1l-.1-1.2-1.6-.1Zm6.8 0c1.3.1 2.6.6 3.1 1.4.3.5-.1 1-1 1-1.3 0-2.8-.4-3.8-1.1l.1-1.2 1.6-.1Z"
        fill={color}
      />
      <Path
        d="M8.2 13.2c.7 2 2 3 3.8 3s3.1-1 3.8-3c.5 1.1.8 2.4.8 3.5 0 2.1-1.9 3.6-4.6 3.6s-4.6-1.5-4.6-3.6c0-1.1.3-2.4.8-3.5Z"
        fill={backgroundColor}
      />
      <Path d="M10.4 9.3 12 10.5l1.6-1.2" stroke={backgroundColor} strokeWidth="1" fill="none" />
      <Circle cx="10.1" cy="7.6" r=".9" fill={backgroundColor} />
      <Circle cx="13.9" cy="7.6" r=".9" fill={backgroundColor} />
    </Svg>
  )
}
