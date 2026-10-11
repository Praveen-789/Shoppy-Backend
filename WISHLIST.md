# Wishlist walkthrough

A wishlist saves products for later; it does not reserve stock or change the cart.
Users and vendors can save published products, including sold-out products.

1. The product Save button calls the Zustand wishlist store.
2. POST /api/wishlist/items sends only productId. Authentication supplies the user.
3. The service checks publication and saves a WishlistItem with a unique user/product index.
4. The API returns current prices, stock and seller names, without seller emails.
5. React updates after success. Failed requests keep the previous list.

GET /api/wishlist loads the account list. DELETE /api/wishlist/items/:id removes an
owned row and is safe to repeat. Duplicate saves are also safe to repeat.
Unavailable or deleted products remain removable without exposing draft details.

AuthProvider loads the account wishlist on login/session restoration and clears memory
on logout. The store ignores responses from older sessions and older reads. MongoDB
persists the list across devices. Opening Wishlist, focusing its window, or clicking
Refresh wishlist reloads it. Updates are not pushed live between devices.

Adding to cart keeps the wishlist item saved and uses the existing cart stock checks.

Run npm run test:wishlist in both projects, plus frontend npm run build and npm run lint.
The backend smoke test creates temporary accounts/products and cleans them up.
