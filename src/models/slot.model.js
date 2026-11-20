import mongoose from "mongoose";

const slotSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
  name: { type: String, required: true, trim: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  capacity: { type: Number, default: 250, min: 1, max: 500 },
  admittedCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

slotSchema.index({ quiz: 1, name: 1 }, { unique: true });
slotSchema.index({ quiz: 1, startsAt: 1 });

export const Slot = mongoose.model("Slot", slotSchema);
