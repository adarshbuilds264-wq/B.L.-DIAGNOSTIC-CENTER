import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';

/**
 * Single canonical Firebase initialization for B.L. Diagnostic Center.
 * Uses firebase-applet-config.json provisioned for project luminous-xylopolist-xvr20.
 */
const env = (import.meta as any).env || {};

export const firebaseConfig = {
  projectId:
    (env.VITE_FIREBASE_PROJECT_ID &&
    !String(env.VITE_FIREBASE_PROJECT_ID).includes('placeholder')
      ? env.VITE_FIREBASE_PROJECT_ID
      : firebaseAppletConfig.projectId) || firebaseAppletConfig.projectId,
  appId:
    (env.VITE_FIREBASE_APP_ID &&
    !String(env.VITE_FIREBASE_APP_ID).includes('placeholder')
      ? env.VITE_FIREBASE_APP_ID
      : firebaseAppletConfig.appId) || firebaseAppletConfig.appId,
  apiKey:
    (env.VITE_FIREBASE_API_KEY &&
    !String(env.VITE_FIREBASE_API_KEY).includes('placeholder')
      ? env.VITE_FIREBASE_API_KEY
      : firebaseAppletConfig.apiKey) || firebaseAppletConfig.apiKey,
  authDomain:
    (env.VITE_FIREBASE_AUTH_DOMAIN &&
    !String(env.VITE_FIREBASE_AUTH_DOMAIN).includes('placeholder')
      ? env.VITE_FIREBASE_AUTH_DOMAIN
      : firebaseAppletConfig.authDomain) || firebaseAppletConfig.authDomain,
  storageBucket:
    (env.VITE_FIREBASE_STORAGE_BUCKET &&
    !String(env.VITE_FIREBASE_STORAGE_BUCKET).includes('placeholder')
      ? env.VITE_FIREBASE_STORAGE_BUCKET
      : firebaseAppletConfig.storageBucket) || firebaseAppletConfig.storageBucket,
  messagingSenderId:
    (env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
    !String(env.VITE_FIREBASE_MESSAGING_SENDER_ID).includes('placeholder')
      ? env.VITE_FIREBASE_MESSAGING_SENDER_ID
      : firebaseAppletConfig.messagingSenderId) ||
    firebaseAppletConfig.messagingSenderId,
  firestoreDatabaseId: firebaseAppletConfig.firestoreDatabaseId,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = firebaseAppletConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseAppletConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'system_metadata', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  testConnection();
}

// Google Workspace OAuth Scopes configured for Google Sheets & Drive admin integration
export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export const googleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => googleProvider.addScope(scope));
export const googleWorkspaceProvider = googleProvider;

let cachedWorkspaceAccessToken: string | null = null;

export function setWorkspaceAccessToken(token: string | null): void {
  cachedWorkspaceAccessToken = token;
}

export function getWorkspaceAccessToken(): string | null {
  return cachedWorkspaceAccessToken;
}

export default app;
