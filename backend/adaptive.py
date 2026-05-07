"""
adaptive.py
-----------
Session management and adaptive question selection engine for the
Web-Based Adaptive Interview Simulator backend.

All state is stored in the module-level SESSIONS dict — no database,
no AI, no external calls. Logic is fully deterministic.
"""

import uuid
import random
from question_bank import get_questions_by_topic_and_difficulty, get_random_question


# ---------------------------------------------------------------------------
# IN-MEMORY SESSION STORE
# ---------------------------------------------------------------------------

# Global dict that holds all active interview sessions keyed by session_id.
SESSIONS: dict = {}

# Ordered difficulty levels used when stepping up or down.
_DIFFICULTY_LEVELS = ["easy", "medium", "hard"]


# ---------------------------------------------------------------------------
# 1. CREATE SESSION
# ---------------------------------------------------------------------------

# Initialises a brand-new interview session for the given user and topic list.
# Returns a unique session_id that the client must include in every subsequent
# request.
def create_session(user_id: str, topics: list[str],
                   starting_difficulty: str = "easy") -> str:
    """
    Create and store a new interview session.

    Args:
        user_id:              The identifier of the user starting the session.
        topics:               List of topics the user wants to be interviewed on
                              (e.g. ["DSA", "OS", "DBMS"]).
        starting_difficulty:  Initial difficulty tier for all topics
                              ("easy", "medium", or "hard"). Defaults to "easy".

    Returns:
        A unique session_id string (UUID4).
    """
    session_id = str(uuid.uuid4())

    SESSIONS[session_id] = {
        "user_id":            user_id,
        "topics":             topics,
        "asked_question_ids": [],
        "scores_per_topic":   {topic: [] for topic in topics},
        "current_difficulty": {topic: starting_difficulty for topic in topics},
        "phase":              "exploration",
        "question_count":     0,
        "total_scores":       [],
        "exploration_index":  0,
    }

    return session_id


# ---------------------------------------------------------------------------
# 2. GET NEXT QUESTION
# ---------------------------------------------------------------------------

# Selects the most appropriate next question for the session using either
# round-robin topic cycling (exploration phase) or score-driven weak-topic
# targeting (adaptive phase). Returns None only when no questions remain.
def get_next_question(session_id: str) -> dict | None:
    """
    Select and return the next question for the given session.

    Exploration phase  — cycles through topics in round-robin order,
                         using each topic's current difficulty.
    Adaptive phase     — targets the topic with the lowest average score,
                         adjusting difficulty as needed.

    Args:
        session_id: The active session identifier.

    Returns:
        A question dict from the question bank, or None if exhausted.
    """
    session = SESSIONS.get(session_id)
    if session is None:
        return None

    asked_ids  = session["asked_question_ids"]
    topics     = session["topics"]
    phase      = session["phase"]

    # -----------------------------------------------------------------------
    # EXPLORATION PHASE: one round-robin pass through all topics
    # -----------------------------------------------------------------------
    if phase == "exploration":
        exploration_index = session["exploration_index"]
        topic      = topics[exploration_index % len(topics)]
        difficulty = session["current_difficulty"][topic]

        question = get_random_question(topic, difficulty, asked_ids)

        # Fall back up the difficulty ladder if no question found.
        if question is None:
            for fallback in _DIFFICULTY_LEVELS:
                if fallback == difficulty:
                    continue
                question = get_random_question(topic, fallback, asked_ids)
                if question is not None:
                    break

        # All questions for this topic are exhausted — switch phase and recurse.
        if question is None:
            session["phase"] = "adaptive"
            return get_next_question(session_id)

        # Record the question and advance state.
        asked_ids.append(question["id"])
        session["exploration_index"] += 1
        session["question_count"]    += 1

        # After one full round-robin cycle, move to the adaptive phase.
        if session["exploration_index"] >= len(topics):
            session["phase"] = "adaptive"

        return question

    # -----------------------------------------------------------------------
    # ADAPTIVE PHASE: always target the weakest topic
    # -----------------------------------------------------------------------
    if phase == "adaptive":
        # Identify the topic with the lowest average score.
        weak_topic = None
        lowest_avg = float("inf")

        for topic in topics:
            scores = session["scores_per_topic"].get(topic, [])
            if scores:
                avg = sum(scores) / len(scores)
                if avg < lowest_avg:
                    lowest_avg = avg
                    weak_topic = topic

        # Fall back to the first topic if no scores exist yet.
        if weak_topic is None:
            weak_topic = topics[0]

        difficulty = session["current_difficulty"][weak_topic]
        question   = get_random_question(weak_topic, difficulty, asked_ids)

        # Try adjacent difficulties for the weak topic.
        if question is None:
            for fallback in _DIFFICULTY_LEVELS:
                if fallback == difficulty:
                    continue
                question = get_random_question(weak_topic, fallback, asked_ids)
                if question is not None:
                    break

        # Weak topic is fully exhausted — try every other topic at all levels.
        if question is None:
            for other_topic in topics:
                if other_topic == weak_topic:
                    continue
                for fallback in _DIFFICULTY_LEVELS:
                    question = get_random_question(other_topic, fallback, asked_ids)
                    if question is not None:
                        break
                if question is not None:
                    break

        # Truly nothing left.
        if question is None:
            return None

        asked_ids.append(question["id"])
        session["question_count"] += 1
        return question

    return None


