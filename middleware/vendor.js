function requireVendor(request, response, next) {
  if (request.user.role !== 'vendor') return response.status(403).json({ message: 'A vendor account is required.' });
  next();
}
module.exports = requireVendor;
