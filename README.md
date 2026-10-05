# Shoppy backend

A simple Node.js server using Express to define routes and send JSON responses.

## Run

Use Node.js 22 or later. Create a `.env` file in the project folder with your
MongoDB connection string (keep this file private):

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/shoppy
```

Use your MongoDB Atlas connection string instead if your database is hosted there.
The server loads `.env` automatically and starts listening after MongoDB connects.

From a terminal:

```powershell
cd D:\Shoppy\shoppy-node
npm install
npm start
```

Open http://localhost:5000 to see the welcome message, or
http://localhost:5000/api/health to check that the server is running.
Press Ctrl+C in the terminal to stop it.

During development, use `npm run dev` instead of `npm start`. Nodemon watches
your backend files and restarts the server when you save changes.

Mongoose connects to MongoDB using `MONGO_URI` and can define models for data
such as users and products.

## How it works

- `require('express')` loads Express.
- `express()` creates our app.
- `app.use(express.json())` parses incoming JSON bodies into `request.body`.
- `app.get(...)` defines a route that accepts GET requests.
- `response.json(...)` sends JSON back, with status 200 by default.
- The final `app.use(...)` sends status 404 for unmatched requests.
- `listen` starts accepting requests on port 5000.
- Status 200 means success; 404 means the route was not found.

The server runs locally and connects to MongoDB. Authentication is implemented.

## Authentication

Follow `routes/auth.js` → `controllers/authController.js` → `services/authService.js` → `models/User.js`.

- Routes connect URLs to controllers and apply rate limiting or session middleware.
- The controller validates HTTP input, sets or clears cookies, and sends responses.
- The service handles user queries, password hashing/comparison, and JWT creation/verification.
  It returns only the public user fields (`id`, `name`, `email`, `role`), never password hashes.
  Registration returns null for duplicate emails; login returns null for incorrect credentials.
  The controller converts those outcomes to the existing 409 and 401 responses.
- `middleware/auth.js` reads the cookie and calls the service to look up the current user.
  It attaches those public user fields to `request.user` for protected handlers.

- POST `/api/auth/register`: JSON `{ "name": "Sam", "email": "sam@example.com", "password": "a-long-password" }`. Creates the user and signs them in.
- POST `/api/auth/login`: JSON `{ "email": "sam@example.com", "password": "a-long-password" }`.
- GET `/api/auth/me`: returns the signed-in user, or 401.
- POST `/api/auth/logout`: clears the browser cookie.

Passwords are hashed with bcrypt. The JWT is stored in an HTTP-only cookie for one day; frontend JavaScript cannot read it. Responses never include the password hash. Login and registration allow 30 attempts per IP per 15 minutes.

Set MONGO_URI and a random JWT_SECRET (at least 32 characters) in `.env`; see `.env.example`. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Keep `.env` out of Git. The existing local `.env` has been given a generated secret if one was absent.

Start MongoDB, run `npm run dev` in this backend, then run `npm run dev` in `../shoppy-react-app`. Open http://localhost:5100 (the port configured in Vite). Set FRONTEND_ORIGIN=http://localhost:5100 in the backend `.env`. Vite proxies `/api` to port 5000. Create an account, refresh to check the session, sign out, and sign back in.

For deployment, serve the frontend and `/api` on the same origin, set FRONTEND_ORIGIN to that origin, and set NODE_ENV=production with HTTPS. The development proxy is not part of the production build.

This learning implementation does not include password recovery, email verification, or server-side session revocation. Logout clears this browser's cookie; a copied token stays valid until its one-day expiry. The rate limiter is in memory and resets when the server restarts.

Run `npm run test:auth` for the API integration checks. It uses the configured MongoDB, creates a temporary test account, and removes that account afterward.

## Products

### Cloudinary setup

Configuration: `config/cloudinary.js`. Upload/delete helpers: `services/cloudinaryService.js`.
Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_KEY`, and `CLOUDINARY_SECRET` in `.env` only.
The longer `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` names are also supported.
Keep real credentials out of `.env.example`.

A Media Library User key needs folder access. For one-time setup, add an admin key
from the same product environment as `CLOUDINARY_SETUP_API_KEY` and
`CLOUDINARY_SETUP_API_SECRET` in `.env`. Run `npm run setup:cloudinary` to create/find
`shoppy/products` and grant the application key Editor access. Remove both setup
variables afterward. The application never uses the setup credentials.

