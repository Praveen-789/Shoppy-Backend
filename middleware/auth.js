const authService = require('../services/authService');

async function requireAuth(request, response, next) {
  try {
    const token = request.cookies.authToken;
    if (!token) return response.status(401).json({ message: 'Please sign in.' });
    const user = await authService.getUserFromToken(token);
    if (!user) return response.status(401).json({ message: 'Please sign in again.' });
    request.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return response.status(401).json({ message: 'Your session expired. Please sign in again.' });
    }
    next(error);
  }
}

module.exports = requireAuth;
