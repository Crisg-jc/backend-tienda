require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mitienda')
  .then(() => {
    console.log("📦 Conectado a MongoDB");

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
    });
  })
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));


// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Modelo de Usuario
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

// Modelo de Producto
const ProductSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, required: true },
  category: { type: String, required: true },
  productType: { 
    type: String, 
    enum: ['clothing', 'accessory', 'gloves', 'kneepads'], 
    required: true 
  },
  stock: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
});

// Modelo de Orden
const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    idNumber: { type: String, required: true },
    phone: { type: String, required: true },
    address: {
      street: { type: String, required: true },
      neighborhood: { type: String, required: true },
      district: { type: String, required: true },
      city: { type: String, required: true }
    }
  },
  items: [{
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    size: String,
    color: String,
    image: String
  }],
  subtotal: { type: Number, required: true },
  shipping: { type: Number, required: true },
  total: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);

// Middleware de autenticación
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No autorizado' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('✅ API funcionando correctamente');
});

// Ruta para obtener información del usuario autenticado
app.get('/api/user', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    res.json({ email: user.email });
  } catch (error) {
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Ruta para cerrar sesión
app.post('/api/logout', authenticate, (req, res) => {
  res.json({ message: 'Sesión cerrada correctamente' });
});

// Ruta para obtener el stock de un producto
app.get('/api/products/:id/stock', async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
    if (!product) return res.status(404).send('Producto no encontrado');
    
    let formattedStock;
    
    switch(product.productType) {
      case 'clothing':
        formattedStock = product.stock;
        break;
      case 'accessory':
        formattedStock = { 
          default: { 
            quantity: typeof product.stock === 'number' ? product.stock : product.stock.default?.quantity || 0 
          } 
        };
        break;
      case 'gloves':
      case 'kneepads':
        if (Array.isArray(product.stock)) {
          formattedStock = {};
          product.stock.forEach(item => {
            const size = item.size?.toUpperCase() || 'UNICA';
            formattedStock[size] = { quantity: item.quantity };
          });
        } else if (typeof product.stock === 'object' && !Array.isArray(product.stock)) {
          formattedStock = {};
          Object.entries(product.stock).forEach(([size, value]) => {
            const sizeKey = size.toUpperCase();
            formattedStock[sizeKey] = {
              quantity: typeof value === 'object' ? value.quantity : value
            };
          });
        } else {
          formattedStock = { 'UNICA': { quantity: product.stock } };
        }
        break;
      default:
        formattedStock = product.stock;
    }
    
    res.json(formattedStock);
  } catch (err) {
    console.error('Error en /api/products/:id/stock:', err);
    res.status(500).send('Error del servidor');
  }
});

// Ruta para actualizar el stock
app.post('/api/products/:id/update-stock', authenticate, async (req, res) => {
  try {
    const { size, color, quantity } = req.body;
    const product = await Product.findOne({ id: req.params.id });
    
    if (!product) return res.status(404).send('Producto no encontrado');
    
    let updated = false;
    
    switch(product.productType) {
      case 'clothing':
        if (!size || !color) {
          return res.status(400).send('Se requieren talla y color');
        }
        const key = `${size}-${color}`;
        if (product.stock[key]) {
          product.stock[key].quantity -= quantity;
          
          if (product.stock[key].quantity < 0) {
            return res.status(400).send('No hay suficiente stock');
          }
          
          updated = true;
        }
        break;
      case 'accessory':
        if (typeof product.stock === 'number') {
          product.stock -= quantity;
          if (product.stock < 0) {
            return res.status(400).send('No hay suficiente stock');
          }
          updated = true;
        } else if (product.stock.default) {
          product.stock.default.quantity -= quantity;
          if (product.stock.default.quantity < 0) {
            return res.status(400).send('No hay suficiente stock');
          }
          updated = true;
        }
        break;
      case 'gloves':
      case 'kneepads':
        const sizeKey = size?.toUpperCase() || 'UNICA';
        
        if (Array.isArray(product.stock)) {
          const itemIndex = product.stock.findIndex(item => 
            (item.size?.toUpperCase() === sizeKey) || 
            (item.talla?.toUpperCase() === sizeKey)
          );
          
          if (itemIndex !== -1) {
            product.stock[itemIndex].quantity -= quantity;
            if (product.stock[itemIndex].quantity < 0) {
              return res.status(400).send('No hay suficiente stock');
            }
            updated = true;
          }
        } else if (typeof product.stock === 'object') {
          if (product.stock[sizeKey]) {
            const currentQuantity = typeof product.stock[sizeKey] === 'object' 
              ? product.stock[sizeKey].quantity 
              : product.stock[sizeKey];
            
            const newQuantity = currentQuantity - quantity;
            
            if (newQuantity < 0) {
              return res.status(400).send('No hay suficiente stock');
            }
            
            product.stock[sizeKey] = typeof product.stock[sizeKey] === 'object'
              ? { ...product.stock[sizeKey], quantity: newQuantity }
              : newQuantity;
              
            updated = true;
          }
        } else if (typeof product.stock === 'number') {
          product.stock -= quantity;
          if (product.stock < 0) {
            return res.status(400).send('No hay suficiente stock');
          }
          updated = true;
        }
        break;
    }
    
    if (updated) {
      await product.save();
      res.json({ success: true });
    } else {
      res.status(400).send('No se pudo actualizar el stock');
    }
  } catch (err) {
    console.error('Error en /api/products/:id/update-stock:', err);
    res.status(500).send('Error del servidor');
  }
});

