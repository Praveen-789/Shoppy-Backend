const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const app = express();
const PORT = process.env.PORT || 5000;
const logs = require('./services/logWriter')();
// Register before body parsing so malformed requests are traced too.
app.use(require('./middleware/requestLogger')(logs.write));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/api', (request, response, next) => {
  const origin = request.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== (process.env.FRONTEND_ORIGIN || 'http://localhost:5100')) {
    return response.status(403).json({ message: 'Request origin is not allowed.' });
  }
  next();
});
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/vendor', require('./routes/vendor'));
app.use('/api/products', require('./routes/products'));
// Vite proxies /api to this server so cookies stay on the frontend origin.
app.use('/api/auth', (request, response, next) => {
  response.set('Cache-Control', 'no-store');
  const origin = request.get('origin');
  if (request.method !== 'GET' && origin && origin !== (process.env.FRONTEND_ORIGIN || 'http://localhost:5100')) {
    return response.status(403).json({ message: 'Request origin is not allowed.' });
  }
  next();
}, authRoutes);
app.get('/', (request, response) => response.json({ message: 'Welcome to the Shoppy backend!' }));
app.get('/api/health', (request, response) => response.json({ status: 'ok', message: 'Server is running' }));
app.use((request, response) => response.status(404).json({ message: 'Route not found' }));
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return response.status(400).json({ message: 'Invalid JSON body.' });
  if (error.type === 'entity.too.large') return response.status(413).json({ message: 'Request body is too large.' });
  // Keep raw error messages out of logs: database errors can include private data.
  logs.write(JSON.stringify({ timestamp: new Date().toISOString(), event: 'request_error', requestId: request.id, errorType: error.name || 'Error' }));
  response.status(500).json({ message: 'Something went wrong. Please try again.', requestId: request.id });
});
async function startServer() {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing. Set it in .env.');
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters.');
    await mongoose.connect(process.env.MONGO_URI);
    // Ensure the unique email index exists before accepting registrations.
    await require('./models/User').init();
    await require('./models/CartItem').init();
    await require('./models/Order').init();
    console.log('MongoDB connected!');
    const server = app.listen(PORT, '127.0.0.1', () => console.log(`Shoppy backend is running at http://localhost:${PORT}`));
    server.on('error', (error) => { console.error('Server failed:', error.message); process.exitCode = 1; });
  } catch (error) {
    console.error('Startup failed:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  }
}
if (require.main === module) startServer();
module.exports = app;

