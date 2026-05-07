"""
evaluator.py
------------
Rule-based answer evaluation engine for the Web-Based Adaptive
Interview Simulator backend.

All scoring is deterministic and explainable — no AI, no LLMs,
no external API calls. Only scikit-learn and Python built-ins.

Dependencies:
    pip install scikit-learn
"""

from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# ---------------------------------------------------------------------------
# 1. KEYWORD SCORE
# ---------------------------------------------------------------------------

# Measures how many of the expected keywords appear anywhere in the user's
# answer (case-insensitive). Returns a ratio from 0.0 (none matched) to
# 1.0 (all matched). Returns 0.0 immediately if the keywords list is empty.
def keyword_score(user_answer: str, keywords: list[str]) -> float:
    """
    Compute the fraction of expected keywords present in the user's answer.

    Args:
        user_answer: The raw text answer provided by the user.
        keywords:    List of important technical terms to look for.

    Returns:
        A float in the range [0.0, 1.0].
    """
    if not keywords:
        return 0.0

    answer_lower = user_answer.lower()
    matched = sum(1 for kw in keywords if kw.lower() in answer_lower)
    return matched / len(keywords)


# ---------------------------------------------------------------------------
# 2. COSINE SIMILARITY SCORE
# ---------------------------------------------------------------------------

# Measures semantic overlap between the user's answer and the model answer
# using TF-IDF vector representations and cosine similarity. Returns a float
# between 0.0 and 1.0. Returns 0.0 for empty inputs or on any processing error.
def cosine_similarity_score(user_answer: str, model_answer: str) -> float:
    if not user_answer.strip() or not model_answer.strip():
        return 0.0

    try:
        vectorizer = CountVectorizer()
        count_matrix = vectorizer.fit_transform([user_answer, model_answer])
        score = cosine_similarity(count_matrix[0:1], count_matrix[1:2])
        return float(score[0][0])
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# 3. RULE CHECKS
# ---------------------------------------------------------------------------

# Applies two minimum quality gates to the user's answer:
#   (a) The answer must contain at least 15 words (not a one-liner).
#   (b) At least 30% of the expected keywords must be present.
# Returns True only if BOTH conditions pass; False otherwise.
def rule_checks(user_answer: str, keywords: list[str]) -> bool:
    """
    Validate the user's answer against minimum quality rules.

    Rules:
        1. Word count of user_answer must be >= 15.
        2. keyword_score must be >= 0.3 (at least 30% of keywords matched).

    Args:
        user_answer: The raw text answer provided by the user.
        keywords:    List of important technical terms to check.

    Returns:
        True if both rules pass, False otherwise.
    """
    word_count = len(user_answer.split())
    kw_score = keyword_score(user_answer, keywords)

    return word_count >= 15 and kw_score >= 0.3


# ---------------------------------------------------------------------------
# 4. FINAL SCORE
# ---------------------------------------------------------------------------

# Orchestrates the complete evaluation pipeline:
#   1. Computes keyword_score, cosine_similarity_score, and rule_checks.
#   2. Blends the two scores (40% keyword weight, 60% cosine weight).
#   3. Applies a 20% penalty if rule checks fail.
#   4. Scales the result to a 0–100 range.
#   5. Identifies which keywords were missing from the user's answer.
def final_score(
    user_answer: str,
    keywords: list[str],
    model_answer: str,
) -> dict:
    """
    Run the full evaluation pipeline and return a results dict.

    Scoring formula:
        base  = (0.4 × keyword_score) + (0.6 × cosine_score)
        base  = base × 0.8   if rule_checks fails (penalty)
        score = round(base × 100, 2)

    Args:
        user_answer:  The raw text answer provided by the user.
        keywords:     List of important technical terms from the question.
        model_answer: The reference answer from the question bank.

    Returns:
        A dict with keys:
            score            – final score scaled to 0–100 (float)
            keyword_score    – raw keyword match ratio 0–1 (float)
            cosine_score     – raw cosine similarity 0–1 (float)
            rules_passed     – whether minimum quality rules were met (bool)
            missing_keywords – keywords absent from the user's answer (list[str])
    """
    kw_score     = keyword_score(user_answer, keywords)
    cos_score    = cosine_similarity_score(user_answer, model_answer)
    rules_passed = rule_checks(user_answer, keywords)

    base = (0.4 * kw_score) + (0.6 * cos_score)

    if not rules_passed:
        base = base * 0.8

    score = round(base * 100, 2)

    answer_lower = user_answer.lower()
    missing_keywords = [kw for kw in keywords if kw.lower() not in answer_lower]

    return {
        "score":            score,
        "keyword_score":    round(kw_score, 4),
        "cosine_score":     round(cos_score, 4),
        "rules_passed":     rules_passed,
        "missing_keywords": missing_keywords,
    }


# ---------------------------------------------------------------------------
# 5. GENERATE FEEDBACK
# ---------------------------------------------------------------------------

# Converts the numeric evaluation results into human-readable feedback strings.
# Feedback and strengths are tiered by score (>=75, >=50, <50).
# Suggestions prompt the user to address any missing keywords, or congratulate
# them if all keywords were covered.
def generate_feedback(
    score: float,
    missing_keywords: list[str],
    keyword_score: float,
    cosine_score: float,
) -> dict:
    """
    Generate human-readable feedback based on evaluation results.

    Tiers:
        score >= 75  → Strong answer
        score >= 50  → Decent answer
        score <  50  → Needs improvement

    Args:
        score:            Final score on a 0–100 scale.
        missing_keywords: Keywords absent from the user's answer.
        keyword_score:    Raw keyword match ratio (unused in logic, available
                          for future enhancements).
        cosine_score:     Raw cosine similarity (unused in logic, available
                          for future enhancements).

    Returns:
        A dict with keys:
            feedback    – overall qualitative assessment (str)
            strengths   – what the user did well (str)
            suggestions – specific improvement advice (str)
    """
    # Determine feedback and strengths based on score tier.
    if score >= 75:
        feedback  = "Good answer! You demonstrated strong understanding."
        strengths = "Strong concept coverage with relevant terminology."
    elif score >= 50:
        feedback  = "Decent answer. Some key concepts need more depth."
        strengths = "You covered the basics but missed some important points."
    else:
        feedback  = "Answer needs improvement. Focus on core concepts."
        strengths = "Keep practicing. Review the topic fundamentals."

    # Suggestions are driven by which keywords the user missed.
    if missing_keywords:
        suggestions = "Try including these concepts: " + ", ".join(missing_keywords)
    else:
        suggestions = "Excellent! You covered all the key concepts."

    return {
        "feedback":    feedback,
        "strengths":   strengths,
        "suggestions": suggestions,
    }
