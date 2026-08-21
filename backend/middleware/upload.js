const fs = require('fs');
const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE_MB = 25;

// Memory storage: we only need the buffer long enough to run pdf-parse on
// it, then it's discarded — nothing is written to disk on this server.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('Only PDF files are accepted.'));
  }
  cb(null, true);
}

const uploadPdf = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// Master Listening audio — unlike the PDF parser above, this file itself
// (not just data extracted from it) is the end product: it needs to persist
// on disk somewhere a plain <audio src="..."> can fetch it back from, for
// as long as the test exists. There's no cloud storage (S3/Cloudinary/etc.)
// wired into this backend, so it's written straight to a local `uploads/
// audio/` folder under the backend package root and served back out via
// `express.static` (see server.js) — the simplest thing that works without
// introducing a new external dependency or requiring credentials nobody has
// configured. Revisit if/when real object storage gets added.
const AUDIO_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'audio');
fs.mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });

// A full IELTS Listening recording (4 sections back-to-back) can run
// 30-40 minutes — a generous 150MB cap comfortably covers even a high
// bitrate mp3 of that length while still rejecting an obviously-wrong file.
const MAX_AUDIO_FILE_SIZE_MB = 150;
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3']);

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_UPLOAD_DIR),
  // Timestamp-prefixed so two teachers uploading "audio.mp3" the same
  // minute never collide; the original name is kept (sanitized) purely so
  // the stored filename stays human-readable for anyone browsing the
  // uploads folder directly.
  filename: (req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 60);
    cb(null, `${Date.now()}-${safeBase || 'master-audio'}.mp3`);
  },
});

function audioFileFilter(req, file, cb) {
  if (!AUDIO_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only .mp3 audio files are accepted.'));
  }
  cb(null, true);
}

const uploadAudio = multer({
  storage: audioStorage,
  fileFilter: audioFileFilter,
  limits: { fileSize: MAX_AUDIO_FILE_SIZE_MB * 1024 * 1024 },
});

// Question-group images — currently just the map/plan/diagram picture for
// matrix-matching groups (questionGroupSchema.mapImageUrl, see
// TestInterface.jsx's MatrixMatchingGroup), but deliberately generic (not
// named "map") since any future question-group image need can reuse this
// same endpoint/route. Same disk-backed, express.static-served approach as
// uploadAudio above, for the same reason: no object storage wired up yet,
// and the file itself (not data extracted from it) is the end product.
const IMAGE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });

// Generous enough for a scanned/high-res map or diagram without allowing an
// obviously-wrong upload (e.g. someone dragging in a video file by mistake).
const MAX_IMAGE_FILE_SIZE_MB = 15;
const IMAGE_MIME_TO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGE_UPLOAD_DIR),
  // Timestamp-prefixed so two teachers uploading "diagram.png" the same
  // minute never collide; extension is derived from the validated mimetype
  // (not trusted from the original filename) so every stored file has a
  // predictable, correct extension regardless of what the source file was
  // actually named.
  filename: (req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 60);
    const ext = IMAGE_MIME_TO_EXT[file.mimetype] || '.png';
    cb(null, `${Date.now()}-${safeBase || 'image'}${ext}`);
  },
});

function imageFileFilter(req, file, cb) {
  if (!IMAGE_MIME_TO_EXT[file.mimetype]) {
    return cb(new Error('Only .png, .jpg, or .jpeg image files are accepted.'));
  }
  cb(null, true);
}

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_IMAGE_FILE_SIZE_MB * 1024 * 1024 },
});

module.exports = { uploadPdf, uploadAudio, uploadImage, AUDIO_UPLOAD_DIR, IMAGE_UPLOAD_DIR };
