# IELTS Portal — Project Architecture

This document describes the current state of the codebase: the tech stack, how the frontend and backend talk to each other, and the exact end-to-end flow of uploading and parsing a test PDF. It reflects what the code actually does today, including rough edges that still need cleanup (called out at the end).

## 1. Tech stack

### Frontend (`/frontend`)
- **React 19** + **Vite 8** (`@vitejs/plugin-react`) — SPA, no router library; view switching is done with local `useState` in `App.jsx` (`'student' | 'teacher' | 'builder'`).
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin — utility classes used directly in JSX, no separate config file.
- **socket.io-client** — real-time connection to the backend for the live exam timer.
- **@dnd-kit** (`core`, `utilities`) — installed for drag-and-drop, presumably for reordering questions/parts in the builder (not wired into the files reviewed).
- No state management library (Redux/Zustand/etc.) — state is local `useState`, lifted only as far as the nearest common parent (e.g. `TestBuilder` owns the draft, passes it down to `PartEditor` → `QuestionGroupEditor`).
- No routing library — "pages" are just conditionally-rendered components.

### Backend (`/backend`)
- **Node.js + Express 5**, CommonJS modules (`require`/`module.exports`).
- **MongoDB Atlas** via **Mongoose 9** — three schemas: `Test`, `Submission`, `User`.
- **Socket.IO 4** (server) — real-time exam timer/session broadcasting, layered on top of the same HTTP server as Express.
- **Multer 2** — multipart/form-data handling for PDF uploads, configured with **in-memory storage** (no files touch disk).
- **pdf-parse 2** — extracts raw text from the uploaded PDF buffer.
- **@google/generative-ai** (Gemini) — takes the raw extracted text and turns it into structured test JSON (passages, question groups, questions, answer key).
- **cors** — restricts cross-origin requests to `CLIENT_ORIGIN` (defaults to `http://localhost:5173`, the Vite dev server).

### Data model summary
- `Test` — one exam: `title`, `module` (`reading`/`listening`), `durationMinutes`, `totalQuestions`, `parts[]` (each a passage/audio track + its `questionGroups[]` + `questions[]`), `isPublished`.
- `Submission` — one student's attempt: `student`, `teacher`, `test`, `answers[]` (with `isCorrect`), `score`, `status` (`in-progress`/`submitted`/`graded`).
- `User` — single collection for `institute` / `teacher` / `student` roles; students must reference a `teacher`.

## 2. How the frontend and backend are connected

Two separate channels, both pointed at the same Express+Socket.IO process (`server.js`, port `4000` by default):

### a. REST over HTTP (data — tests, CRUD)
- Base URL: `const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api'` (`TestBuilder.jsx`), or a hardcoded `http://localhost:4000/api/tests` in `App.jsx`.
- Mounted in `server.js`: `app.use('/api/tests', require('./routes/testUpload'))`.
- Endpoints (`backend/routes/testUpload.js`):
  - `GET /api/tests` — list all tests (used by the student dashboard grid in `App.jsx`).
  - `POST /api/tests/upload-pdf` — upload + AI-parse a PDF, creates an unpublished draft `Test`.
  - `PATCH /api/tests/:id` — save teacher edits to a draft.
  - `POST /api/tests/:id/publish` — flips `isPublished: true`, making the test visible to students.
- No auth is wired up yet — the auth middleware is commented out everywhere (`/* requireAuth, requireRole(...) */`), and `createdBy` falls back to a dummy ObjectId. `App.jsx` also uses hardcoded dummy student/teacher IDs.

### b. WebSockets via Socket.IO (real-time — exam timer)
- `useExamTimer.js` (student side) and `TeacherDashboard.jsx` (teacher side) each open their own `socket.io-client` connection to `VITE_SOCKET_URL || 'http://localhost:4000'`.
- The server is **authoritative** for time: `backend/socketHandler.js` keeps an in-memory `Map` of active sessions (`activeSessions`, keyed by `studentId`) and a single global `setInterval` that ticks every running/overtime session once per second, broadcasting `timer:update` to both the student's room (`student:<id>`) and their teacher's room (`teacher:<id>`).
- Student flow: `useExamTimer` emits `student:join` on connect → server creates/resumes a session → server pushes `timer:update` every second → hook mirrors `label`/`timeRemaining`/`status` into React state. A `force_submit` event (teacher-triggered) calls back into `StudentTestPage.submitTest()`.
- Teacher flow: `TeacherDashboard` emits `teacher:join` → server replies with `timer:bulk_sync` (all current sessions for that teacher) → then streams `timer:update` per student. Teacher can emit `GRANT_FIXED_TIME`, `ALLOW_OVERTIME`, `FORCE_SUBMIT`, `teacher:pause`, `teacher:resume`.
- This session store is purely in-memory (a `Map` in the Node process) — it does not survive a server restart and won't scale across multiple Node instances without a shared store (e.g. Redis), a limitation already called out in the code's own comments.

