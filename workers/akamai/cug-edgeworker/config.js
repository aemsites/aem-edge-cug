import secrets from './secrets.js';

const config = {
  ORIGIN_HOSTNAME: 'main--aem-edge-cug-akamai--aemsites.aem.live',
  OAUTH_AUTHORIZE_URL: 'https://ims-na1.adobelogin.com/ims/authorize/v2',
  OAUTH_TOKEN_URL: 'https://ims-na1.adobelogin.com/ims/token/v3',
  OAUTH_LOGOUT_URL: 'https://ims-na1.adobelogin.com/ims/logout/v1',
  OAUTH_REDIRECT_URI: 'https://aem-edge-cug-akamai.adobe.com/auth/callback',
  OAUTH_SCOPE: 'openid,AdobeID,email,profile',
  OAUTH_CLIENT_ID: 'aem-sites-akamai-cug',
};

export function getSecrets() {
  return secrets;
}

export default config;
