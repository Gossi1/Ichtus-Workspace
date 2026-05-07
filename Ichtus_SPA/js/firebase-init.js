/* Firebase Initialization for Ichtus SPA */

let db;
let useFirebase = false;

try {
    const firebaseConfig = {
        apiKey: 'AIzaSyAPP_CT-yqkeoq6hWwd7pyZ2G8IBcPEykg',
        authDomain: 'ichtus-apps.firebaseapp.com',
        projectId: 'ichtus-apps',
        storageBucket: 'ichtus-apps.firebasestorage.app',
        messagingSenderId: '629776754168',
        appId: '1:629776754168:web:1a5e16b9d27f6b1c43a20d',
        measurementId: 'G-Y4H8T6RW9T'
    };

    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        
        try {
            db.settings({
                cache: new firebase.firestore.IndexedDbCache(),
                experimentalForceLongPolling: true,
                experimentalAutoDetectLongPolling: false
            });
        } catch (err) {
            if (err.code === 'unimplemented') {
                console.warn('Firebase persistence not supported in this browser.');
            } else {
                console.warn('Could not enable Firebase persistence.', err);
            }
        }
        useFirebase = true;
        console.log('Firebase Active.');
    }
} catch (e) {
    console.warn('Running in Local Mode.', e);
}