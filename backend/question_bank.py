"""
question_bank.py
----------------
Backend module for the Web-Based Adaptive Interview Simulator.

Loads all questions from the 3 JSON files (dsa.json, os.json, dbms.json)
into memory on import and exposes helper functions for fetching and
filtering questions.

Folder structure expected:
    backend/
    ├── question_bank.py   ← this file
    ├── questions/
    │   ├── dsa.json
    │   ├── os.json
    │   └── dbms.json
"""

import json
import os
import random

# ---------------------------------------------------------------------------
# LOADING — runs automatically on import
# ---------------------------------------------------------------------------

# Resolve the path to the questions/ folder relative to this file so the
# module works regardless of the working directory from which it is imported.
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_QUESTIONS_DIR = os.path.join(_BASE_DIR, "questions")

# Maps each topic label to the corresponding JSON filename.
_TOPIC_FILES = {
    "DSA":  "dsa.json",
    "OS":   "os.json",
    "DBMS": "dbms.json",
}

# ALL_QUESTIONS holds every question object from all three files merged into
# a single flat list. This is the single source of truth for all queries.
ALL_QUESTIONS: list = []


def _load_questions() -> None:
    """
    Internal helper called once at import time.
    Reads each JSON file, appends its questions to ALL_QUESTIONS, and prints
    a per-topic summary. Missing or malformed files are reported gracefully
    without crashing the module.
    """
    totals = {}

    for topic, filename in _TOPIC_FILES.items():
        filepath = os.path.join(_QUESTIONS_DIR, filename)

        # Graceful handling: warn and skip if the file is not found.
        if not os.path.exists(filepath):
            print(f"[question_bank] WARNING: File not found — {filepath}")
            print(f"[question_bank]          '{topic}' questions will not be available.")
            totals[topic] = 0
            continue

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                questions = json.load(f)

            if not isinstance(questions, list):
                raise ValueError(f"Expected a JSON array, got {type(questions).__name__}")

            ALL_QUESTIONS.extend(questions)
            totals[topic] = len(questions)

        except (json.JSONDecodeError, ValueError) as err:
            print(f"[question_bank] ERROR: Could not parse '{filepath}': {err}")
            totals[topic] = 0

    # Print a tidy confirmation summary after loading all files.
    print("[question_bank] Question bank loaded successfully:")
    for topic, count in totals.items():
        print(f"  • {topic}: {count} questions")
    print(f"  ─────────────────────────────")
    print(f"  Total: {len(ALL_QUESTIONS)} questions\n")


# Trigger loading immediately when the module is imported.
_load_questions()


# ---------------------------------------------------------------------------
# PUBLIC HELPER FUNCTIONS
# ---------------------------------------------------------------------------


# Returns a single question dict whose 'id' field matches question_id,
# or None if no match is found. The search is case-sensitive and checks
# every entry in ALL_QUESTIONS.
def get_question_by_id(question_id: str) -> dict | None:
    """
    Look up a question by its unique ID (e.g. "DSA_001", "OS_007").

    Args:
        question_id: The exact ID string to search for.

    Returns:
        The matching question dict, or None if not found.
    """
    for question in ALL_QUESTIONS:
        if question.get("id") == question_id:
            return question
    return None


# Filters ALL_QUESTIONS by the 'topic' field and returns a list of all
# matching question dicts. The topic value must be exactly "DSA", "OS",
# or "DBMS" (case-sensitive). Returns an empty list if no matches exist.
def get_questions_by_topic(topic: str) -> list:
    """
    Retrieve all questions belonging to a specific topic.

    Args:
        topic: One of "DSA", "OS", or "DBMS" (case-sensitive).

    Returns:
        A list of question dicts for that topic. Empty list if none found.
    """
    return [q for q in ALL_QUESTIONS if q.get("topic") == topic]


# Filters ALL_QUESTIONS by both 'topic' and 'difficulty' and returns all
# matching question dicts. Both arguments are case-sensitive.
# topic must be "DSA", "OS", or "DBMS".
# difficulty must be "easy", "medium", or "hard".
def get_questions_by_topic_and_difficulty(topic: str, difficulty: str) -> list:
    """
    Retrieve all questions matching a specific topic AND difficulty level.

    Args:
        topic:      One of "DSA", "OS", or "DBMS" (case-sensitive).
        difficulty: One of "easy", "medium", or "hard" (case-sensitive).

    Returns:
        A filtered list of question dicts. Empty list if no matches.
    """
    return [
        q for q in ALL_QUESTIONS
        if q.get("topic") == topic and q.get("difficulty") == difficulty
    ]


# Collects every unique value of the 'topic' field across ALL_QUESTIONS,
# sorts them alphabetically, and returns the resulting list.
# Example return value: ["DBMS", "DSA", "OS"]
def get_all_topics() -> list:
    """
    Return a sorted list of all unique topic names present in the question bank.

    Returns:
        A sorted list of topic strings, e.g. ["DBMS", "DSA", "OS"].
    """
    return sorted({q.get("topic") for q in ALL_QUESTIONS if q.get("topic")})


# Selects one random question for a given topic and difficulty, respecting
# an exclusion list of already-seen question IDs to avoid repetition.
# Returns None if no eligible questions remain after filtering.
def get_random_question(topic: str, difficulty: str, exclude_ids: list) -> dict | None:
    """
    Pick a single random question for the given topic and difficulty that has
    not already been seen (i.e. whose id is not in exclude_ids).

    Args:
        topic:       One of "DSA", "OS", or "DBMS" (case-sensitive).
        difficulty:  One of "easy", "medium", or "hard" (case-sensitive).
        exclude_ids: A list of question ID strings to skip (already answered).

    Returns:
        A randomly chosen question dict, or None if no eligible questions exist.
    """
    pool = get_questions_by_topic_and_difficulty(topic, difficulty)

    # Remove questions the user has already seen.
    eligible = [q for q in pool if q.get("id") not in exclude_ids]

    if not eligible:
        return None

    return random.choice(eligible)
