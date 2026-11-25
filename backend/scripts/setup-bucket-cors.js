import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

/*
 * Règle CORS du bucket B2 (à lancer une fois : `npm run setup:cors`).
 * Lire une vidéo avec <video src> n'en a pas besoin ; elle sert au lecteur,
 * qui relit le statut HTTP d'une URL en échec avec fetch() pour afficher la
 * cause (quota du jour, lien expiré...). Lecture seule, depuis les origines
 * de l'application uniquement.
 */
const ORIGINS = [
  "http://localhost:3000", // backend + build Angular
  "http://localhost:4200", // ng serve
  "https://sharingplatform.onrender.com", // production (Render)
];

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const Bucket = process.env.S3_BUCKET;

await client.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ORIGINS,
          AllowedMethods: ["GET", "HEAD"],
          AllowedHeaders: ["Range"],
          ExposeHeaders: ["Content-Range", "Content-Length", "Accept-Ranges"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
const { CORSRules } = await client.send(new GetBucketCorsCommand({ Bucket }));
console.log(`[cors] Règle CORS du bucket ${Bucket} :`, JSON.stringify(CORSRules, null, 2));
