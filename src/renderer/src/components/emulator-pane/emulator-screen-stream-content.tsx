import { Loader2 } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { useEmulatorFrameStream } from './use-emulator-frame-stream'
import { useEmulatorVideoStream } from './use-emulator-video-stream'
import { translate } from '@/i18n/i18n'
import type { VisualStreamGeometry } from './emulator-device-frame-layout'

type StreamSize = {
  height: number
  width: number
}

type EmulatorScreenStreamContentProps = {
  loading: boolean
  onAndroidStreamError?: () => void
  onStreamError: () => void
  onStreamReady?: () => void
  onStreamRetry?: () => void
  onStreamSize: (size: StreamSize) => void
  previewUrl?: string
  screenAspectRatio?: number
  showStream: boolean
  streamError: boolean
  streamKey?: string
  streamRotation?: VisualStreamGeometry['streamRotation']
}

// Android sessions stream H.264 over scrcpy://<serial>; iOS uses an MJPEG http URL.
const SCRCPY_PREFIX = 'scrcpy://'

export function EmulatorScreenStreamContent({
  loading,
  onAndroidStreamError,
  onStreamError,
  onStreamReady,
  onStreamRetry,
  onStreamSize,
  previewUrl,
  screenAspectRatio = 9 / 19,
  showStream,
  streamError,
  streamKey,
  streamRotation = 0
}: EmulatorScreenStreamContentProps) {
  const androidDeviceId =
    previewUrl && previewUrl.startsWith(SCRCPY_PREFIX)
      ? previewUrl.slice(SCRCPY_PREFIX.length)
      : null

  const {
    canvasRef: videoCanvasRef,
    error: videoError,
    hasFrame: videoHasFrame,
    recoverable: videoRecoverable
  } = useEmulatorVideoStream(
    androidDeviceId ?? undefined,
    streamKey,
    showStream && Boolean(androidDeviceId),
    onStreamSize,
    onStreamReady
  )
  const frameStream = useEmulatorFrameStream(
    androidDeviceId ? undefined : previewUrl,
    streamKey,
    showStream && Boolean(previewUrl) && !androidDeviceId
  )

  useEffect(() => {
    if (frameStream.error) {
      onStreamError()
    }
    if (videoError) {
      ;(videoRecoverable ? (onAndroidStreamError ?? onStreamError) : onStreamError)()
    }
  }, [frameStream.error, onAndroidStreamError, onStreamError, videoError, videoRecoverable])

  const mediaStyle = resolveStreamMediaStyle(streamRotation, screenAspectRatio)
  const mediaClassName =
    streamRotation === 0
      ? 'block h-full w-full bg-black object-contain'
      : 'absolute left-1/2 top-1/2 block max-w-none bg-black object-contain'
  const connectingDisplayLabel = translate(
    'auto.components.emulator.pane.emulator.screen.stream.content.connectingDisplay',
    'Connecting display…'
  )

  if (androidDeviceId && showStream && !videoError) {
    return (
      <>
        <canvas
          ref={videoCanvasRef}
          className={mediaClassName}
          style={mediaStyle}
          aria-hidden={!videoHasFrame}
          aria-label={translate(
            'auto.components.emulator.pane.emulator.screen.stream.content.5ee64cd44e',
            'Emulator screen'
          )}
        />
        {!videoHasFrame ? (
          <EmulatorStreamLoadingState label={connectingDisplayLabel} overlay />
        ) : null}
      </>
    )
  }

  if (showStream && frameStream.frameUrl) {
    return (
      <img
        key={`${previewUrl}::${streamKey ?? ''}`}
        src={frameStream.frameUrl}
        alt={translate(
          'auto.components.emulator.pane.emulator.screen.stream.content.5ee64cd44e',
          'Emulator screen'
        )}
        className={mediaClassName}
        draggable={false}
        style={mediaStyle}
        onError={onStreamError}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          if (naturalWidth <= 0 || naturalHeight <= 0) {
            return
          }
          onStreamSize({ width: naturalWidth, height: naturalHeight })
          onStreamReady?.()
        }}
      />
    )
  }

  const waitingForFrame = showStream && !frameStream.error && !videoError
  const displayError = streamError || Boolean(frameStream.error) || Boolean(videoError)
  const startingEmulator = loading && !showStream
  const reconnectingDisplay = loading && displayError

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground">
      {startingEmulator || waitingForFrame || reconnectingDisplay ? (
        <EmulatorStreamLoadingState
          label={
            startingEmulator
              ? translate(
                  'auto.components.emulator.pane.emulator.screen.stream.content.startingEmulator',
                  'Starting emulator…'
                )
              : reconnectingDisplay
                ? translate(
                    'auto.components.emulator.pane.emulator.screen.stream.content.reconnectingDisplay',
                    'Reconnecting display…'
                  )
                : connectingDisplayLabel
          }
        />
      ) : displayError ? (
        <>
          <span className="px-6 text-center text-xs">
            {translate(
              'auto.components.emulator.pane.emulator.screen.stream.content.36841af608',
              'Stream disconnected'
            )}
          </span>
          {androidDeviceId && videoRecoverable && onStreamRetry ? (
            <Button type="button" variant="outline" size="xs" onClick={onStreamRetry}>
              {translate(
                'auto.components.emulator.pane.emulator.screen.stream.content.reconnect',
                'Reconnect'
              )}
            </Button>
          ) : null}
        </>
      ) : (
        <span className="px-6 text-center text-xs">
          {translate(
            'auto.components.emulator.pane.emulator.screen.stream.content.8b1a0d8694',
            'Emulator preview'
          )}
        </span>
      )}
    </div>
  )
}

function EmulatorStreamLoadingState({
  label,
  overlay = false
}: {
  label: string
  overlay?: boolean
}) {
  return (
    <div
      role="status"
      className={
        overlay
          ? 'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground'
          : 'flex flex-col items-center justify-center gap-3'
      }
    >
      <Loader2 className="size-6 animate-spin text-primary" />
      <span className="text-xs">{label}</span>
    </div>
  )
}

function resolveStreamMediaStyle(
  streamRotation: VisualStreamGeometry['streamRotation'],
  screenAspectRatio: number
): CSSProperties | undefined {
  if (streamRotation === 0 || screenAspectRatio <= 0) {
    return undefined
  }
  return {
    height: `${100 * screenAspectRatio}%`,
    transform: `translate(-50%, -50%) rotate(${streamRotation}deg)`,
    transformOrigin: 'center',
    width: `${100 / screenAspectRatio}%`
  }
}
