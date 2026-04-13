'use strict';

export const USERS = [
  {
    name: 'Fred', email: 'fred@securbank.com', password: 'fred', groups: ['securbank.com'],
  },
  {
    name: 'Megan', email: 'megan@wknd.com', password: 'megan', groups: ['wknd.com'],
  },
  {
    name: 'Bill', email: 'bill@wknd.com', password: 'bill', groups: ['wknd.com'],
  },
];

/**
 * Validate credentials against the hardcoded user list.
 * @returns the matching user object (without password) or null.
 */
export function authenticate(email, password) {
  const user = USERS.find(
    (u) => u.email === email.toLowerCase().trim() && u.password === password,
  );
  if (!user) return null;
  const { password: _, ...userInfo } = user;
  return userInfo;
}
