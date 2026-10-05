const authService = require('../services/authService');

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' };

function startSession(response, user) {
  const token = authService.createSessionToken(user.id);
  response.cookie('authToken', token, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 });
}

async function register(request, response) {
  const { name, email, password, role = 'user' } = request.body || {};
  if (!['user', 'vendor'].includes(role)) return response.status(400).json({ message: 'Choose user or vendor.' });
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return response.status(400).json({ message: 'Enter a name between 1 and 80 characters.' });
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return response.status(400).json({ message: 'Enter a valid email address.' });
  // bcrypt uses at most 72 bytes. Reject longer passwords instead of truncating them.
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ message: 'Password must contain at least 8 characters and at most 72 bytes.' });

  const user = await authService.registerUser({ name, email, password, role });
  if (!user) return response.status(409).json({ message: 'An account with this email already exists.' });
  startSession(response, user);
  response.status(201).json({ message: 'Account created.', user });
}

async function login(request, response) {
  const { email, password } = request.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !password || email.length > 254 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ message: 'Enter your email and password.' });

  const user = await authService.loginUser({ email, password });
  if (!user) return response.status(401).json({ message: 'Email or password is incorrect.' });
  startSession(response, user);
  response.json({ message: 'Signed in.', user });
}

function getCurrentUser(request, response) {
  response.json({ user: request.user });
}

function logout(request, response) {
  response.clearCookie('authToken', cookieOptions);
  response.json({ message: 'Signed out.' });
}

module.exports = { register, login, getCurrentUser, logout };
