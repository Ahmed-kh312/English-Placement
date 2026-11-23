/* Firebase configuration for Cloud Sync (Firestore).
   Project: english-placement-app-badd6
   Note: Firebase web keys identify the project; they are not secrets. Access is controlled by the Firestore rules (see README.md). */
const firebaseConfig = {
  apiKey: "AIzaSyD7lSQLuQPWAYUGiM5uhhddwMdtV-HKVvI",
  authDomain: "english-placement-app-badd6.firebaseapp.com",
  projectId: "english-placement-app-badd6",
  storageBucket: "english-placement-app-badd6.firebasestorage.app",
  messagingSenderId: "1058632193904",
  appId: "1:1058632193904:web:4cc31ea8661a2b5b9da1b5",
  measurementId: "G-5J905X6856"
};

/* Firestore collection that holds the submissions. */
const FIREBASE_COLLECTION = 'attempts';
