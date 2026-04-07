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
    const userGroups = await getUserGroups();
    if (!userGroups?.length) { el.remove(); return; }

    const path = getFragmentPath(userGroups);
    if (!path) { el.remove(); return; }

    const fragment = await loadFragment(path);
    if (!fragment) { el.remove(); return; }

    el.textContent = '';
    el.append(fragment);
  } catch {
    el.remove();
  }
}