```
┌─────────────────┐        REST (fetch/JSON)        ┌──────────────────┐
│  React frontend │ ───────────────────────────────▶│  Express routes   │
│  (Vite, :5173)  │◀─────────────────────────────── │  /api/tests/*     │
│                 │                                   │  (testUpload.js)  │
│                 │      WebSocket (socket.io)        │                  │
│  useExamTimer / │ ◀────────────────────────────────▶  socketHandler.js │
│  TeacherDashbrd │      timer:update / commands      │  (same server.js) │
└─────────────────┘                                   └────────┬─────────┘
                                                                 │ Mongoose
                                                                 ▼
                                                        MongoDB Atlas
                                                     (Test / Submission / User)
```

## 3. Exact flow: uploading and parsing a test PDF

This is the "Test Builder" flow, tracing through `PdfUploadZone.jsx` → `TestBuilder.jsx` → `backend/routes/testUpload.js` → `backend/middleware/upload.js` → `backend/services/pdfParserService.js` → `backend/models/Test.js`.

1. **Teacher picks a file** (`PdfUploadZone.jsx`)
   Drag-and-drop or click-to-browse `<input type="file" accept="application/pdf">`. Client-side check: rejects anything whose `file.type !== 'application/pdf'` with a plain `alert()`. On a valid file, calls `onFileSelected(file)`.

2. **Frontend uploads it** (`TestBuilder.jsx` → `handleFileSelected`)
   - Sets `isUploading = true` (spinner shown in the drop zone).
   - Wraps the file in a `FormData` under the field name `file`.
   - `POST {API_BASE}/tests/upload-pdf` with `body: formData` (browser sets the multipart boundary automatically — no manual `Content-Type` header).

3. **Multer intercepts the request** (`backend/middleware/upload.js`)
   - `multer.memoryStorage()` — the PDF is buffered fully in RAM as `req.file.buffer`, never written to disk.
   - `fileFilter` rejects any non-`application/pdf` mimetype server-side too.
   - `limits.fileSize` caps uploads at 25 MB.
   - Wired into the route as `uploadPdf.single('file')` — must match the `formData.append('file', file)` field name on the frontend.

4. **Route handler runs** (`backend/routes/testUpload.js`, `POST /upload-pdf`)
   - Guards on `req.file` existing (400 if not).
   - Calls `await parseReadingTestPdf(req.file.buffer)` — this is the whole parsing pipeline, detailed below.
   - Takes the parsed result and immediately persists it as a **new `Test` document** with `isPublished: false` (a draft — not yet visible to students). `createdBy` is a hardcoded dummy ObjectId since auth isn't wired up.
   - Responds `201` with `{ testId, test: draft, warnings }`. `warnings` surfaces any `unmatchedAnswerNumbers` the parser couldn't map to a question, so the teacher knows to check them manually.
   - On any thrown error (including a parser failure that itself throws, which normally shouldn't happen — see step 5's fallback), responds `500` with a generic "Failed to parse PDF" message.

