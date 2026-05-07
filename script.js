/* ============================================================
   ADAPTIVE INTERVIEW SIMULATOR — script.js
   Wires the HTML/CSS frontend to the FastAPI backend at
   http://127.0.0.1:8000
   ============================================================ */

const BASE_URL = 'http://127.0.0.1:8000';
const DEEPGRAM_API_KEY = 'YOUR_DEEPGRAM_API_KEY_HERE';
let currentUser = null;   // stores the signed-in Firebase user object

// ──────────────────────────────────────────────
//  GLOBAL STATE
// ──────────────────────────────────────────────
const state = {
    sessionId: null,
    currentQuestionId: null,
    currentTopic: null,
    currentDifficulty: null,
    currentQuestionNumber: 0,
    selectedTopics: [],
    transcript: '',
    isRecording: false
};

// ──────────────────────────────────────────────
//  SESSION TRACKING
// ──────────────────────────────────────────────
let selectedDifficulty = 'easy';   // maps to backend difficulty tier
let sessionStartTime   = null;      // Date.now() when session begins
let correctAnswers     = 0;         // answers with score >= 60
let currentSummaryData = null;      // stores summary data for download

// ──────────────────────────────────────────────
//  DEEPGRAM STT — module-level state
// ──────────────────────────────────────────────
let dgSocket      = null;   // WebSocket to Deepgram
let mediaStream   = null;   // mic MediaStream
let mediaRecorder = null;   // chunks audio to WebSocket
let finalTranscript   = '';
let interimTranscript = '';

// Start Deepgram WebSocket STT
async function startDeepgramSTT() {
    finalTranscript   = '';
    interimTranscript = '';

    // Request mic access
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        alert('Microphone access denied. Please allow microphone access and try again.');
        resetMicState();
        return;
    }

    const dgUrl =
        `wss://api.deepgram.com/v1/listen` +
        `?language=en-US&interim_results=true&smart_format=true&endpointing=300`;

    dgSocket = new WebSocket(dgUrl, ['token', DEEPGRAM_API_KEY]);

    dgSocket.onopen = () => {
        // Stream mic audio in 250 ms chunks
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.addEventListener('dataavailable', (e) => {
            if (e.data.size > 0 && dgSocket && dgSocket.readyState === WebSocket.OPEN) {
                dgSocket.send(e.data);
            }
        });
        mediaRecorder.start(250);
    };

    dgSocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type !== 'Results') return;
            const alt = msg.channel?.alternatives?.[0]?.transcript || '';
            if (!alt) return;
            if (msg.is_final) {
                finalTranscript += alt + ' ';
                interimTranscript = '';
            } else {
                interimTranscript = alt;
            }
            const combined = finalTranscript + interimTranscript;
            if (transcriptText) transcriptText.textContent = combined;
            state.transcript = finalTranscript.trim();
            if (finalTranscript.trim().length > 10 && submitBtn) {
                submitBtn.disabled = false;
            }
        } catch (e) {
            console.error('Deepgram STT parse error:', e);
        }
    };

    dgSocket.onerror = (err) => {
        console.error('Deepgram STT error:', err);
        if (recordingStatus) {
            recordingStatus.textContent = 'Speech recognition error. Please try again.';
        }
        resetMicState();
    };

    dgSocket.onclose = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    };
}

// Stop Deepgram WebSocket STT
function stopDeepgramSTT() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (dgSocket && dgSocket.readyState === WebSocket.OPEN) dgSocket.close();
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    dgSocket = null;
    mediaRecorder = null;
    mediaStream = null;
}

// Stop any playing Deepgram TTS audio
function stopCurrentAudio() {
    if (window._currentAudio) {
        window._currentAudio.pause();
        window._currentAudio.currentTime = 0;
        window._currentAudio = null;
    }
}

// ──────────────────────────────────────────────
//  SPA ROUTING
// ──────────────────────────────────────────────
const pages = {
    home:      document.getElementById('page-home'),
    login:     document.getElementById('page-login'),
    setup:     document.getElementById('page-setup'),
    interview: document.getElementById('page-interview'),
    feedback:  document.getElementById('page-feedback'),
    summary:   document.getElementById('page-summary')
};

