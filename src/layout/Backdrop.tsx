export function Backdrop({
  visible,
  onClick,
}: {
  visible: boolean
  onClick: () => void
}) {
  return (
    <div
      className="layout-backdrop"
      data-visible={visible}
      aria-hidden="true"
      onClick={onClick}
    />
  )
}
