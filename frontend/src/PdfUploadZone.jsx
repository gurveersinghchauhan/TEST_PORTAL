import { useCallback, useRef, useState } from 'react';

/**
 * PdfUploadZone
 * -------------
 * Plain HTML5 drag-and-drop (no extra dependency needed) plus a
 * click-to-browse fallback. Calls onFileSelected(file) once a PDF is chosen.
 */
export default function PdfUploadZone({ onFileSelected, isUploading }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    (fileList) => {
      const file = fileList?.[0];
      if (!file) return;
      if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected]
  );

  return (
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
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
        isDraggingOver ? 'border-rose-400 bg-rose-50' : 'border-neutral-300 bg-neutral-50 hover:bg-neutral-100'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {isUploading ? (
        <>
          <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-rose-600 border-t-transparent" />
          <p className="text-sm text-neutral-600">Parsing PDF — extracting passages, questions, and answers…</p>
        </>
      ) : (
        <>
          <div className="mb-3 text-3xl">📄</div>
          <p className="mb-1 font-medium text-neutral-800">Drop a reading test PDF here</p>
          <p className="text-sm text-neutral-500">or click to browse — PDF only, up to 25MB</p>
        </>
      )}
    </div>
  );
}
