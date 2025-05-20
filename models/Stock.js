// models/Stock.js
const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  size: { type: String, default: '' },
  color: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 0 }
}, { timestamps: true });

// Índice compuesto para búsquedas rápidas
stockSchema.index({ productId: 1, size: 1, color: 1 }, { unique: true });

module.exports = mongoose.model('Stock', stockSchema);