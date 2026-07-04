# Web-Based Adaptive Interview Simulator

An interactive, AI-driven mock interview platform designed to help candidates prepare for software engineering interviews. The simulator uses speech-to-text to capture answers, adapts question difficulty based on real-time performance, and provides detailed feedback on technical concepts.

## 🚀 Features

- **Adaptive Questioning**: The difficulty of questions dynamically adjusts (Easy, Medium, Hard) based on your performance.
- **Voice-to-Text Answers**: Speak your answers naturally! Integrated with **Deepgram WebSocket STT** for real-time, highly accurate transcription.
- **Real-Time Evaluation**: Answers are scored using keyword matching and NLP similarity against model answers.
- **Comprehensive Feedback**: Get immediate feedback highlighting missing concepts, strengths, and actionable areas for improvement.
- **Topic Coverage**: Practice core CS fundamentals including:
  - Data Structures & Algorithms (DSA)
  - Operating Systems (OS)
  - Database Management Systems (DBMS)
- **Job Description Analysis**: Paste a job description to automatically detect relevant interview topics.
- **User Authentication**: Secure sign-in powered by **Firebase Authentication**.

## 🛠️ Tech Stack

### Frontend
- **HTML/CSS/JS**: Pure static frontend for lightning-fast loading and easy deployment.
- **Tailwind CSS**: Used via CDN for sleek, responsive styling.
- **Deepgram API**: Real-time voice-to-text streaming.
- **Firebase Auth**: User authentication and session management.

### Backend
- **FastAPI**: High-performance Python backend for handling evaluations and session state.
- **Uvicorn**: ASGI server for running the FastAPI application.

## ⚙️ Local Setup Instructions

### 1. Backend Setup
1. Open a terminal and navigate to the project directory.
2. Create and activate a virtual environment (optional but recommended):
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```
3. Install the required dependencies (FastAPI, Uvicorn, etc.).
4. Start the backend server:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```
   The API will be available at `http://127.0.0.1:8000`.

### 2. Frontend Setup
Since the frontend is a pure static site, you just need a simple HTTP server to serve the files.
1. Open a new terminal window in the root directory of the project.
2. Start a Python HTTP server:
   ```bash
   python3 -m http.server 3001
   ```
3. Open your browser and navigate to `http://localhost:3001`.

*(Note: You will need to add your own Deepgram API key to the `DEEPGRAM_API_KEY` variable in `script.js` for the speech-to-text functionality to work locally).*

## 🌐 Deployment

- **Frontend**: Can be deployed seamlessly to Vercel, Netlify, or GitHub Pages as a static site. 
- **Backend**: Can be deployed to services like Render, Railway, or Heroku. 
- **Important**: Once deployed, you must update the `BASE_URL` in `script.js` to point to your live backend URL. Additionally, remember to add your deployed frontend domain to Firebase's **Authorized Domains** list in the Authentication settings.