function navigateTo(pageId) {
    // Protect authenticated routes
    const protectedPages = ['setup', 'interview', 'feedback', 'summary'];
    if (protectedPages.includes(pageId) && !currentUser) {
        // Redirect to login if not authenticated
        pageId = 'login';
    }
    if (pageId === 'summary') {
        loadSummary();
    }

    Object.values(pages).forEach(page => {
        if (page) {
            page.classList.remove('active');
            setTimeout(() => {
                if (!page.classList.contains('active')) {
                    page.style.display = 'none';
                }
            }, 300);
        }
    });

    const targetPage = pages[pageId];
    if (targetPage) {
        if (pageId === 'login' || pageId === 'interview') {
            targetPage.style.display = 'flex';
        } else {
            targetPage.style.display = 'block';
        }
        void targetPage.offsetWidth;
        targetPage.classList.add('active');
        window.scrollTo(0, 0);
    }
}

// ──────────────────────────────────────────────
//  API HELPER
// ──────────────────────────────────────────────
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body !== null) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        throw err;
    }
    return response.json();
}

// ──────────────────────────────────────────────
//  DOM CONTENT LOADED — BOOTSTRAP
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    window.navigateTo = navigateTo;

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        if (pages[hash]) {
            navigateTo(hash);
        } else if (!hash || hash.includes('-')) {
            if (!pages['home'].classList.contains('active')) {
                navigateTo('home');
                setTimeout(() => {
                    const el = document.getElementById(hash);
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 300);
            }
        }
    });

    const hash = window.location.hash.substring(1);
    if (pages[hash]) {
        navigateTo(hash);
    } else {
        navigateTo('home');
    }

    initSetupPage();
    initInterviewPage();
});

// ══════════════════════════════════════════════
//  PAGE 1 — SETUP
// ══════════════════════════════════════════════
function initSetupPage() {
    const startBtn = document.getElementById('start-interview-btn');

    // ── Replace the 6 domain buttons with 3 topic buttons ──
    const domainGrid = document.querySelector('#page-setup .domain-btn')?.closest('div');
    if (domainGrid) {
        domainGrid.innerHTML = '';

        const topics = [
            { label: 'Data Structures & Algorithms', value: 'DSA' },
            { label: 'Operating Systems',            value: 'OS'  },
            { label: 'Databases',                    value: 'DBMS'}
        ];

        topics.forEach(topic => {
            const btn = document.createElement('button');
            btn.className = 'domain-btn';
            btn.textContent = topic.label;
            btn.dataset.topicValue = topic.value;
            btn.addEventListener('click', () => {
                btn.classList.toggle('selected');
                const idx = state.selectedTopics.indexOf(topic.value);
                if (idx === -1) {
                    state.selectedTopics.push(topic.value);
                } else {
                    state.selectedTopics.splice(idx, 1);
                }
                startBtn.disabled = state.selectedTopics.length === 0;
            });
            domainGrid.appendChild(btn);
        });
    }

    // Ensure button starts disabled
    if (startBtn) {
        startBtn.disabled = true;
        // Replace the inline onclick with our real handler
        startBtn.onclick = null;
        startBtn.addEventListener('click', handleStartInterview);
    }

    // ── Wire difficulty level buttons ──
    const levelBtns = document.querySelectorAll('.level-btn');
    levelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            levelBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const txt = btn.textContent.trim().toLowerCase();
            if (txt === 'beginner')          selectedDifficulty = 'easy';
            else if (txt === 'intermediate') selectedDifficulty = 'medium';
            else if (txt === 'advanced')     selectedDifficulty = 'hard';
        });
    });

    // Analyze JD button
    const analyzeJdBtn = document.getElementById('analyze-jd-btn');
    if (analyzeJdBtn) {
        analyzeJdBtn.addEventListener('click', handleAnalyzeJD);
    }

    // Clear JD button
    const clearJdBtn = document.getElementById('clear-jd-btn');
    if (clearJdBtn) {
        clearJdBtn.addEventListener('click', handleClearJD);
    }
}

async function handleStartInterview() {
    const startBtn = document.getElementById('start-interview-btn');
    if (state.selectedTopics.length === 0) return;

    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    try {
        const data = await apiFetch('/start-session', 'POST', {
            user_id: currentUser ? currentUser.uid : 'user_' + Date.now(),
            topics:  state.selectedTopics,
            starting_difficulty: selectedDifficulty
        });

        state.sessionId  = data.session_id;
        sessionStartTime = Date.now();
        correctAnswers   = 0;

        await loadNextQuestion();
        navigateTo('interview');

    } catch (err) {
        alert('Failed to start session. Is the backend running?');
        startBtn.disabled = false;
        startBtn.innerHTML = 'Start Interview <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>';
    }
}

