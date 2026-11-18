import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import type { FileAttachment } from '../../shared/domain'

/** Images the browser can show safely through the preview route (the server checks the bytes). */
export function isImageFile(file: Pick<FileAttachment, 'name' | 'externalUrl'>) {
  return !file.externalUrl && /\.(png|jpe?g|gif|webp)$/i.test(file.name)
}

/**
 * Full-screen view of an attached image, with the others of the same list one arrow away.
 * A native modal dialog, so it sits above the task panel (also a native dialog) in the top layer.
 */
export function ImageViewer({
  images,
  start,
  onClose,
}: {
  images: FileAttachment[]
  start: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(start)
  const image = images[index]
  const many = images.length > 1
  const step = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  if (!image) return null
  // Rendered at the end of the page, so thumbnail styles of the list it opened from do not apply.
  return createPortal(
    <dialog
      ref={ref}
      className="image-viewer"
      aria-label={`Imagem: ${image.name}`}
      // Events stay here: the task panel behind must not react to them.
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget || event.target === event.currentTarget.firstChild)
          onClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        // Escape is handled here, so it closes only the image: browsers may otherwise close the
        // task panel too when both dialogs opened without a click in between.
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (!many) return
        if (event.key === 'ArrowRight') step(1)
        if (event.key === 'ArrowLeft') step(-1)
      }}
    >
      <div className="image-viewer-stage">
        <img key={image.id} src={`/api/files/${image.id}/preview`} alt={image.name} />
      </div>
      <header className="image-viewer-bar">
        <span>
          <strong>{image.name}</strong>
          {many && (
            <small>
              {index + 1} de {images.length}
            </small>
          )}
        </span>
        <a href={`/api/files/${image.id}`} download={image.name} aria-label="Baixar imagem">
          <Download size={18} aria-hidden="true" />
          Baixar
        </a>
        <button type="button" onClick={onClose} aria-label="Fechar" autoFocus>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {many && (
        <>
          <button
            type="button"
            className="image-viewer-nav previous"
            aria-label="Imagem anterior"
            onClick={() => step(-1)}
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="image-viewer-nav next"
            aria-label="Próxima imagem"
            onClick={() => step(1)}
          >
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </>
      )}
    </dialog>,
    document.body,
  )
}
