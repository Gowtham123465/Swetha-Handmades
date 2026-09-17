import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCoxXk4ZcrizaiCL-bGiE5bL4WOen4Oc9k',
  authDomain: 'swetha-handmades.firebaseapp.com',
  projectId: 'swetha-handmades',
  storageBucket: 'swetha-handmades.firebasestorage.app',
  messagingSenderId: '442674527441',
  appId: '1:442674527441:web:51ef8a488109c43ec919f0',
  measurementId: 'G-KDRXVEF46N'
};
const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
export const storage=getStorage(app);
export default app;
