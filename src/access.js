// Who may reach the customer pages.
//
// Set by the CUSTOMER_ACCESS environment variable:
//   unset / empty  — locked. Nobody can book; the pages say so. This is the
//                    default on purpose, so a deploy is never accidentally open.
//   open           — open to anyone with the link, as it was before.
//   anything else  — that word is the access code. Visitors need it once, as
//                    ?key=<word> on the link, and it's remembered in a cookie
//                    from then on. For showing the prototype to a few people.

const SETTING = (process.env.CUSTOMER_ACCESS || '').trim();

export const MODE = SETTING === '' ? 'locked' : SETTING === 'open' ? 'open' : 'code';
export const COOKIE = 'bs_access';

function cookieValue(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) {
      return decodeURIComponent(part.slice(at + 1).trim());
    }
  }
  return null;
}

// Timing-safe enough for a shared demo code: compare every character.
function sameCode(given) {
  if (typeof given !== 'string' || given.length !== SETTING.length) return false;
  let diff = 0;
  for (let i = 0; i < SETTING.length; i++) diff |= given.charCodeAt(i) ^ SETTING.charCodeAt(i);
  return diff === 0;
}

export function mayBook(req) {
  if (MODE === 'open') return true;
  if (MODE === 'locked') return false;
  return sameCode(req.query?.key) || sameCode(cookieValue(req, COOKIE));
}

// Remember a code that arrived on the link, so the rest of the visit works
// without it hanging off every URL.
export function rememberCode(req, res) {
  if (MODE !== 'code' || !sameCode(req.query?.key)) return;
  res.cookie(COOKIE, SETTING, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function requireBooking(req, res, next) {
  if (mayBook(req)) return next();
  res.status(403).json({ error: 'Booking is closed at the moment.', locked: true });
}
