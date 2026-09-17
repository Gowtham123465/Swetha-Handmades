# Swetha Handmades — Firebase Integrated Build

This version connects the existing Swetha Handmades React/Vite storefront to Firebase Authentication, Firestore and Cloud Storage while keeping the existing UI.

## Firebase features included
- Email/password customer signup and login
- Firebase session persistence
- Firestore user profiles with `isAdmin`
- Firestore-backed products, categories and store/payment settings
- Firebase Storage for product images and payment QR
- Authenticated customer orders stored in Firestore
- Customer photo uploads stored in Firebase Storage
- Admin login protected by the Firestore `users/{uid}.isAdmin` flag
- Admin product/category/order/settings operations
- Firestore and Storage security rules
- Firebase Hosting configuration

## Existing admin account
The build expects the existing Firebase Authentication user to have a Firestore document:

`users/{AUTH_USER_UID}`

with:

`isAdmin: true`

## Install and run

```bash
npm install
npm run dev
```

## Deploy rules

```bash
npx firebase-tools deploy --only firestore:rules,storage
```

## Deploy website

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Important
Guest checkout remains available locally. To store an order in Firestore, the customer signs in first. This is intentional because the security rules require an authenticated user to create a cloud order.
