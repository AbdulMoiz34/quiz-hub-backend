export const ADMIN_COOKIE = "quiz_hub_admin";

export function adminCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: config.cookieSameSite,
    path: "/api/v1",
    maxAge: 12 * 60 * 60 * 1000,
  };
}
