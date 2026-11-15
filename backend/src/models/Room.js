import mongoose from "mongoose";
import { MAX_NAME_LENGTH, ROOM_TTL_MS } from "../config.js";

/*
 * Un salon remplace les comptes utilisateurs : connaître son code suffit pour
 * le rejoindre. Les médias appartiennent au salon (Media.roomId), pas à une
 * personne.
 */
const participantSchema = new mongoose.Schema(
  {
    // Identifiant aléatoire généré par le serveur, repris dans le jeton de salon.
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: MAX_NAME_LENGTH },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    // Seule l'empreinte du jeton d'hôte est conservée, comme pour un mot de passe.
    hostTokenHash: { type: String, required: true, select: false },
    participants: { type: [participantSchema], default: [] },
    // Sert à faire expirer les salons inactifs (voir services/roomService.js).
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

/** Données du salon visibles par ses participants. */
schema.methods.toPublic = function () {
  return {
    code: this.code,
    participants: this.participants.map(({ id, name }) => ({ id, name })),
    expiresAt: new Date(this.lastActivityAt.getTime() + ROOM_TTL_MS).toISOString(),
  };
};

export const Room = mongoose.model("Room", schema);
