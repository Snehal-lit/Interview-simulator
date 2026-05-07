"""
main.py
-------
Entry point for the Web-Based Adaptive Interview Simulator FastAPI backend.

Wires together all modules (question_bank, evaluator, adaptive) and exposes
the REST API endpoints consumed by the frontend.

Run with:
    uvicorn main:app --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    SessionStartRequest, SessionStartResponse,
    NextQuestionRequest, NextQuestionResponse,
    EvaluateRequest, EvaluateResponse,
    SummaryResponse,
    AnalyzeJDRequest, AnalyzeJDResponse,
)
from question_bank import get_question_by_id
from evaluator import final_score, generate_feedback
from adaptive import (
    create_session, get_next_question,
    update_after_answer, get_summary,
    SESSIONS,
)

# ---------------------------------------------------------------------------
# APP SETUP
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Interview Simulator API",
    description="Adaptive backend for a rule-based interview simulator.",
    version="1.0.0",
)

# Allow all origins so the frontend (served separately) can reach the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.on_event("startup")
async def on_startup() -> None:
    print("=" * 55)
    print("  Interview Simulator API is live!")
    print("  Docs  → http://127.0.0.1:8000/docs")
    print("  Health→ http://127.0.0.1:8000/health")
    print("=" * 55)


# ---------------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------------

# Simple liveness check — confirms the API server is up and reachable.
@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Interview Simulator API is running"}


# Creates a new interview session for a user with the specified topics.
@app.post("/start-session", response_model=SessionStartResponse)
async def start_session(body: SessionStartRequest):
    if not body.topics:
        raise HTTPException(
            status_code=400,
            detail="Topics list cannot be empty",
        )

    session_id = create_session(body.user_id, body.topics, body.starting_difficulty)

    return SessionStartResponse(
        session_id=session_id,
        message=f"Session started successfully for user: {body.user_id}",
    )


# Fetches the next adaptive question for an active session.
@app.post("/get-question", response_model=NextQuestionResponse)
async def get_question(body: NextQuestionRequest):
    question = get_next_question(body.session_id)

    if question is None:
        raise HTTPException(
            status_code=404,
            detail="No more questions available or session not found",
        )

    session = SESSIONS.get(body.session_id)
    question_number = session["question_count"] if session else 0

    return NextQuestionResponse(
        question_id=question["id"],
        question_text=question["question"],
        topic=question["topic"],
        difficulty=question["difficulty"],
        question_number=question_number,
    )


# Evaluates the user's answer, records the score, and returns detailed feedback.
@app.post("/evaluate-answer", response_model=EvaluateResponse)
async def evaluate_answer(body: EvaluateRequest):
    question = get_question_by_id(body.question_id)

    if question is None:
        raise HTTPException(
            status_code=404,
            detail="Question not found",
        )

    # Score the user's answer against keywords and model answer.
    score_result = final_score(
        body.user_answer,
        question["keywords"],
        question["model_answer"],
    )

    # Generate human-readable feedback from the scores.
    feedback_result = generate_feedback(
        score_result["score"],
        score_result["missing_keywords"],
        score_result["keyword_score"],
        score_result["cosine_score"],
    )

    # Persist the score and adapt difficulty for the next question.
    update_after_answer(body.session_id, question["topic"], score_result["score"])

    return EvaluateResponse(
        score=score_result["score"],
        keyword_score=score_result["keyword_score"],
        cosine_score=score_result["cosine_score"],
        rules_passed=score_result["rules_passed"],
        missing_keywords=score_result["missing_keywords"],
        feedback=feedback_result["feedback"],
        strengths=feedback_result["strengths"],
        suggestions=feedback_result["suggestions"],
    )


# Returns the complete performance summary for a finished session.
@app.get("/summary/{session_id}", response_model=SummaryResponse)
async def session_summary(session_id: str):
    summary = get_summary(session_id)

    if summary is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    return SummaryResponse(
        session_id=summary["session_id"],
        total_score=summary["total_score"],
        topic_scores=summary["topic_scores"],
        weak_topics=summary["weak_topics"],
        questions_attempted=summary["questions_attempted"],
    )

# Analyzes job description text and returns matching interview topics
@app.post("/analyze-jd", response_model=AnalyzeJDResponse)
async def analyze_jd(body: AnalyzeJDRequest):
    jd_lower = body.jd_text.lower()

    # Keyword map — each topic has a list of trigger keywords
    topic_keywords = {
        "DSA": [
            "data structures", "algorithms", "array", "linked list",
            "tree", "graph", "sorting", "searching", "recursion",
            "dynamic programming", "stack", "queue", "binary search",
            "complexity", "big o", "leetcode", "competitive programming",
            "dsa", "data structure"
        ],
        "OS": [
            "operating system", "os", "process", "thread", "deadlock",
            "scheduling", "memory management", "virtual memory", "paging",
            "semaphore", "mutex", "linux", "unix", "kernel",
            "concurrency", "multithreading", "synchronization",
            "file system", "cpu scheduling", "system calls"
        ],
        "DBMS": [
            "database", "sql", "mysql", "postgresql", "mongodb",
            "dbms", "normalization", "query", "schema", "indexing",
            "transaction", "acid", "joins", "stored procedure",
            "nosql", "relational database", "orm", "data modeling",
            "er diagram", "primary key", "foreign key"
        ]
    }

    detected = []
    matched_keywords = {}

    for topic, keywords in topic_keywords.items():
        found = [kw for kw in keywords if kw in jd_lower]
        if found:
            detected.append(topic)
            matched_keywords[topic] = found[:3]  # show max 3 matched keywords

    if not detected:
        return AnalyzeJDResponse(
            detected_topics=[],
            message="No specific technical topics detected. Please select topics manually."
        )

    # Build readable message
    parts = []
    for topic, kws in matched_keywords.items():
        parts.append(f"{topic} (matched: {', '.join(kws)})")

    message = "Detected topics: " + " · ".join(parts)

    return AnalyzeJDResponse(
        detected_topics=detected,
        message=message
    )