5. **PDF parsing pipeline** (`backend/services/pdfParserService.js`, `parseReadingTestPdf`)
   This is a two-stage pipeline: deterministic text extraction, then AI-driven structuring.

   - **Stage 1 — raw text extraction** (`extractRawText`): Runs the buffer through `pdf-parse`, handling a few different possible export shapes of that library defensively (`pdfLib.PDFParse` class API, `pdfLib` as a callable function, or `pdfLib.default`). Normalizes line endings (`\r\n` → `\n`) and strips trailing whitespace before newlines. If extraction itself throws, the error propagates up (caught by the route's try/catch → 500).

   - **Stage 2 — AI structuring**: The raw text is embedded into a large prompt sent to **Gemini** (via `@google/generative-ai`, using a hardcoded `GEMINI_API_KEY` set directly in `server.js`). The prompt instructs the model to:
     - Identify passages, question groups, and questions.
     - Repair paragraph breaks that got split by PDF column layout.
     - Classify each question's type (from a fixed set: `true-false-not-given`, `yes-no-not-given`, `multiple-choice`, `multiple-select`, `fill-in-the-blank`, `matching-heading`, `matching-information`, `short-answer`).
     - Match any trailing "Answer Key" section back to the corresponding question numbers.
     - Return **only** JSON matching a specific schema (title, module, durationMinutes, totalQuestions, parts[] with nested questionGroups[] and questions[], plus `unmatchedAnswerNumbers`).
     - `callGeminiWithFallback` tries a prioritized list of models in order — `gemini-1.5-flash` → `gemini-1.5-flash-8b` → `gemini-flash-lite-latest` — falling through to the next on any failure (rate limit, model unavailable, etc.), and throws only once all three are exhausted.

   - **Response cleanup + parsing**: Strips any ` ```json ` / ` ``` ` code-fence markers the model might still include despite instructions, then `JSON.parse`s the result.

   - **Safety net #1 (empty passage)**: If the AI returns no `parts`, or the first part has no `passageText`, the raw extracted text is force-injected as a single unstructured part (`title: 'Raw Passage (AI Formatter Skipped)'`) so the teacher at least has the full text to work with manually, instead of losing it.

   - **Safety net #2 (total failure)**: If anything in Stage 2 throws (Gemini unreachable, invalid JSON that fails to parse, etc.), the whole function catches it and returns a fallback object (`title: 'Manual Draft (AI Failed)'`) containing just the raw extracted text as one part with no question groups — so the upload always succeeds and produces *something* editable, even in a total AI outage. This is why the route's `catch` block is rarely hit in practice; most failure modes are absorbed inside the parser itself.

6. **Frontend renders the draft for review** (`TestBuilder.jsx` + `PartEditor.jsx` + `QuestionGroupEditor.jsx`)
   - `TestBuilder` stores the returned `test` object as `draft` in state, switching the UI from the upload zone to an editable review screen.
   - Any `warnings` (unmatched answer-key numbers) are shown as amber banners.
   - Title and duration are directly editable inputs bound to `draft`.
   - Each `parts[]` entry renders as a `PartEditor` (passage title + full passage text in a `<textarea>`, editable in case paragraph breaks or OCR came out wrong).
   - Each part's `questionGroups[]` renders as a `QuestionGroupEditor`: group-level instructions + question type (editable `<select>`), and every individual question with its extracted prompt and answer. Anything the parser couldn't confidently extract is visually flagged — prompts starting with `[Could not auto-extract...]` get an amber background, and answers that came back `null` show an amber "not found in answer key — enter manually" placeholder.
   - All edits flow back up through `onChange` callbacks (`QuestionGroupEditor` → `PartEditor` → `TestBuilder`), so `TestBuilder` remains the single source of truth for the in-progress draft — nothing else in the tree holds its own copy of the data.

7. **Saving and publishing**
   - **Save draft**: `PATCH /api/tests/:id` with `{ title, durationMinutes, parts }` — persists edits without changing `isPublished`.
   - **Publish**: `publishTest()` first calls `saveDraft()` (to flush any pending edits), then `POST /api/tests/:id/publish`, which flips `isPublished: true` server-side. Only at this point does the test become visible to students, since `GET /api/tests` returns all tests regardless of `isPublished` status today (the student dashboard in `App.jsx` doesn't currently filter — see notes below).

## 4. Notable gaps / things to fix before production

These aren't part of "how it works today" but are worth flagging since they were visible while reading the code:

- **Hardcoded secrets in `server.js`**: the Gemini API key and the full MongoDB Atlas connection string (with username/password) are committed directly in source (`backend/server.js` lines 7 and 24). These should move to environment variables (`.env`, git-ignored) immediately — as committed, both credentials are exposed to anyone with repo access.
- **No auth**: every route's auth/role middleware is commented out; teacher/student identity is hardcoded/dummy throughout (`App.jsx`'s `dummyStudent`/`dummyTeacherId`, the upload route's fallback `createdBy`).
- **`GET /api/tests` doesn't filter by `isPublished`**: the student-facing list in `App.jsx` fetches and displays *all* tests, including unpublished drafts — the publish flag currently has no enforcement point.
- **Case-mismatched import**: `App.jsx` imports `from './Testbuilder'` (lowercase `b`) while the actual file is `TestBuilder.jsx`. Works on Windows/macOS (case-insensitive filesystems) but will break on a case-sensitive filesystem (Linux CI/deploy).
- **In-memory session store**: `activeSessions` in `socketHandler.js` lives only in process memory — a server restart drops every running exam timer, and it won't work across multiple server instances without moving to something like Redis.
- **Submission flow is a stub**: `StudentTestPage.submitTest()` only `console.log`s — there's no route yet that writes a `Submission` document, despite the model existing and `answerChecker.js` (`checkIeltsAnswer`) being ready to grade fill-in-the-blank style answers (handles slash-separated alternates and optional bracketed words).
