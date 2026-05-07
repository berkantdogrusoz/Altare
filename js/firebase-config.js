// Altare AI Panel — Firebase Web SDK initialisation
// ---------------------------------------------------------------
// Loaded by login.html and panel.html as an ES module.
// Firebase config below is from the Firebase Console for project
//   altare-312a1
// Web App: "Altare AI Panel"
//
// NOTE: These values are public by design. Real protection lives in
// Firestore security rules + custom auth claims (admin: true).
// ---------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

export const firebaseConfig = {
  // ⚠️  FILL THESE FROM Firebase Console → Project settings → Your apps → Web app
  apiKey: "REPLACE_WITH_WEB_API_KEY",
  authDomain: "altare-312a1.firebaseapp.com",
  projectId: "altare-312a1",
  storageBucket: "altare-312a1.appspot.com",
  messagingSenderId: "525350962277",
  appId: "REPLACE_WITH_WEB_APP_ID",
};

export const FUNCTIONS_REGION = "europe-west1";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

// Keep the user signed in across reloads (panel is internal, single-tenant).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("[altare] auth persistence:", err);
});
