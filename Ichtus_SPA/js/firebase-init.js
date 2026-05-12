/* Firebase Initialization for Ichtus SPA */

let db;
let auth;
let useFirebase = false;
let currentUser = null;

// Configuration loaded from external file
let firebaseConfig = null;

(function initFirebaseConfig() {
    try {
        // First check localStorage for saved config (persisted from setup screen)
        const savedConfig = localStorage.getItem('firebaseConfig');
        if (savedConfig) {
            try {
                firebaseConfig = JSON.parse(savedConfig);
                if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY_HERE') {
                    initializeFirebase(firebaseConfig);
                    return;
                }
            } catch (parseErr) {
                localStorage.removeItem('firebaseConfig');
            }
        }
        
        // Check server-injected config first (highest priority)
        if (typeof window.FIREBASE_CONFIG !== 'undefined' && window.FIREBASE_CONFIG) {
            firebaseConfig = window.FIREBASE_CONFIG;
            if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY_HERE') {
                initializeFirebase(firebaseConfig);
                return;
            }
        }
        
        // Then check external config file (legacy fallback)
        if (typeof FIREBASE_CONFIG !== 'undefined') {
            firebaseConfig = FIREBASE_CONFIG;
            
            // Check if it's still the placeholder
            if (firebaseConfig.apiKey === 'YOUR_API_KEY_HERE' || !firebaseConfig.apiKey) {
                showSetupScreen();
            } else {
                initializeFirebase(firebaseConfig);
            }
        } else {
            // No external config file found - show setup screen
            showSetupScreen();
        }
    } catch (e) {
        console.warn('Firebase not configured:', e.message);
        showSetupScreen();
    }
})();

function initializeFirebase(config) {
    try {
        firebase.initializeApp(config);
        auth = firebase.auth();
        db = firebase.firestore();
        
        // Firestore settings for restrictive networks
        db.settings({
            experimentalForceLongPolling: true,
            experimentalAutoDetectLongPolling: false,
            merge: true
        });
        
        // Enable IndexedDB persistence (Firebase v10 compat API)
        db.enablePersistence().catch((err) => {
            if (err.code === 'unimplemented' || err.code === 'failed-precondition') {
                console.warn('Firebase persistence not supported (multiple tabs open?)');
            } else {
                console.warn('Could not enable Firebase persistence.', err);
            }
        });
        
        useFirebase = true;
        console.log('Firebase Active.');
        
        // Listen for auth state changes
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            if (user) {
                console.log('User signed in:', user.email);
                showApp();
            } else {
                // No user signed in — show the app anyway (Firestore may be restricted)
                // Users can sign in later if needed
                console.log('No user signed in — running unauthenticated.');
                showApp();
            }
        });
    } catch (e) {
        console.warn('Firebase initialization failed:', e.message);
        showSetupScreen();
    }
}

function showSetupScreen() {
    useFirebase = false;
    db = null;
    auth = null;
    
    // Create setup overlay if it doesn't exist
    if (!document.getElementById('setup-screen')) {
        const setupScreen = document.createElement('div');
        setupScreen.id = 'setup-screen';
        setupScreen.className = 'overlay-screen';
        setupScreen.innerHTML = `
            <div class='setup-container'>
                <img src='../shared-assets/images/Ichtus logo oranje.png' alt='Ichtus Logo' class='setup-logo'>
                <h1 class='setup-title heading-font'>ICHTUS WORKSPACE</h1>
                <p class='setup-subtitle'>Firebase Configuration Required</p>
                <p class='setup-description'>Enter your Firebase project details to connect. You can find these in the Firebase Console under Project Settings → Your apps → Web app.</p>
                <form id='setup-form' onsubmit='handleSetupSubmit(event)'>
                    <div class='setup-field'>
                        <label for='setup-apiKey'>API Key</label>
                        <input type='text' id='setup-apiKey' placeholder='AIza...' required class='setup-input'>
                    </div>
                    <div class='setup-field'>
                        <label for='setup-authDomain'>Auth Domain</label>
                        <input type='text' id='setup-authDomain' placeholder='your-project.firebaseapp.com' required class='setup-input'>
                    </div>
                    <div class='setup-field'>
                        <label for='setup-projectId'>Project ID</label>
                        <input type='text' id='setup-projectId' placeholder='your-project-id' required class='setup-input'>
                    </div>
                    <div class='setup-field'>
                        <label for='setup-storageBucket'>Storage Bucket</label>
                        <input type='text' id='setup-storageBucket' placeholder='your-project.appspot.com' required class='setup-input'>
                    </div>
                    <div class='setup-field'>
                        <label for='setup-messagingSenderId'>Messaging Sender ID</label>
                        <input type='text' id='setup-messagingSenderId' placeholder='123456789' required class='setup-input'>
                    </div>
                    <div class='setup-field'>
                        <label for='setup-appId'>App ID</label>
                        <input type='text' id='setup-appId' placeholder='1:123456789:web:abc123' required class='setup-input'>
                    </div>
                    <button type='submit' class='btn-setup'>Connect Firebase</button>
                    <p id='setup-error' class='setup-error'></p>
                </form>
                <div class='setup-hint'>
                    <p>Don't have a Firebase project? <a href='https://console.firebase.google.com/' target='_blank'>Create one free</a></p>
                </div>
            </div>
        `;
        document.body.appendChild(setupScreen);
    }
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('app-container')?.classList.add('hidden');
}

function handleSetupSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('setup-error');
    
    const config = {
        apiKey: document.getElementById('setup-apiKey').value.trim(),
        authDomain: document.getElementById('setup-authDomain').value.trim(),
        projectId: document.getElementById('setup-projectId').value.trim(),
        storageBucket: document.getElementById('setup-storageBucket').value.trim(),
        messagingSenderId: document.getElementById('setup-messagingSenderId').value.trim(),
        appId: document.getElementById('setup-appId').value.trim()
    };
    
    // Basic validation
    if (!config.apiKey || !config.authDomain || !config.projectId) {
        errorEl.textContent = 'Please fill in all required fields';
        return;
    }
    
    if (!config.apiKey.startsWith('AIza')) {
        errorEl.textContent = 'Invalid API Key format (should start with AIza)';
        return;
    }
    
    // Save to localStorage for persistence
    localStorage.setItem('firebaseConfig', JSON.stringify(config));
    
    // Hide setup screen and initialize
    document.getElementById('setup-screen').classList.add('hidden');
    initializeFirebase(config);
}

function showSignInScreen() {
    // Create sign-in overlay if it doesn't exist
    if (!document.getElementById('auth-screen')) {
        const authScreen = document.createElement('div');
        authScreen.id = 'auth-screen';
        authScreen.className = 'overlay-screen';
        authScreen.innerHTML = `
            <div class='auth-container'>
                <img src='../shared-assets/images/Ichtus logo oranje.png' alt='Ichtus Logo' class='auth-logo'>
                <h1 class='auth-title heading-font'>ICHTUS WORKSPACE</h1>
                <p class='auth-subtitle'>Sign in to access your workspace</p>
                <form id='auth-form' onsubmit='handleSignIn(event)'>
                    <input type='email' id='auth-email' placeholder='Email' required class='auth-input'>
                    <input type='password' id='auth-password' placeholder='Password' required class='auth-input'>
                    <button type='submit' class='btn-auth'>Sign In</button>
                    <p id='auth-error' class='auth-error'></p>
                </form>
                <div class='auth-divider'><span>or</span></div>
                <button class='btn-auth-secondary' onclick='handleSignUp()'>Create Account</button>
                <button class='btn-auth-guest' onclick='handleGuestAccess()'>Continue as Guest (Local Only)</button>
            </div>
        `;
        document.body.appendChild(authScreen);
    }
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-container')?.classList.add('hidden');
}

function showApp() {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('setup-screen')?.classList.add('hidden');
    document.getElementById('app-container')?.classList.remove('hidden');
}

async function handleSignIn(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    
    try {
        errorEl.textContent = '';
        await auth.signInWithEmailAndPassword(email, password);
        showApp();
    } catch (err) {
        errorEl.textContent = getAuthErrorMessage(err.code);
    }
}

async function handleSignUp() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password';
        return;
    }
    
    try {
        errorEl.textContent = '';
        await auth.createUserWithEmailAndPassword(email, password);
        showApp();
    } catch (err) {
        errorEl.textContent = getAuthErrorMessage(err.code);
    }
}

async function handleGuestAccess() {
    // Sign out and run in local mode only
    if (auth) {
        await auth.signOut();
    }
    useFirebase = false;
    db = null;
    showApp();
}

function getAuthErrorMessage(code) {
    const messages = {
        'auth/invalid-email': 'Invalid email address',
        'auth/user-disabled': 'This account has been disabled',
        'auth/user-not-found': 'No account found with this email',
        'auth/wrong-password': 'Incorrect password',
        'auth/email-already-in-use': 'Email already in use',
        'auth/weak-password': 'Password should be at least 6 characters',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/too-many-requests': 'Too many attempts. Try again later.'
    };
    return messages[code] || 'Authentication failed. Please try again.';
}