// ══════════════════════════════════════════════
//  PAGE 2 — INTERVIEW
// ══════════════════════════════════════════════

// Cached DOM element references (populated on first call)
let micBtn, pulses, transcriptBox, transcriptText, submitBtn, recordingStatus, skipBtn;
let questionTextEl, topicBadgeEl, difficultyBadgeEl, questionCounterEl;

function cacheInterviewElements() {
    micBtn          = document.getElementById('mic-btn');
    pulses          = document.getElementById('recording-pulses');
    transcriptBox   = document.getElementById('transcript-box');
    transcriptText  = document.getElementById('transcript-text');
    submitBtn       = document.getElementById('submit-answer-btn');
    recordingStatus = document.getElementById('recording-status');
    skipBtn         = document.getElementById('skip-btn');

    // Question card internals
    const questionCard = document.querySelector('#page-interview .page > div > div:first-child, #page-interview > div:nth-child(2) > div');
    const interviewContent = document.querySelector('#page-interview > div:nth-child(2)');

    // Find the question <p> — first p inside the first card div
    if (interviewContent) {
        const cards = interviewContent.querySelectorAll('div[style*="border-radius: 20px"]');
        if (cards.length > 0) {
            const firstCard = cards[0];
            questionTextEl     = firstCard.querySelector('p');
            const badges       = firstCard.querySelectorAll('span');
            topicBadgeEl       = badges[0] || null;
            difficultyBadgeEl  = badges[1] || null;
        }
    }

    // Question counter <span> in header
    questionCounterEl = document.querySelector('#page-interview header span[style*="0.8rem"]');
}

function initInterviewPage() {
    cacheInterviewElements();

    // Deepgram STT is initialised lazily when mic button is clicked.
    // No setup needed here — handlers live in startDeepgramSTT().

    // Mic button click
    if (micBtn) {
        micBtn.addEventListener('click', handleMicClick);
    }

    // Submit button
    if (submitBtn) {
        submitBtn.onclick = null;
        submitBtn.addEventListener('click', handleSubmitAnswer);
    }

    // Skip button
    if (skipBtn) {
        skipBtn.addEventListener('click', handleSkip);
    }

    // End interview button in header
    const endBtn = document.querySelector('#page-interview header button');
    if (endBtn) {
        endBtn.onclick = null;
        endBtn.addEventListener('click', async () => {
            stopRecognitionIfRunning();
            await loadSummary();
            navigateTo('summary');
        });
    }
}

async function handleMicClick() {
    if (!state.isRecording) {
        state.isRecording = true;
        finalTranscript   = '';
        interimTranscript = '';
        state.transcript  = '';

        micBtn.classList.add('recording');
        pulses.classList.remove('hidden');
        recordingStatus.textContent = 'Listening... Speak your answer';
        transcriptBox.classList.remove('hidden');
        transcriptText.textContent  = '';
        if (submitBtn) submitBtn.disabled = true;

        try {
            // STEP 1 — Get microphone access FIRST, before anything else
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // STEP 2 — Only AFTER mediaStream is ready, open Deepgram WebSocket
            dgSocket = new WebSocket(
                'wss://api.deepgram.com/v1/listen?' +
                'language=en-US' +
                '&model=nova-2' +
                '&smart_format=true' +
                '&interim_results=true' +
                '&punctuate=true' +
                '&utterance_end_ms=2000' +
                '&filler_words=false',
                ['token', DEEPGRAM_API_KEY]
            );

            // STEP 3 — Inside onopen, mediaStream is guaranteed to exist
            dgSocket.onopen = () => {
                mediaRecorder = new MediaRecorder(mediaStream, {
                    mimeType: 'audio/webm;codecs=opus'
                });

                mediaRecorder.ondataavailable = (event) => {
                    if (dgSocket && dgSocket.readyState === WebSocket.OPEN && event.data.size > 0) {
                        dgSocket.send(event.data);
                    }
                };

                mediaRecorder.start(250);
            };

            dgSocket.onmessage = (event) => {
                const result  = JSON.parse(event.data);
                const channel = result?.channel?.alternatives?.[0];
                if (!channel) return;

                const transcript = channel.transcript;
                const isFinal    = result.is_final;

                if (isFinal && transcript.trim()) {
                    finalTranscript += transcript + ' ';
                } else if (!isFinal && transcript.trim()) {
                    interimTranscript = transcript;
                }

                const combined = finalTranscript + interimTranscript;
                if (transcriptText) transcriptText.textContent = combined;
                state.transcript = finalTranscript.trim();
                console.log('[DG] isFinal:', isFinal, '| raw:', transcript, '| finalTranscript:', finalTranscript, '| state.transcript:', state.transcript); // debug

                if (finalTranscript.trim().length > 10) {
                    if (submitBtn) submitBtn.disabled = false;
                }
            };

            dgSocket.onerror = (err) => {
                console.error('Deepgram WebSocket error:', err);
                recordingStatus.textContent = 'Connection error. Please try again.';
                stopDeepgramSTT();
                resetMicState();
            };

            dgSocket.onclose = () => {};

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                alert('Microphone access denied. Please allow microphone access and try again.');
            } else {
                alert('Could not start recording. Please try again.');
                console.error(err);
            }
            resetMicState();
        }

    } else {
        // STOP RECORDING
        state.isRecording = false;
        micBtn.classList.remove('recording');
        pulses.classList.add('hidden');
        recordingStatus.textContent = 'Answer recorded. Submit when ready.';
        stopDeepgramSTT();
    }
}

