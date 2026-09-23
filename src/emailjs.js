// EmailJS order-notification settings.
// 1. Create a free account at https://www.emailjs.com
// 2. Add an Email Service (e.g. Gmail) — copy its Service ID below.
// 3. Create an Email Template with variables: order_id, customer_name, customer_mobile, customer_address, order_total, order_items, to_email — copy its Template ID below.
// 4. Copy your Public Key from Account > General.
// 5. Replace NOTIFY_EMAIL with the email address that should receive new-order alerts.
// Until these are filled in, orders still place normally — email notifications are simply skipped.
export const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
export const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
export const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
export const NOTIFY_EMAIL = 'YOUR_EMAIL@example.com';
