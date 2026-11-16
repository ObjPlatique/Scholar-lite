# Scholar Lite

Static HTML/CSS/JS starter using Bootstrap, Firebase Authentication (email/password and Google), Firestore, and Gemini (model `gemini-2.5-flash`).

## Setup
1. Open `js/firebaseConfig.js` and replace the Firebase placeholders with your Firebase Web App config. Add a Gemini API key to `geminiApiKey`. Use a newly generated key; do not reuse a key that has been exposed publicly.
2. In Firebase Authentication, enable Email/Password and Google providers. Add your local host (e.g. `localhost`) to Authorized domains.
3. Create a Firestore database and deploy rules restricting each user's data to their own UID. Example:
   ```
   match /users/{uid}/scholarLite/{document=**} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
4. Serve the folder using a local web server (ES modules do not work reliably from `file://`), e.g. `python -m http.server 8000`, then visit `http://localhost:8000`.

## Gemini security
This static version calls Gemini directly from the browser for convenient local testing. The API key can be viewed by visitors and must not be used on a public deployment. For production, move Gemini calls to a server-side endpoint and keep the key in server environment variables.
