const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A single User model covers four roles.
 * - 'institute' / 'teacher' accounts create tests and manage students.
 * - 'student' accounts must reference the teacher/institute they belong to,
 *   so every student is always linked to exactly one teacher.
 * - 'superadmin' accounts operate the Super Admin console (routes/superAdmin.js)
 *   — they sit above every tenant, so they're the one role that does NOT
 *   belong to an Institute (see instituteId below). Provisioned only via
 *   scripts/createSuperAdmin.js, never through a public route.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Required for every role — institute, teacher, and student — for
    // record-keeping and future communications (SMS/WhatsApp reminders etc.).
    contactNumber: { type: String, required: true, trim: true },

    role: {
      type: String,
      enum: ['institute', 'teacher', 'student', 'superadmin'],
      required: true,
    },

    // Multi-tenant isolation: which Institute (coaching center) this
    // account belongs to — the SaaS tenant boundary. For an 'institute'
    // account this is its own Institute tenant document (set at
    // registration — see routes/superAdmin.js); teachers/students inherit
    // it verbatim from their creator at creation time (see
    // routes/users.js), never resolved after the fact. Every protected
    // route reads this straight off the verified JWT (see
    // middleware/auth.js) rather than re-deriving it, so tenant scoping is
    // both fast and can't be spoofed by client input.
    // 'superadmin' is the one role exempt from this — it sits above every
    // tenant rather than inside one, so it's the only role allowed to have
    // no instituteId at all.
    instituteId: {
      type: Schema.Types.ObjectId,
      ref: 'Institute',
      required: function () {
        return this.role !== 'superadmin';
      },
      index: true,
    },

    // Required only for students — the teacher/institute account that owns them.
    teacher: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.role === 'student';
      },
      validate: {
        validator: function (v) {
          // Students must have a teacher; teachers/institutes must not.
          if (this.role === 'student') return !!v;
          return v == null;
        },
        message: 'A student must be linked to a teacher; teachers/institutes cannot have one.',
      },
    },

    // Optional: an institute account can group multiple teachers under it.
    institute: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Required only for students — which batch (created by their institute)
    // they belong to.
    batchId: {
      type: Schema.Types.ObjectId,
      ref: 'Batch',
      required: function () {
        return this.role === 'student';
      },
      validate: {
        validator: function (v) {
          // Students must have a batch; teachers/institutes must not.
          if (this.role === 'student') return !!v;
          return v == null;
        },
        message: 'A student must be linked to a batch; teachers/institutes cannot have one.',
      },
    },

    // Denormalized for quick dashboard queries (e.g. "students awaiting invite").
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ teacher: 1 });
userSchema.index({ batchId: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);
