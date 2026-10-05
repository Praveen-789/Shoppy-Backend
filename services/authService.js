const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Only these fields may leave the service; never return a password hash.
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role || 'user' };
}

async function registerUser({ name, email, password, role = 'user' }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.findOne({ email: normalizedEmail })) return null;
  try {
    const user = await User.create({
      name: name.trim(),
      role,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
    });
    return publicUser(user);
  } catch (error) {
    // Two registrations can pass the initial check at the same time.
    if (error.code === 11000) return null;
    throw error;
  }
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) return null;
  return publicUser(user);
}

function createSessionToken(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, { subject: userId, expiresIn: '1d', algorithm: 'HS256' });
}

async function getUserFromToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const user = await User.findById(payload.sub);
  return user ? publicUser(user) : null;
}

module.exports = { registerUser, loginUser, createSessionToken, getUserFromToken };
