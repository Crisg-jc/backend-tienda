// routes/stockRoutes.js
const express = require('express');
const router = express.Router();
const Stock = require('../models/Stock');

// Verificar stock
router.post('/check-stock', async (req, res) => {
  try {
    const { items } = req.body;
    const results = [];

    for (const item of items) {
      const product = await Stock.findOne({
        productId: item.id,
        size: item.size,
        color: item.color
      });

      results.push({
        id: item.id,
        size: item.size,
        color: item.color,
        available: product ? product.quantity : 0,
        requested: item.quantity
      });
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Actualizar stock (transacción segura)
router.post('/update-stock', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items } = req.body;
    const updates = [];

    for (const item of items) {
      const result = await Stock.findOneAndUpdate(
        {
          productId: item.id,
          size: item.size,
          color: item.color,
          quantity: { $gte: item.quantity }
        },
        { $inc: { quantity: -item.quantity } },
        { new: true, session }
      );

      if (!result) {
        throw new Error(`Stock insuficiente para ${item.id}-${item.size}-${item.color}`);
      }

      updates.push({
        id: item.id,
        size: item.size,
        color: item.color,
        newStock: result.quantity
      });
    }

    await session.commitTransaction();
    res.json({ success: true, updates });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, error: error.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;