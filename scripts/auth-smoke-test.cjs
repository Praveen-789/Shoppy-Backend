const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
(async () => {
  let server;
  const email = `auth-test-${Date.now()}@example.com`;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await User.init();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/me')).status, 401);
    assert.equal((await post('/register', { name: 'Test', email, password: 'short' })).status, 400);
    const registration = await post('/register', { name: 'Test', email, password: 'test-password-123' });
    assert.equal(registration.status, 201);
    const data = await registration.json();
    assert.equal(data.user.password, undefined);
    const stored = await User.findOne({ email }).select('+password');
    assert.notEqual(stored.password, 'test-password-123');
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    assert.match(registration.headers.get('set-cookie'), /HttpOnly/i);
    const session = await fetch(base + '/me', { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.deepEqual((await session.json()).user, { id: stored.id, name: 'Test', email, role: 'user' });
    assert.equal((await post('/register', { name: 'Test', email, password: 'test-password-123' })).status, 409);
    assert.equal((await post('/login', { email, password: 'wrong' })).status, 401);
    const login = await post('/login', { email: email.toUpperCase(), password: 'test-password-123' });
    assert.equal(login.status, 200);
    assert.deepEqual((await login.json()).user, { id: stored.id, name: 'Test', email, role: 'user' });
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    const loginCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/me', { headers: { Cookie: loginCookie } })).status, 200);
    assert.equal((await fetch(base + '/me', { headers: { Cookie: 'authToken=invalid' } })).status, 401);
    assert.equal((await post('/logout', {}, { Origin: 'https://other.example' })).status, 403);
    const logout = await post('/logout', {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
    console.log('PASS: registration, hashing, duplicate email, login, cookies, protected route, invalid JWT, origin check, logout');
  } finally {
    if (mongoose.connection.readyState === 1) await User.deleteOne({ email });
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

