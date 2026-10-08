// One rule for picture links, on both sides. The API applies it when a creator or an admin saves a link, and the
// website applies it again before a link is ever put in a page, so a hostile answer from the API changes nothing.
//
// A link is https://, ipfs:// or ar://, written in plain characters (anything else percent-encoded), at most 500
// long. A web link must point to an ordinary public host: a domain name, the standard port, no user name or
// password. Pictures are loaded by visitors' browsers, so "localhost", bare IP addresses and other ports are
// refused: they could reach a device on the visitor's own network.

const HTTPS = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]{4,492}$/;
const IPFS = /^ipfs:\/\/(ipfs\/)?[A-Za-z0-9]{40,120}(\/[A-Za-z0-9._~!$&()*+,;=:@%-]+)*\/?(\?[A-Za-z0-9._~=&%-]*)?$/;
const AR = /^ar:\/\/[A-Za-z0-9_-]{10,64}(\/[A-Za-z0-9._~-]+)*\/?$/;
const PUBLIC_NAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const PRIVATE_HOST = /(^|\.)(localhost|localdomain|local|internal|intranet|private|corp|lan|home|arpa|test|invalid|example|onion)$/;
const UP_A_FOLDER = /(^|\/)\.{1,2}(\/|\?|#|$)/;
const ENCODED_TRICK = /%(2e|2f|5c|00)/i;

/** True when a web address points to an ordinary public host (see the note at the top). */
export function isPublicWebUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443' && u.port !== '80') return false;
  const host = u.hostname.toLowerCase();
  return PUBLIC_NAME.test(host) && !PRIVATE_HOST.test(host);
}

/** A link a creator may save as a logo, banner, extra image or About picture. The API checks the same rule. */
export function isAcceptedImageLink(link: string): boolean {
  const s = link.trim();
  if (!s || s.length > 500 || !(HTTPS.test(s) || IPFS.test(s) || AR.test(s))) return false;
  if (UP_A_FOLDER.test(s.replace(/^[a-z]+:\/\//, '')) || ENCODED_TRICK.test(s)) return false;
  if (s.startsWith('https://')) {
    if (s.slice(8).split(/[/?#]/)[0].includes('@')) return false;
    try { if (new URL(s).port && new URL(s).port !== '443') return false; } catch { return false; }
    return isPublicWebUrl(s);
  }
  return true;
}

/**
 * What the website is willing to load as a picture or video, from any source (collection details, NFT metadata):
 * files of the site itself, pictures embedded in the metadata, and links to public hosts. Everything else is
 * replaced by the generated artwork.
 */
export function isLoadableMedia(src: unknown): src is string {
  if (typeof src !== 'string' || !src || src.length > 2_000_000) return false;
  if (/^data:(image|video)\//i.test(src) || src.startsWith('blob:')) return true;
  if (/^\/(?!\/)/.test(src)) return true; // a file of this website
  if (/^(ipfs|ar):\/\//i.test(src)) return true; // opened through a public gateway
  return isPublicWebUrl(src);
}
