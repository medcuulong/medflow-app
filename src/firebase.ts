import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // <--- Mọi người hay quên dòng này nhất

const firebaseConfig = {
  apiKey: "AIzaSyBgmx0sg-LhjqWzIOFk-SjZJ5vEZpG9Q7w",
  authDomain: "medflow-cuulong.firebaseapp.com",
  projectId: "medflow-cuulong",
  storageBucket: "medflow-cuulong.firebasestorage.app",
  messagingSenderId: "1040584926456",
  appId: "1:1040584926456:web:555a50e01b04690b64470d",
  measurementId: "G-7QHTZ09RSN"
};

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);

// Mở kết nối Database (BẮT BUỘC PHẢI CÓ DÒNG NÀY ĐỂ KẾT NỐI FIRESTORE)
export const db = getFirestore(app);