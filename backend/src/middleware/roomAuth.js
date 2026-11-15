import { openRoomSession } from "../services/roomService.js";

// Au-delà de ce délai, une requête authentifiée repousse l'expiration du salon.
const ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

/**
 * Middleware Express qui protège les routes d'un salon. Le jeton de salon est
 * transmis sous la forme "Authorization: Bearer <token>". En cas de succès,
 * `req.room` et `req.participant` viennent du jeton vérifié, jamais du corps
 * de la requête.
 */
export async function roomAuth(req, res, next) {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    console.warn(`[rooms] Authorization absente pour ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Jeton de salon requis" });
  }

  try {
    const session = await openRoomSession(raw.slice(7));
    if (!session) {
      return res.status(401).json({ message: "Salon fermé ou jeton invalide" });
    }

    req.room = session.room;
    req.participant = session.participant;

    if (Date.now() - session.room.lastActivityAt.getTime() > ACTIVITY_REFRESH_MS) {
      session.room.lastActivityAt = new Date();
      await session.room.save();
    }
    next();
  } catch (error) {
    console.error("[rooms] Erreur pendant la vérification du jeton de salon", error);
    next(error);
  }
}
