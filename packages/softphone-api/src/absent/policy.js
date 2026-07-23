/**
 * @param {{
 *   subscriber?: { absentAnnounce?: boolean } | null,
 *   softphoneOnline: boolean,
 *   jsepOffer?: { sdp?: string } | null,
 * }} p
 */
export function shouldAnnounce(p) {
  if (p.softphoneOnline) return false;
  if (!p.subscriber?.absentAnnounce) return false;
  if (!p.jsepOffer?.sdp) return false;
  return true;
}
