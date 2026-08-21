import { useRef, useState } from 'react';
import { authHeaders } from '../../apiAuth';

/**
 * ImageUploadDropzone
 * --------------------
 * A real file picker/dropzone for question-group images (today: the
 * map/plan/diagram picture on a matrix-matching group — see
 * TestInterface.jsx's MatrixMatchingGroup and Test.js's
 * questionGroupSchema.mapImageUrl) — replacing a plain "paste a URL" text
 * input. Selecting (or dropping) a file immediately uploads it to
 * POST /api/tests/upload-image (see backend/routes/testUpload.js), shows a
 * loading state while that's in flight, and hands the resulting HTTP URL
 * back to the caller via onUploaded — the caller is the one that actually
 * stores it (group.mapImageUrl), same "upload now, attach the URL to
 * whatever's being built" split MasterAudioDropzone.jsx (ListeningTestWizard)
 * already uses for the master audio file.
 *
 * Shared by both wizards that author a matrix-matching group identically —
 * ListeningTestWizard.jsx's QuestionGroupBuilder and Reading's
 * QuestionGroupEditor.jsx (used by both ReadingTestWizard.jsx and
 * TestDraftEditor.jsx via PartEditor.jsx) — so there's exactly one upload
 * UI/UX for this, not two independently-maintained copies.
 *
 * The uploaded URL always comes back absolute (backend/routes/testUpload.js
 * builds it from req.protocol + req.get('host')), so the caller — and
 * ultimately TestInterface.jsx's plain <img src={group.mapImageUrl}> — never
 * has to worry about resolving a relative path or hitting a CORS/file://
 * issue: it's a normal same-origin-or-not HTTP URL either way, exactly like
 * masterAudioUrl already is for the <audio> tag.
 */
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const IMAGE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

export default function ImageUploadDropzone({ apiBase, imageUrl, onUploaded, label = 'Image (optional)' }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function handleFiles(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    const isValidType = IMAGE_MIME_TYPES.has(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    if (!isValidType) {
      setError('Please upload a .png, .jpg, or .jpeg image file.');
      return;
    }

    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${apiBase}/tests/upload-image`, {
        method: 'POST',
        headers: authHeaders(), // no Content-Type — the browser sets the multipart boundary itself
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload image.');
      onUploaded(data.url);
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-500">{label}</label>

      {imageUrl && !isUploading ? (
        // Uploaded state — a real preview plus a clear way to swap it for a
        // different image, same shape as MasterAudioDropzone's "Replace"/
        // "Remove" pair.
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <img
              src={imageUrl}
              alt="Uploaded map/plan/diagram preview"
              className="max-h-40 shrink-0 rounded border border-neutral-200 bg-white object-contain"
            />
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => onUploaded('')}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50"
              >
                Remove
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => !isUploading && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
            isDraggingOver ? 'border-rose-400 bg-rose-50' : 'border-neutral-300 bg-neutral-50 hover:bg-neutral-100'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {isUploading ? (
            <>
              <div className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-rose-600 border-t-transparent" />
              <p className="text-xs text-neutral-600">Uploading image…</p>
            </>
          ) : (
            <>
              <div className="mb-1 text-2xl">🖼️</div>
              <p className="text-xs font-medium text-neutral-700">Drop an image here, or click to browse</p>
              <p className="text-[11px] text-neutral-400">.png, .jpg, or .jpeg</p>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