function resetMicState() {
    state.isRecording = false;
    stopDeepgramSTT();
    if (micBtn)          micBtn.classList.remove('recording');
    if (pulses)          pulses.classList.add('hidden');
    if (recordingStatus) recordingStatus.textContent = 'Press the microphone to start answering';
    if (transcriptBox)   transcriptBox.classList.add('hidden');
    if (transcriptText)  transcriptText.textContent = '';
    if (submitBtn)       submitBtn.disabled = true;
    // NOTE: state.transcript is intentionally NOT cleared here.
    // It must survive until handleSubmitAnswer() reads it.
    // It is cleared at the start of handleMicClick() when a new recording begins.
}

function stopRecognitionIfRunning() {
    if (state.isRecording) stopDeepgramSTT();
    resetMicState();
}

async function loadNextQuestion() {
    try {
        const data = await apiFetch('/get-question', 'POST', {
            session_id: state.sessionId
        });

        state.currentQuestionId     = data.question_id;
        state.currentTopic          = data.topic;
        state.currentDifficulty     = data.difficulty;
        state.currentQuestionNumber = data.question_number;

        // Make sure cached elements are fresh
        cacheInterviewElements();

        // Update question text
        if (questionTextEl) {
            questionTextEl.textContent = data.question_text;
        }

        // Update topic badge
        if (topicBadgeEl) {
            topicBadgeEl.textContent = data.topic;
        }

        // Update difficulty badge with colour
        if (difficultyBadgeEl) {
            difficultyBadgeEl.textContent = capitalize(data.difficulty);
            const diff = (data.difficulty || '').toLowerCase();
            if (diff === 'easy') {
                difficultyBadgeEl.style.background = '#ECFDF5';
                difficultyBadgeEl.style.color       = '#059669';
                difficultyBadgeEl.style.borderColor = '#A7F3D0';
            } else if (diff === 'medium') {
                difficultyBadgeEl.style.background = '#FFFBEB';
                difficultyBadgeEl.style.color       = '#F59E0B';
                difficultyBadgeEl.style.borderColor = '#FDE68A';
            } else {
                // hard
                difficultyBadgeEl.style.background = '#FEF2F2';
                difficultyBadgeEl.style.color       = '#EF4444';
                difficultyBadgeEl.style.borderColor = '#FCA5A5';
            }
        }

        // Update question counter
        if (questionCounterEl) {
            questionCounterEl.textContent = `Question ${data.question_number}`;
        }

        // Reset mic / transcript / submit
        resetMicState();

        // Read question aloud via Deepgram TTS
        speakQuestion(data.question_text);

    } catch (err) {
        if (err.status === 404) {
            // No more questions — go to summary
            await loadSummary();
            navigateTo('summary');
        } else {
            alert('Could not load question. Please try again.');
        }
    }
}

