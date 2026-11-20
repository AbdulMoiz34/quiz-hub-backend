export const ADMIN_COOKIE = "quiz_hub_admin";
export const ATTEMPT_COOKIE = "quiz_hub_attempt";

export function adminCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: config.cookieSameSite,
    path: "/api/v1",
    maxAge: 12 * 60 * 60 * 1000,
  };
}

export function attemptCookieOptions(config) {
  return {
    ...adminCookieOptions(config),
    path: "/api/v1/student",
    maxAge: 6 * 60 * 60 * 1000,
  };
}
