export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns an error message, or null when valid. */
export function validateEmail(email: string) {
  const value = email.trim();
  if (!value) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address, like name@example.com.';
  return null;
}

export function validateNewPassword(password: string) {
  if (!password) return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string) {
  if (!confirmation) return 'Re-enter your password.';
  if (password !== confirmation) return 'Passwords don’t match.';
  return null;
}

export function validateExistingPassword(password: string) {
  return password ? null : 'Enter your password.';
}
