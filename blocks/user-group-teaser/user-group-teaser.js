import { loadFragment } from '../fragment/fragment.js';

const GROUP_FRAGMENTS = {
  'adobe.com': '/members/adobe/teaser',
  'gmail.com': '/members/gmail/teaser',
};

async function getUserGroups() {
  const resp = await fetch('/auth/me');
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.authenticated ? data.groups : null;
}

function getFragmentPath(userGroups) {
  const match = userGroups.find((group) => GROUP_FRAGMENTS[group]);
  return match ? GROUP_FRAGMENTS[match] : null;
}

export default async function decorate(el) {
  try {
    el.textContent = '';
    const heading = document.createElement('p');
    heading.textContent = 'Block-level authorization sample.';
    el.append(heading);

    const userGroups = await getUserGroups();
    if (!userGroups?.length) {
      const msg = document.createElement('p');
      msg.textContent = 'This is the teaser for anonymous users.';
      el.append(msg);
      return;
    }

    const path = getFragmentPath(userGroups);
    if (!path) return;

    const fragment = await loadFragment(path);
    if (fragment) el.append(fragment);
  } catch {
    el.remove();
  }
}
