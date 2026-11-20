// CORS is not authentication. Check Origin on requests changing admin state.
export function adminOrigin(allowedOrigins) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

    const origin = req.get("Origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      return res.status(403).json({ success: false, message: "Untrusted request origin" });
    }
    next();
  };
}
