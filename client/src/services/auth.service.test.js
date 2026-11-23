import test from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_REGEX,
  isValidEmail,
  normalizeEmail,
  AUTH_MESSAGES,
  AUTH_ERROR_CODES,
  formatLockoutMessage,
} from "../../../shared/authValidation.js";

test("shared auth validation enforces consistent email rules for TC_LOG_05, TC_LOG_09, TC_LOG_12, TC_LOG_13, TC_LOG_14", () => {
  assert.equal(isValidEmail("phuc@covai.dev"), true);
  assert.equal(isValidEmail("  PHUC@GMAIL.COM  "), true);
  assert.equal(normalizeEmail("  PHUC@GMAIL.COM  "), "phuc@gmail.com");

  // TC_LOG_05
  assert.equal(isValidEmail("Phucgmail.com"), false);
  // TC_LOG_12
  assert.equal(isValidEmail("' OR 1=1; --"), false);
  // TC_LOG_13: XSS payload MUST be rejected client & server side by EMAIL_REGEX
  assert.equal(EMAIL_REGEX.test("<script>alert('XSS')</script>@test.com"), false);
  assert.equal(isValidEmail("<script>alert('XSS')</script>@test.com"), false);
});

test("shared auth messages and lockout formatting match standardized UX copy", () => {
  assert.equal(AUTH_MESSAGES.EMAIL_REQUIRED, "Email is required");
  assert.equal(AUTH_MESSAGES.EMAIL_INVALID, "Please enter a valid email address");
  assert.equal(AUTH_MESSAGES.PASSWORD_REQUIRED, "Password is required");
  assert.equal(AUTH_MESSAGES.INVALID_CREDENTIALS, "Incorrect email or password");
  assert.equal(AUTH_ERROR_CODES.ACCOUNT_LOCKED, "ACCOUNT_LOCKED");

  assert.match(formatLockoutMessage(900), /15 minutes/);
  assert.match(formatLockoutMessage(45), /1 minute\./);
});
