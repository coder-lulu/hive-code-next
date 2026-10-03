export function HiveAccountDetailRow({
  label,
  value
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 border-t border-border/55 py-1 text-xs [@media(max-height:950px)]:min-h-7">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}
