import admin from "firebase-admin";
import dotenv from "dotenv";
import { createLocalProjectBucket } from './localProjectStorage.js';
dotenv.config();

const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_STORAGE_BUCKET",
];

const localStorage = process.env.PROJECT_STORAGE_DRIVER === 'local';
for (const key of localStorage ? [] : requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!localStorage && admin.apps.length === 0) admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

let localBucket;
export const getBucket = () => {
  if (!localStorage) return admin.storage().bucket();
  return localBucket ||= createLocalProjectBucket(process.env.PROJECT_STORAGE_ROOT);
};
export { admin };
