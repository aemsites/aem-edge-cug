'use strict';

/**
 * Authentication via a custom login form with hardcoded users.
 *
 * The login page is an author-editable EDS page at /login containing a
 * login-form block. This module only handles redirects and POST validation.
 * - redirectToLogin: sends the browser to /login
 * - handleLoginPost: validates credentials and returns user info or a redirect
 */

import { authenticate } from './users.js';

/**
 * Redirect to the login page, preserving the original URL so the user
 * can be sent back after successful authentication.
 */
export function redirectToLogin(originalUrl) {
  const loginUrl = new URL('/login', originalUrl);
  loginUrl.searchParams.set('redirect', new URL(originalUrl).pathname);
  return Response.redirect(loginUrl.href, 302);
}

/**
 * Handle the POST from the login-form block.
 * Returns { userInfo, redirectUrl } on success, or a Response (redirect
 * back to /login with an error param) on failure.
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
    return redirectWithError(request, redirectPath, 'invalid');
  }

  if (!email || !password) {
    return redirectWithError(request, redirectPath, 'missing');
  }

  const user = authenticate(email, password);
  if (!user) {
    return redirectWithError(request, redirectPath, 'invalid');
  }

  return {
    userInfo: user,
    redirectUrl: redirectPath,
  };
}

function redirectWithError(request, redirectPath, error) {
  const url = new URL('/login', request.url);
  url.searchParams.set('redirect', redirectPath);
  url.searchParams.set('error', error);
  return Response.redirect(url.href, 302);
}
