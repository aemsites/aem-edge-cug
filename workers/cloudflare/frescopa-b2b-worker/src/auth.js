'use strict';

/**
 * Authentication via a custom login form with hardcoded users.
 *
 * Replaces the OAuth/PKCE flow from cug-cloudflare-worker.
 * - redirectToLogin: sends the browser to the login form
 * - serveLoginForm: returns the HTML login page
 * - handleLoginPost: validates credentials and returns user info or an error
 */

import { authenticate } from './users.js';

/**
 * Redirect to the login form, preserving the original URL so the user
 * can be sent back after successful authentication.
 */
export function redirectToLogin(originalUrl) {
  const loginUrl = new URL('/auth/login', originalUrl);
  loginUrl.searchParams.set('redirect', new URL(originalUrl).pathname);
  return Response.redirect(loginUrl.href, 302);
}

/**
 * Render the HTML login form. If an error message is provided it is shown
 * above the form fields.
 */
export function serveLoginForm(request, error = '') {
  const url = new URL(request.url);
  const redirect = url.searchParams.get('redirect') || '/';

  const errorHtml = error
    ? `<div class="error" role="alert">${escapeHtml(error)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign In — Frescopa B2B</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f5f1eb;
      color: #2c1810;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(44, 24, 16, 0.10);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 400px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .subtitle {
      color: #6b5c52;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 0.35rem;
    }
    input[type="email"],
    input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid #d4ccc5;
      border-radius: 6px;
      font-size: 1rem;
      margin-bottom: 1rem;
      transition: border-color 0.15s;
    }
    input:focus {
      outline: none;
      border-color: #8b6f47;
      box-shadow: 0 0 0 3px rgba(139, 111, 71, 0.15);
    }
    button {
      width: 100%;
      padding: 0.7rem;
      background: #8b6f47;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #725a3a; }
    .error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Frescopa B2B</h1>
    <p class="subtitle">Sign in to your account</p>
    ${errorHtml}
    <form method="POST" action="/auth/login?redirect=${encodeURIComponent(redirect)}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autocomplete="email" autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: error ? 401 : 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Handle the POST from the login form.
 * Returns { userInfo, redirectUrl } on success, or a Response (the form
 * with an error message) on failure.
 */
export async function handleLoginPost(request) {
  const url = new URL(request.url);
  const redirectPath = url.searchParams.get('redirect') || '/';

  let email = '';
  let password = '';
  try {
    const formData = await request.formData();
    email = formData.get('email') || '';
    password = formData.get('password') || '';
  } catch {
    return serveLoginForm(request, 'Invalid form submission.');
  }

  if (!email || !password) {
    return serveLoginForm(request, 'Email and password are required.');
  }

  const user = authenticate(email, password);
  if (!user) {
    return serveLoginForm(request, 'Invalid email or password.');
  }

  return {
    userInfo: user,
    redirectUrl: redirectPath,
  };
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