`npm run check:cloudinary` uploads and deletes a tiny test image using the application
key. A 403 means access was denied. These are live Cloudinary operations.
The vendor form uses these helpers. Only the owning vendor may upload an image.
The last live check returned 403; configure the folder permission before expecting
uploads to succeed. Automated vendor tests mock Cloudinary; they do not verify live access.

### Product API

Follow `routes/products.js` → `controllers/productController.js` → `services/productService.js` → `models/Product.js`. Routes connect URLs to controller functions. Controllers validate HTTP input and send responses. Services build filters, run MongoDB queries, and return data without Express objects. The model describes product
name, unique slug, description, price in INR, category, optional image URL, and
stock (a nonnegative whole number).

- GET `/api/products?page=1&limit=12&search=mug&category=Home` returns
  `{ products: [...], categories: [...], pagination: { page, limit, total, hasMore } }`,
  newest first. All parameters are optional; the default limit is 12 (maximum 48).
  Search matches name or description as case-insensitive literal text.
- GET `/api/products/:id` returns `{ product: {...} }`; invalid IDs return 400
  and missing products return 404. Browsing these endpoints does not require login.

Run `npm run seed:products` to add six sample products to the configured database.
Running it again skips existing sample slugs without changing prices or stock.
Images start empty; the frontend displays letter artwork as a fallback.
After signing in, the frontend displays the catalog with search and category
filters. Filtering runs in MongoDB across the whole catalog. The frontend loads
12 products initially and another 12 when you click Load more. Search waits
300 milliseconds after typing; changing filters restarts at page 1. Images use
native browser lazy loading. Failed later pages can be retried without clearing
the products already displayed. Sorting and category queries have supporting
indexes. For very large catalogs, consider cursor pagination and a search index;
page offsets and literal substring searches still do more work as data grows.
Vendors can create/edit products in My Products. The frontend cart is implemented; checkout is a future step.

## Vendor marketplace

Signup accepts `role: "user"` (default) or `role: "vendor"`. Roles are fetched from
MongoDB for every authenticated request. For this learning project vendor signup
is self-service; add vendor approval before opening a public marketplace.
Existing users keep the user role; create a vendor account through signup to sell.

The frontend vendor dashboard offers Add product, editing, Save draft, Publish
product, and Unpublish and save draft. Vendors can browse the shop too. Images
are optional, with a preview and a 5 MB JPEG/PNG/WebP limit. A selected image is
uploaded after saving a draft, then publishing occurs only if the upload succeeds.
If an upload fails, the saved draft remains available to edit and retry.

Vendor API routes (all require a vendor session):

- GET `/api/vendor/products?page=1`: the vendor's own products, 12 per page.
- POST `/api/vendor/products`: create from name, description, category, price,
  stock, and status (`draft` or `published`). Ownership comes from the session.
- PUT `/api/vendor/products/:id`: update the same fields on an owned product.
- POST `/api/vendor/products/:id/image`: raw JPEG/PNG/WebP bytes with the appropriate
  image Content-Type; validates size and file signature, then Cloudinary decodes it.

Public product routes return only published products with assigned vendors. Seller
names are included; emails and Cloudinary public IDs are excluded. Missing or
another vendor's products return 404 on editing. Ordinary users receive 403.
Image replacement cleans up old Cloudinary assets; if cleanup fails its public ID
is logged for manual cleanup. No API secrets are logged by the upload controller.

Run `npm run migrate:vendors` once for existing data (safe to repeat). It fills in
missing user roles and product statuses without assigning any vendor ownership.
The six sample products remain drafts until deliberately assigned to a vendor.
Run `npm run test:vendor` for ownership, publishing, visibility, validation, origin,
and mocked image upload checks. Temporary test accounts/products are removed.

Checkout, orders, buyer details, and vendor sales reporting are not implemented yet.

Run `npm run test:products` for validation and API checks. It creates one temporary
products in the configured database and removes them afterward.



## Account carts
Authenticated endpoints: GET /api/cart, POST /api/cart/items (productId),
PATCH /api/cart/items/:id (quantity), DELETE /api/cart/items/:id, DELETE /api/cart.
The item route ID is cartItemId from the response. Account identity comes from the
session cookie. CartItem stores user, product and quantity; responses use current
published product information. Startup initializes the unique user/product index.
Run npm run test:cart for persistence, ownership and stock checks.
