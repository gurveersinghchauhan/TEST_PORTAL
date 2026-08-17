const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A single User model covers three roles.
 * - 'institute' / 'teacher' accounts create tests and manage students.
 * - 'student' accounts must reference the teacher/institute they belong to,
 *   so every student is always linked to exactly one teacher.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    role: {
      type: String,
      enum: ['institute', 'teacher', 'student'],
      required: true,
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

    // Denormalized for quick dashboard queries (e.g. "students awaiting invite").
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ teacher: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);
