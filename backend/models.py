"""
models.py
---------
Pydantic request and response models for the Web-Based Adaptive
Interview Simulator FastAPI backend.
"""

from pydantic import BaseModel
from typing import Optional


# ===========================================================================
# SESSION MODELS
# ===========================================================================

# Request body to start a new interview session for a specific user and topics.
class SessionStartRequest(BaseModel):
    user_id: str
    topics: list[str]
    starting_difficulty: str = "easy"


# Response returned after a session is successfully created.
class SessionStartResponse(BaseModel):
    session_id: str
    message: str


# ===========================================================================
# QUESTION MODELS
# ===========================================================================

# Request body to fetch the next question for an ongoing session.
class NextQuestionRequest(BaseModel):
    session_id: str


# Response containing the next question details to display to the user.
class NextQuestionResponse(BaseModel):
    question_id: str
    question_text: str
    topic: str
    difficulty: str
    question_number: int


# ===========================================================================
# EVALUATION MODELS
# ===========================================================================

# Request body containing the user's answer to a specific question in a session.
class EvaluateRequest(BaseModel):
    session_id: str
    question_id: str
    user_answer: str


# Response returned after evaluating the user's answer with scoring and feedback.
class EvaluateResponse(BaseModel):
    score: float
    keyword_score: float
    cosine_score: float
    rules_passed: bool
    missing_keywords: list[str]
    feedback: str
    strengths: str
    suggestions: str


# ===========================================================================
# SUMMARY MODELS
# ===========================================================================

# Response containing the complete performance summary at the end of a session.
class SummaryResponse(BaseModel):
    session_id: str
    total_score: float
    topic_scores: dict
    weak_topics: list[str]
    questions_attempted: int

# ===========================================================================
# JD ANALYSIS MODELS
# ===========================================================================

class AnalyzeJDRequest(BaseModel):
    jd_text: str

class AnalyzeJDResponse(BaseModel):
    detected_topics: list[str]
    message: str
