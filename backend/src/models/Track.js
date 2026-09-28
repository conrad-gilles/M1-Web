import mongoose from "mongoose";

/*
 * Ce schéma conserve les métadonnées d'une piste. Le fichier audio lui-même
 * reste sur le disque ; storedName contient le nom technique utilisé côté
 * serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

// Cet index accélère la liste des pistes d'un utilisateur triées par date.
schema.index({ ownerId: 1, createdAt: -1 });

/**
 * Convertit un document Mongoose en objet sûr pour le frontend.
 * L'identifiant MongoDB devient la propriété simple `id` attendue par Angular.
 */
schema.methods.toPublic = function () {
  console.debug(`[track-model] Préparation de la piste publique ${this.id}`);
  return {
    id: this.id,
    ownerId: String(this.ownerId),
    title: this.title,
    originalName: this.originalName,
    mimeType: this.mimeType,
    size: this.size,
    createdAt: this.createdAt,
  };
};

export const Track = mongoose.model("Track", schema);