async function handleSubmitAnswer() {
    console.log('submit clicked, transcript:', state.transcript); // debug
    if (submitBtn) submitBtn.disabled = true;

    // Stop recording if still active
    stopRecognitionIfRunning();
    console.log('after stop, transcript:', state.transcript); // debug

    if (!state.transcript || state.transcript.trim().length === 0) {
        alert('Please record your answer first');
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    try {
        const data = await apiFetch('/evaluate-answer', 'POST', {
            session_id:  state.sessionId,
            question_id: state.currentQuestionId,
            user_answer: state.transcript
        });

        renderFeedback(data);
        if (data.score >= 60) correctAnswers++;
        navigateTo('feedback');

    } catch (err) {
        alert('Evaluation failed. Please try again.');
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function handleSkip() {
    stopRecognitionIfRunning();
    await loadNextQuestion();
}

// ══════════════════════════════════════════════
//  PAGE 3 — FEEDBACK
// ══════════════════════════════════════════════
function renderFeedback(data) {
    const score = data.score ?? 0;

    // ── Score circle ──
    const scoreNumber = document.querySelector('#page-feedback span[style*="1.4rem"]');
    const scorering   = document.querySelector('#page-feedback div[style*="conic-gradient"]');

    if (scoreNumber) scoreNumber.textContent = Math.round(score);
    if (scorering) {
        const degrees = (score / 100) * 360;
        scorering.style.background =
            `conic-gradient(#6C63FF ${degrees}deg, #F0F0F0 ${degrees}deg)`;
    }

    // ── Score label heading ──
    const scoreLabel = document.querySelector('#page-feedback div[style*="1.5rem"]');
    if (scoreLabel) {
        if (score >= 75) {
            scoreLabel.textContent = 'Strong answer! Well done.';
        } else if (score >= 50) {
            scoreLabel.textContent = 'Good effort! Room to improve.';
        } else {
            scoreLabel.textContent = 'Keep practicing. You\'ll get there.';
        }
    }

    // ── Feedback paragraph (below heading) ──
    const feedbackPara = document.querySelector('#page-feedback div[style*="1.5rem"] + p');
    if (feedbackPara) feedbackPara.textContent = data.feedback || '';

    // ── Keywords Detected panel → show data.strengths ──
    const keywordsPanel = document.querySelector('#page-feedback div[style*="grid"] > div:first-child div[style*="flex-wrap"]');
    if (keywordsPanel) {
        keywordsPanel.innerHTML = '';
        if (data.strengths) {
            const p = document.createElement('p');
            p.style.cssText = 'font-size:0.82rem;color:#1A1A1A;line-height:1.7;margin:0;';
            p.textContent = data.strengths;
            keywordsPanel.appendChild(p);
        }
    }

    // ── Missing Concepts panel ──
    const missingPanel = document.querySelector('#page-feedback div[style*="grid"] > div:last-child div[style*="flex-wrap"]');
    if (missingPanel) {
        missingPanel.innerHTML = '';
        const missing = data.missing_keywords || [];
        if (missing.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'font-size:0.82rem;color:#10B981;font-weight:600;margin:0;';
            p.textContent = 'All key concepts covered! 🎉';
            missingPanel.appendChild(p);
        } else {
            missing.forEach(kw => {
                const span = document.createElement('span');
                span.style.cssText =
                    'background:#FFFBEB;color:#D97706;font-size:0.75rem;font-weight:600;' +
                    'padding:0.25rem 0.65rem;border-radius:999px;border:1px solid #FDE68A;';
                span.textContent = kw;
                missingPanel.appendChild(span);
            });
        }
    }

    // ── Detailed Feedback paragraph ──
    const detailPara = document.querySelector('#page-feedback > div > div:last-child > div:nth-child(3) p:last-child');
    // Fallback: grab the standalone paragraph in the detailed-feedback card
    const detailCard = Array.from(document.querySelectorAll('#page-feedback p')).find(
        p => !p.closest('header') && p.style.color === 'rgb(107, 107, 107)'
    );
    const allDetailCards = document.querySelectorAll('#page-feedback div[style*="border-radius: 16px"]');
    // Last non-grid card is the Detailed Feedback card
    const detailedFeedbackCard = allDetailCards[allDetailCards.length - 1];
    if (detailedFeedbackCard) {
        const para = detailedFeedbackCard.querySelector('p:last-child');
        if (para) para.textContent = data.suggestions || '';
    }

    // ── Header: "Question X · Topic" ──
    const feedbackHeader = document.querySelector('#page-feedback header span:last-child');
    if (feedbackHeader) {
        feedbackHeader.textContent =
            `Question ${state.currentQuestionNumber} · ${state.currentTopic || ''}`;
    }

    // ── Next Question button ──
    const nextBtn = document.querySelector('#page-feedback .btn-accent[onclick]') ||
                    document.querySelector('#page-feedback .btn-accent');
    if (nextBtn) {
        nextBtn.onclick = null;
        nextBtn.addEventListener('click', async () => {
            stopCurrentAudio();
            await loadNextQuestion();
            navigateTo('interview');
        }, { once: true });
    }

    // ── End Session button ──
    const endSessionBtn = document.querySelector('#page-feedback .btn-secondary');
    if (endSessionBtn) {
        endSessionBtn.onclick = null;
        endSessionBtn.addEventListener('click', async () => {
            await loadSummary();
            navigateTo('summary');
        }, { once: true });
    }
}

// ══════════════════════════════════════════════
//  PAGE 4 — SUMMARY
// ══════════════════════════════════════════════
async function loadSummary() {
    if (!state.sessionId) return;
    try {
        const data = await apiFetch(`/summary/${state.sessionId}`);
        currentSummaryData = data;
        renderSummary(data);
    } catch (err) {
        alert('Could not load summary.');
    }
}

function renderSummary(data) {
    // ── Total Score card ──
    const totalScoreEl = document.getElementById('summary-total-score');
    if (totalScoreEl) {
        totalScoreEl.textContent = `${Math.round(data.total_score ?? 0)} / 100`;
    }

    // ── Questions Attempted card ──
    const questionsEl = document.getElementById('summary-questions');
    if (questionsEl) {
        questionsEl.textContent = data.questions_attempted ?? 0;
    }

    // ── Correct Answers card ──
    const correctEl = document.getElementById('summary-correct');
    if (correctEl) {
        correctEl.textContent = correctAnswers;
    }

    // ── Session Duration card ──
    const durationEl = document.getElementById('summary-duration');
    if (durationEl && sessionStartTime) {
        const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        const mins    = Math.floor(elapsed / 60);
        const secs    = elapsed % 60;
        durationEl.textContent = `${mins}m ${secs}s`;
    }

    // ── Topic-Wise Performance ──
    const topicContainer = document.getElementById('summary-topics-container');
    const topicEmpty = document.getElementById('summary-topics-empty');
    if (topicContainer && topicEmpty) {
        if (data.topic_scores && Object.keys(data.topic_scores).length > 0) {
            topicContainer.innerHTML = '';
            topicEmpty.style.display = 'none';
            Object.entries(data.topic_scores).forEach(([topic, score]) => {
                const barColor = score >= 70 ? '#6C63FF' : score >= 50 ? '#F59E0B' : '#EF4444';
                const row = document.createElement('div');
                row.innerHTML = `
                    <div style="display:flex;justify-content:space-between;margin-bottom:0.35rem;">
                        <span style="font-size:0.85rem;color:#1A1A1A;font-weight:700;">${escapeHtml(topic)}</span>
                        <span style="font-size:0.85rem;color:${barColor};font-weight:700;">${Math.round(score)}%</span>
                    </div>
                    <div style="height:8px;background:#F0F0F0;border-radius:999px;overflow:hidden;">
                        <div style="width:${Math.round(score)}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.6s ease;"></div>
                    </div>`;
                topicContainer.appendChild(row);
            });
        } else {
            topicContainer.innerHTML = '';
            topicEmpty.style.display = 'block';
        }
    }

    // ── Weak Topics ──
    const weakContainer = document.getElementById('summary-weak-container');
    const weakEmpty = document.getElementById('summary-weak-empty');
    if (weakContainer && weakEmpty) {
        weakContainer.innerHTML = '';
        const weakTopics = data.weak_topics || [];
        if (weakTopics.length === 0) {
            weakEmpty.style.display = 'block';
        } else {
            weakEmpty.style.display = 'none';
            weakTopics.forEach(topic => {
                const div = document.createElement('div');
                div.style.cssText =
                    'background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;' +
                    'padding:0.65rem 0.9rem;font-size:0.85rem;font-weight:700;color:#D97706;';
                div.textContent = topic;
                weakContainer.appendChild(div);
            });
        }
    }
}

// ══════════════════════════════════════════════
//  RESTART INTERVIEW
// ══════════════════════════════════════════════
function restartInterview() {
    // Reset state for a fresh session
    Object.assign(state, {
        sessionId: null,
        currentQuestionId: null,
        currentTopic: null,
        currentDifficulty: null,
        currentQuestionNumber: 0,
        selectedTopics: [],
        transcript: '',
        isRecording: false
    });
    sessionStartTime   = null;
    correctAnswers     = 0;
    selectedDifficulty = 'easy';
    // Deselect topic buttons
    document.querySelectorAll('.domain-btn').forEach(b => b.classList.remove('selected'));
    const startBtn = document.getElementById('start-interview-btn');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Start Interview';
    }
    navigateTo('setup');
}


// ──────────────────────────────────────────────
//  DEEPGRAM TTS — Aura model
// ──────────────────────────────────────────────
async function speakQuestion(text) {
    stopCurrentAudio(); // cancel any currently playing audio
    try {
        const response = await fetch(
            'https://api.deepgram.com/v1/speak?model=aura-asteria-en',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${DEEPGRAM_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            }
        );

        if (!response.ok) throw new Error(`Deepgram TTS HTTP ${response.status}`);

        const audioBlob = await response.blob();
        const audioUrl  = URL.createObjectURL(audioBlob);
        const audio     = new Audio(audioUrl);

        // Store reference so stopCurrentAudio() can cancel it
        window._currentAudio = audio;

        audio.play();

        // Clean up object URL after playback
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            window._currentAudio = null;
        };

    } catch (err) {
        console.error('Deepgram TTS error:', err);
    }
}

// ──────────────────────────────────────────────
//  UTILITIES
// ──────────────────────────────────────────────
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────
//  FIREBASE AUTHENTICATION
// ──────────────────────────────────────────────
function initAuth() {
    // Wait for Firebase to be ready
    const waitForFirebase = setInterval(() => {
        if (window._onAuthStateChanged && window._firebaseAuth) {
            clearInterval(waitForFirebase);

            // Listen for auth state changes
            window._onAuthStateChanged(window._firebaseAuth, (user) => {
                currentUser = user;

                if (user) {
                    // User is signed in — update UI
                    updateUserUI(user);

                    // If currently on login page, redirect to setup
                    if (document.getElementById('page-login').classList.contains('active')) {
                        navigateTo('setup');
                    }
                } else {
                    // User is signed out — redirect to login
                    const currentPage = Object.keys(pages).find(
                        key => pages[key].classList.contains('active')
                    );
                    const publicPages = ['home', 'login'];
                    if (!publicPages.includes(currentPage)) {
                        navigateTo('login');
                    }
                }
            });

            // Wire up Google Sign-In button
            const googleBtn = document.getElementById('google-signin-btn');
            if (googleBtn) {
                googleBtn.addEventListener('click', handleGoogleSignIn);
            }

            // Wire up Sign Out button
            const signOutBtn = document.getElementById('signout-btn');
            if (signOutBtn) {
                signOutBtn.addEventListener('click', handleSignOut);
            }
        }
    }, 100);
}

async function handleGoogleSignIn() {
    const errorEl   = document.getElementById('login-error');
    const loadingEl = document.getElementById('login-loading');
    const googleBtn = document.getElementById('google-signin-btn');

    errorEl.style.display   = 'none';
    loadingEl.style.display = 'block';
    googleBtn.disabled      = true;

    try {
        const result = await window._signInWithPopup(
            window._firebaseAuth,
            window._googleProvider
        );
        currentUser = result.user;
        updateUserUI(currentUser);
        navigateTo('setup');
    } catch (err) {
        errorEl.textContent  = 'Sign-in failed. Please try again.';
        errorEl.style.display = 'block';
        console.error('Google Sign-In error:', err);
    } finally {
        loadingEl.style.display = 'none';
        googleBtn.disabled      = false;
    }
}

async function handleSignOut() {
    try {
        await window._signOut(window._firebaseAuth);
        currentUser = null;

        // Reset interview state
        Object.assign(state, {
            sessionId: null,
            currentQuestionId: null,
            currentTopic: null,
            currentDifficulty: null,
            currentQuestionNumber: 0,
            selectedTopics: [],
            transcript: '',
            isRecording: false
        });

        navigateTo('login');
    } catch (err) {
        console.error('Sign out error:', err);
    }
}

function updateUserUI(user) {
    const avatar   = document.getElementById('user-avatar');
    const nameEl   = document.getElementById('user-name');

    if (avatar && user.photoURL) {
        avatar.src = user.photoURL;
        avatar.style.display = 'block';
    }
    if (nameEl) {
        nameEl.textContent = user.displayName || user.email || '';
    }
}

// ──────────────────────────────────────────────
//  JOB DESCRIPTION ANALYSIS
// ──────────────────────────────────────────────

async function handleAnalyzeJD() {
    const jdText = document.getElementById('jd-textarea')?.value?.trim();
    const analyzeBtn  = document.getElementById('analyze-jd-btn');
    const resultBox   = document.getElementById('jd-result');
    const resultText  = document.getElementById('jd-result-text');
    const noMatchBox  = document.getElementById('jd-no-match');
    const clearBtn    = document.getElementById('clear-jd-btn');

    // Hide previous results
    resultBox.style.display  = 'none';
    noMatchBox.style.display = 'none';

    if (!jdText || jdText.length < 20) {
        alert('Please paste a job description first (at least 20 characters).');
        return;
    }

    analyzeBtn.disabled    = true;
    analyzeBtn.textContent = 'Analyzing...';

    try {
        const data = await apiFetch('/analyze-jd', 'POST', { jd_text: jdText });

        if (data.detected_topics.length === 0) {
            // No topics found
            noMatchBox.style.display = 'block';
        } else {
            // Show result message
            resultText.textContent  = '✓ ' + data.message;
            resultBox.style.display = 'block';
            clearBtn.style.display  = 'inline-flex';

            // Auto-select detected topic buttons
            const domainBtns = document.querySelectorAll('.domain-btn');
            state.selectedTopics = [];

            domainBtns.forEach(btn => {
                btn.classList.remove('selected');
                const topicValue = btn.dataset.topicValue;
                if (data.detected_topics.includes(topicValue)) {
                    btn.classList.add('selected');
                    state.selectedTopics.push(topicValue);
                }
            });

            // Enable start button if topics detected
            const startBtn = document.getElementById('start-interview-btn');
            if (startBtn) {
                startBtn.disabled = state.selectedTopics.length === 0;
            }
        }

    } catch (err) {
        alert('JD analysis failed. Please check if the backend is running.');
        console.error('JD analysis error:', err);
    } finally {
        analyzeBtn.disabled    = false;
        analyzeBtn.textContent = '🔍 Analyze JD';
    }
}

function handleClearJD() {
    const jdTextarea = document.getElementById('jd-textarea');
    const resultBox  = document.getElementById('jd-result');
    const noMatchBox = document.getElementById('jd-no-match');
    const clearBtn   = document.getElementById('clear-jd-btn');

    if (jdTextarea) jdTextarea.value = '';
    resultBox.style.display  = 'none';
    noMatchBox.style.display = 'none';
    clearBtn.style.display   = 'none';

    // Deselect all topic buttons
    document.querySelectorAll('.domain-btn').forEach(b => b.classList.remove('selected'));
    state.selectedTopics = [];

    const startBtn = document.getElementById('start-interview-btn');
    if (startBtn) startBtn.disabled = true;
}

// ══════════════════════════════════════════════
//  REPORT DOWNLOAD
// ══════════════════════════════════════════════
function downloadReport() {
    if (!currentSummaryData) {
        alert('No summary data available to download.');
        return;
    }

    const data = currentSummaryData;
    let reportContent = `INTERVIEW SIMULATOR REPORT\n`;
    reportContent += `===================================\n\n`;
    reportContent += `Session Duration: ${document.querySelector('#page-summary .card-hover:nth-child(4) p:last-child')?.textContent || 'N/A'}\n`;
    reportContent += `Total Score: ${Math.round(data.total_score ?? 0)} / 100\n`;
    reportContent += `Questions Attempted: ${data.questions_attempted ?? 0}\n`;
    reportContent += `Correct Answers (Score >= 60): ${correctAnswers}\n\n`;

    if (data.topic_scores && Object.keys(data.topic_scores).length > 0) {
        reportContent += `TOPIC PERFORMANCE:\n`;
        reportContent += `------------------\n`;
        Object.entries(data.topic_scores).forEach(([topic, score]) => {
            reportContent += `- ${topic}: ${Math.round(score)}%\n`;
        });
        reportContent += `\n`;
    }

    if (data.weak_topics && data.weak_topics.length > 0) {
        reportContent += `AREAS FOR IMPROVEMENT:\n`;
        reportContent += `----------------------\n`;
        data.weak_topics.forEach(topic => {
            reportContent += `- ${topic}\n`;
        });
        reportContent += `\n`;
    }
    
    reportContent += `\nReport generated on: ${new Date().toLocaleString()}\n`;

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Interview_Report_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