# ---------------------------------------------------------------------------
# 3. UPDATE AFTER ANSWER
# ---------------------------------------------------------------------------

# Records the score the user received for their most recent answer and updates
# the session state, including adjusting the topic's difficulty tier so the
# next question is appropriately challenging.
def update_after_answer(session_id: str, topic: str, score: float) -> None:
    """
    Persist the answer score and adapt the difficulty for the given topic.

    Difficulty adjustment rules:
        score >= 70  → step up   (easy→medium, medium→hard, hard stays)
        score <  40  → step down (hard→medium, medium→easy, easy stays)
        40–69        → no change

    Args:
        session_id: The active session identifier.
        topic:      The topic of the question that was just answered.
        score:      The numeric score received (0–100 scale).
    """
    session = SESSIONS.get(session_id)
    if session is None:
        return

    # Record the score in both topic-level and overall lists.
    session["scores_per_topic"].setdefault(topic, []).append(score)
    session["total_scores"].append(score)

    # Adjust difficulty based on performance thresholds.
    current = session["current_difficulty"].get(topic, "easy")
    current_index = _DIFFICULTY_LEVELS.index(current)

    if score >= 70:
        # Increase difficulty (capped at "hard").
        new_index = min(current_index + 1, len(_DIFFICULTY_LEVELS) - 1)
    elif score < 40:
        # Decrease difficulty (floored at "easy").
        new_index = max(current_index - 1, 0)
    else:
        # Keep difficulty unchanged.
        new_index = current_index

    session["current_difficulty"][topic] = _DIFFICULTY_LEVELS[new_index]


# ---------------------------------------------------------------------------
# 4. GET SUMMARY
# ---------------------------------------------------------------------------

# Computes and returns a complete performance summary for the session,
# including overall average score, per-topic averages, and a list of weak
# topics where the user scored below 50 on average.
def get_summary(session_id: str) -> dict | None:
    """
    Generate a full performance summary for the completed session.

    Args:
        session_id: The active session identifier.

    Returns:
        A summary dict, or None if the session does not exist.
    """
    session = SESSIONS.get(session_id)
    if session is None:
        return None

    total_scores = session["total_scores"]

    # Overall average score.
    if total_scores:
        total_score = round(sum(total_scores) / len(total_scores), 2)
    else:
        total_score = 0.0

    # Per-topic average scores (only for topics with at least one score).
    topic_scores = {}
    for topic, scores in session["scores_per_topic"].items():
        if scores:
            topic_scores[topic] = round(sum(scores) / len(scores), 2)

    # Topics where the user performed below the 50-point threshold.
    weak_topics = [
        topic for topic, avg in topic_scores.items()
        if avg < 50
    ]

    return {
        "session_id":         session_id,
        "total_score":        total_score,
        "topic_scores":       topic_scores,
        "weak_topics":        weak_topics,
        "questions_attempted": session["question_count"],
    }
