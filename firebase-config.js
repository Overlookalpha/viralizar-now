// Configuração do projeto Firebase "Viralizar"
const firebaseConfig = {
    apiKey: "AIzaSyBfcsAVe7hFsD6HZIAwie9xT3qpd-uvt4g",
    authDomain: "viralizar-now-d6218.firebaseapp.com",
    projectId: "viralizar-now-d6218",
    storageBucket: "viralizar-now-d6218.firebasestorage.app",
    messagingSenderId: "1067165954137",
    appId: "1:1067165954137:web:2f068ec1eb3c8c98728148"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// Em algumas redes/navegadores (proxy, VPN, extensoes de bloqueio de anuncios)
// a conexao "streaming" padrao do Firestore falha e o SDK fica preso em
// "client is offline". Isso forca o SDK a detectar automaticamente e usar
// long polling quando o streaming normal nao funciona.
db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
