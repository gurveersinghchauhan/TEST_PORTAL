const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A batch is purely an institute-owned grouping label (e.g. "Morning Batch")
 * that students get assigned to at creation time. Only an institute admin
 * can create one — see POST /api/batches.
 */
const batchSchema = new Schema(
  {
    // The institute-role User account that owns this batch — kept for the
    // Tier 1/2/3 ownership-chain checks already built around it (see
    // routes/users.js). Not the multi-tenant Institute document; see
    // instituteId below for that.
    institute: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Multi-tenant isolation: the Institute tenant this batch belongs to —
    // stamped from the creating institute's own instituteId at creation
    // time (see routes/batches.js), and what every GET query strictly
    // filters on.
    instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },

    name: { type: String, required: true, trim: true },
    // Soft-delete flag rather than actually removing the document — a batch
    // with students already linked to it shouldn't just vanish out from
    // under them. GET /api/batches only returns isActive ones.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true } // gives us createdAt (and updatedAt) automatically
);

// The batch name only needs to be unique WITHIN one institute — two
// different institutes can each have their own "Morning Batch".
batchSchema.index({ institute: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Batch', batchSchema);
