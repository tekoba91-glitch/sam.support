import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
   apiKey: "AIzaSyAgSLJw50Q_dozLPOWovrpTAjHzj8LT4TE",
  authDomain: "sam-supportbase.firebaseapp.com",
  projectId: "sam-supportbase",
  storageBucket: "sam-supportbase.firebasestorage.app",
  messagingSenderId: "625733369837",
  appId: "1:625733369837:web:4d916bde76aadf7b5f71e4"
};


export const SCHOOL_DOMAIN = "guru.smk.belajar.id";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: SCHOOL_DOMAIN });
