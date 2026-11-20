// CORS does not prevent CSRF. Reject state-changing browser requests from
// origins other than our configured frontend.
export const trustedOrigin = (allowedOrigins) => (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ success: false, message: "Untrusted request origin" });
  }
  next();
};