// Ruta para guardar la orden en la base de datos
app.post('/api/orders', authenticate, async (req, res) => {
  try {
    const { orderData } = req.body;
    
    // Crear nueva orden
    const order = new Order({
      orderId: orderData.orderId,
      userId: req.userId,
      customer: {
        name: orderData.customer.name,
        email: orderData.customer.email,
        idNumber: orderData.customer.id,
        phone: orderData.customer.phone,
        address: {
          street: orderData.customer.address.street,
          neighborhood: orderData.customer.address.neighborhood,
          district: orderData.customer.address.district,
          city: orderData.customer.address.city
        }
      },
      items: orderData.items.map(item => ({
        productId: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        image: item.image
      })),
      subtotal: orderData.subtotal,
      shipping: orderData.shipping,
      total: orderData.total
    });

    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error guardando orden:', error);
    res.status(500).json({ message: 'Error al guardar la orden' });
  }
});

// Ruta para enviar confirmación de pedido por correo
app.post('/api/send-order-confirmation', authenticate, async (req, res) => {
  try {
    const order = req.body;
    
    // Función para formatear números
    const formatNumber = (num) => new Intl.NumberFormat('es-CO').format(num);
    
    // Crear HTML para el correo
    const itemsHtml = order.items.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">
          <img src="${item.image}" alt="${item.name}" width="50" style="margin-right: 10px;">
          ${item.name} ${item.size ? `(${item.size})` : ''}
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">$${formatNumber(item.price)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">$${formatNumber(item.price * item.quantity)}</td>
      </tr>
    `).join('');
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
        <h2 style="color: #d32f2f; text-align: center;">¡Gracias por tu compra en MiTienda!</h2>
        <p>Hola ${order.customer.name},</p>
        <p>Hemos recibido tu pedido correctamente. Aquí están los detalles:</p>
        
        <h3 style="margin-top: 20px;">Detalles del pedido #${order.orderId}</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Producto</th>
              <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Cantidad</th>
              <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Precio</th>
              <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
            <tr>
              <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">Subtotal:</td>
              <td style="padding: 8px; text-align: right;">$${formatNumber(order.subtotal)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">Envío:</td>
              <td style="padding: 8px; text-align: right;">$${formatNumber(order.shipping)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">Total:</td>
              <td style="padding: 8px; text-align: right; font-weight: bold;">$${formatNumber(order.total)}</td>
            </tr>
          </tbody>
        </table>
        
        <h3 style="margin-top: 20px;">Información de envío</h3>
        <p>
          ${order.customer.address.street}, ${order.customer.address.neighborhood}<br>
          ${order.customer.address.district}, ${order.customer.address.city}<br>
          Teléfono: ${order.customer.phone}
        </p>
        
        <p style="margin-top: 20px;">Fecha del pedido: ${new Date(order.date).toLocaleDateString('es-CO', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</p>
        
        <p style="margin-top: 30px; font-size: 0.9em; color: #777;">
          Si tienes alguna pregunta sobre tu pedido, por favor contáctanos respondiendo a este correo.
        </p>
      </div>
    `;
    
    // Enviar el correo
    await transporter.sendMail({
      from: `"MiTienda" <${process.env.EMAIL_USER}>`,
      to: order.customer.email,
      subject: `Confirmación de tu pedido #${order.orderId}`,
      html: emailHtml
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error enviando correo de confirmación:', error);
    res.status(500).json({ message: 'Error enviando correo de confirmación' });
  }
});

// Ruta para crear/actualizar productos (útil para pruebas)
app.post('/api/products', authenticate, async (req, res) => {
  try {
    const { id, name, price, image, category, productType, stock } = req.body;
    
    let product = await Product.findOne({ id });
    
    if (product) {
      product.name = name;
      product.price = price;
      product.image = image;
      product.category = category;
      product.productType = productType;
      product.stock = stock;
    } else {
      product = new Product({
        id,
        name,
        price,
        image,
        category,
        productType,
        stock
      });
    }
    
    await product.save();
    res.json(product);
  } catch (err) {
    console.error('Error en /api/products:', err);
    res.status(500).send('Error del servidor');
  }
});

// Ruta de registro
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'Usuario creado exitosamente' });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar usuario' });
  }
});

// Ruta de login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ token, userId: user._id });
  } catch (error) {
    res.status(500).json({ message: 'Error al iniciar sesión' });
  }
});

// Ruta para olvidó contraseña
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Usuario no encontrado' });
    }

    const resetToken = jwt.sign({ userId: user._id }, process.env.RESET_SECRET || 'reset_secreto', { expiresIn: '1h' });

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `http://localhost:3000/reset-password.html?token=${resetToken}`;

    await transporter.sendMail({
      from: `"Soporte de la App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Restablece tu contraseña',
      html: `
        <h3>Hola</h3>
        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para continuar:</p>
        <a href="${resetLink}" target="_blank">Restablecer contraseña</a>
        <p>Este enlace expirará en 1 hora.</p>
      `
    });

    res.json({ message: 'Se ha enviado un enlace para resetear tu contraseña al correo registrado.' });
  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({ message: 'Error al procesar la solicitud' });
  }
});