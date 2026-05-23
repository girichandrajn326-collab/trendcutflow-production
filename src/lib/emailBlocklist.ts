// Disposable/temporary email domain blocklist to protect Free Tier from bot abuse
const BLOCKED_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net',
  'guerrillamail.org', 'spam4.me', 'trashmail.com', 'trashmail.me',
  'trashmail.net', 'trashmail.at', 'trashmail.io', 'trashmail.xyz',
  'dispostable.com', 'fakeinbox.com', 'mailnull.com', 'spamgourmet.com',
  'maildrop.cc', 'mailnesia.com', 'mailnull.com', 'spamex.com',
  'tempr.email', 'tmpeml.com', 'throwam.com', 'throwem.away.com',
  'getnada.com', 'nada.ltd', 'temp-mail.org', 'tempinbox.com',
  '10minutemail.com', '20minutemail.com', 'disposablemail.com', 'discard.email',
  'mailtemp.net', 'spamfree24.org', 'spoofmail.de', 'tempinbox.co.uk',
  'getairmail.com', 'airmail.cc', 'getonemail.net', 'crazymailing.com',
  'courriel.fr.nf', 'filzmail.com', 'freemail.ms', 'happy2go.com',
  'mailcat.biz', 'mailscrap.com', 'meltmail.com', 'mierdamail.com',
  'cool.fr.nf', 'courriel.fr.nf', 'sexforyou.co.cc', 'moreorcs.com',
]);

export function isDisposableEmail(email: string): boolean {
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  // Check exact match and subdomains
  if (BLOCKED_DOMAINS.has(domain)) return true;
  // Check if domain ends with any blocked domain (e.g. user@sub.mailinator.com)
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain.endsWith('.' + blocked)) return true;
  }
  return false;
}

export function validateEmailForSignup(email: string): { valid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (isDisposableEmail(email)) {
    return { valid: false, error: 'Temporary email addresses are not allowed. Please use a permanent email.' };
  }
  return { valid: true };
}
