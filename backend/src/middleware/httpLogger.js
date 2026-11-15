/**
 * Journalise la fin de chaque requête : méthode, chemin, statut et durée.
 * La chaîne de requête est masquée, car les URL de lecture y transportent un
 * jeton signé qui ne doit jamais apparaître dans les logs.
 */
export function httpLogger(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    const [pathname, query] = req.originalUrl.split("?");
    const url = query ? `${pathname}?[masqué]` : pathname;
    console.log(
      `[http] ${req.method} ${url} -> ${res.statusCode} (${Date.now() - startedAt} ms)`,
    );
  });
  next();
}
