import mongoose from "mongoose";

/*
 * Ce schéma conserve les métadonnées d'un média (audio ou vidéo). Le fichier
 * lui-même est confié au module de stockage ; storageKey contient le nom
 * technique utilisé côté serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    // Un média appartient à un salon : seul un jeton de ce salon y donne accès.
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    // upload : fichier envoyé, gardé par le module de stockage.
    // local : rien n'est envoyé ; chaque participant lit sa propre copie du
    // fichier, reconnue à sa durée (voir POST /media/local).
    source: { type: String, enum: ["upload", "local"], default: "upload" },
    kind: { type: String, required: true, enum: ["audio", "video"] },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    originalName: { type: String, default: "", maxlength: 255 },
    storageKey: {
      type: String,
      select: false,
      required() {
        return this.source !== "local";
      },
    },
    mimeType: { type: String, default: "", maxlength: 100 },
    size: { type: Number, required: true, min: 0 },
    // Durée en secondes, connue pour un média local (elle sert à vérifier que
    // chacun a le même fichier) ; absente pour un fichier envoyé.
    duration: {
      type: Number,
      min: 0,
      required() {
        return this.source === "local";
      },
    },
  },
  { timestamps: true },
);

// Cet index accélère la liste des médias d'un salon triés par date.
schema.index({ roomId: 1, createdAt: -1 });

/**
 * Convertit un document Mongoose en objet sûr pour le frontend.
 * L'identifiant MongoDB devient la propriété simple `id` attendue par Angular.
 */
schema.methods.toPublic = function () {
  return {
    id: this.id,
    source: this.source ?? "upload",
    duration: this.duration ?? null,
    kind: this.kind,
    title: this.title,
    originalName: this.originalName,
    mimeType: this.mimeType,
    size: this.size,
    createdAt: this.createdAt,
  };
};

export const Media = mongoose.model("Media", schema);
