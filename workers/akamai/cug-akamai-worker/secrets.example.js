/**
 * Bundled secrets for the CUG EdgeWorker.
 *
 * Copy this file to secrets.js and fill in the actual values:
 *   cp secrets.example.js secrets.js
 *
 * secrets.js is gitignored and must never be committed.
 * To rotate secrets, update secrets.js and deploy a new EdgeWorker version.
 */
const secrets = {
  OAUTH_CLIENT_SECRET: 'REPLACE_ME',
  JWT_SECRET: 'REPLACE_ME',
  ORIGIN_AUTHENTICATION: '',
};

export default secrets;
