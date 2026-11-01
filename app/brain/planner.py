"""
Planner module for SUNDAY.
Translates user instructions into structured, validated execution graphs
with multi-turn conversational context and natural human dialogue.
"""
import uuid
import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from app.brain.prompts import SYSTEM_PROMPT
from app.brain.ollama_client import ollama_client, OllamaClient
from app.tools.registry import tool_registry, ToolRegistry
from app.permissions.policy import get_tool_risk
from app.memory.conversation import conversation_manager
from app.audit.logger import audit_logger


class PlannedStep(BaseModel):
    step_order: int
    tool_name: str
    arguments: Dict[str, Any]
    risk_level: str


class ExecutionPlan(BaseModel):
    objective: str
    is_conversational: bool = False
    is_ambiguous: bool = False
    clarifying_question: Optional[str] = None
    steps: List[PlannedStep] = Field(default_factory=list)
    spoken_summary: str = ""


def extract_meeting_time(text: str) -> Optional[str]:
    """Extracts meeting time from natural language expressions (e.g. 'at 9 a.m.', '9 am', '2:30 pm', 'at 11')."""
    t_clean = text.lower().replace(".", "").strip()

    # Pattern 1: HH:MM am/pm
    m1 = re.search(r'\b(\d{1,2}):(\d{2})\s*(am|pm)?\b', t_clean)
    if m1:
        hr = int(m1.group(1))
        mn = m1.group(2)
        ampm = m1.group(3)
        return f"{hr}:{mn} {ampm.upper()}" if ampm else f"{hr}:{mn}"

    # Pattern 2: HH am/pm (e.g. '9 am', 'at 9 am', '9am')
    m2 = re.search(r'\b(\d{1,2})\s*(am|pm)\b', t_clean)
    if m2:
        return f"{int(m2.group(1))}:00 {m2.group(2).upper()}"

    # Pattern 3: 'at 9' or 'at 10 oclock'
    m3 = re.search(r'\bat\s+(\d{1,2})(?:\s*o\'?clock)?\b', t_clean)
    if m3:
        hr = int(m3.group(1))
        ampm = "AM" if hr in range(7, 12) else "PM"
        return f"{hr}:00 {ampm}"

    return None


def extract_requested_word_count(text: str, current_count: int = 250) -> Optional[int]:
    """Finds target word count specified in a prompt, supporting absolute counts and relative additions."""
    t_lower = text.lower()

    # Relative addition: 'increase by 200 words', 'add 200 words', 'by 200 words', 'by 200'
    m_rel = re.search(r'\bby\s+(\d+)\s*(?:words?)?\b', t_lower)
    if m_rel:
        return current_count + int(m_rel.group(1))

    m_add = re.search(r'(?:increase|expand|add|more)\s*(?:the\s+number\s+of\s+words\s*)?(?:by\s+)?(\d+)\s*(?:words?)?', t_lower)
    if m_add and ("by " in t_lower or "add " in t_lower or "more " in t_lower):
        return current_count + int(m_add.group(1))

    # Absolute count: 'to 250 words', '250 words', 'of 250 words'
    m_abs = re.search(r'(\d+)\s*(?:words?)\b', t_lower)
    if m_abs:
        return int(m_abs.group(1))

    return None


def format_error_for_speech(raw_error: str) -> str:
    """
    Simplifies raw exception/system error text into a concise, natural, single-sentence spoken explanation.
    Uses Ollama LLM if healthy, or clean heuristic parsing so TTS never reads symbols or file paths.
    """
    if not raw_error:
        return "I encountered an issue while processing your request."

    # Try Ollama for natural conversational explanation
    try:
        from app.brain.ollama_client import ollama_client
        if ollama_client.check_health():
            prompt = (
                f"You are SUNDAY voice assistant. Convert this technical error into a single friendly, concise spoken sentence for the user. "
                f"Do not read file paths, brackets, or code symbols. Explain what went wrong in plain English:\n\n"
                f"Error: {raw_error}"
            )
            resp = ollama_client.chat([{"role": "user", "content": prompt}], timeout=4.0)
            clean_resp = resp.strip().replace('"', '').replace('\n', ' ')
            if clean_resp and len(clean_resp) < 140 and "{" not in clean_resp:
                return clean_resp
    except Exception:
        pass

    # Heuristic fallback (fast & 100% offline)
    err_lower = raw_error.lower()
    if "permission denied" in err_lower or "errno 13" in err_lower or "winerror 5" in err_lower:
        if "word" in err_lower or ".docx" in err_lower:
            return "I could not save the Word document because it is currently open in Microsoft Word. Please close Word and try again."
        elif "excel" in err_lower or ".xlsx" in err_lower:
            return "I could not update the spreadsheet because it is open in Excel. Please close Excel and try again."
        else:
            return "I could not update the desktop file because it is currently open in another program."
    elif "file not found" in err_lower or "no such file" in err_lower or "errno 2" in err_lower:
        return "I could not locate the requested document on your laptop."
    elif "connection refused" in err_lower or "socket" in err_lower or "winerror 10013" in err_lower:
        return "The local service is not reachable right now."
    elif "timeout" in err_lower:
        return "The operation timed out. Please try your request again."

    # Clean generic fallback: remove code symbols, brackets, and paths
    clean = re.sub(r'\[.*?\]', '', raw_error)
    clean = re.sub(r'[A-Za-z]:\\[\w\\\.\-]+', 'the file', clean)
    clean = re.sub(r'[\'\"\{\}\(\)_]', ' ', clean)
    clean = ' '.join(clean.split())
    return f"I encountered a problem: {clean[:80]}."


def generate_comprehensive_essay(topic: str, min_words: int = 250) -> str:
    """
    Generates an articulate, beautifully structured essay with sections and guaranteed word count (>= min_words).
    """
    from datetime import datetime
    today_str = datetime.now().strftime("%B %d, %Y")
    topic_title = topic.strip().title() if topic else "Rain"

    if "rain" in topic_title.lower():
        sections = [
            f"====================================================\n"
            f"ESSAY: THE BEAUTY, ECOLOGY, AND SIGNIFICANCE OF RAIN\n"
            f"Author: SUNDAY Offline AI Employee (Windows 11)\n"
            f"Date: {today_str}\n"
            f"====================================================\n",

            "1. INTRODUCTION AND NATURE'S VITAL HARMONY\n"
            "Rain is undeniably one of nature’s most profound, atmospheric, and evocative phenomena. Far more than a routine meteorological event, it constitutes a life-affirming natural cycle that rejuvenates the parched landscape, purifies the air we breathe, and awakens a universal sense of renewal across all living beings. In every corner of the planet, rainfall represents vitality, resilience, and the eternal rhythm of ecological balance.",

            "2. THE PHENOMENON OF PETRICHOR AND SENSORY AWAKENING\n"
            "As raindrops make contact with dry, sun-baked earth, they trigger the release of an unmistakable earthy aroma known scientifically as petrichor. Synthesized through botanical geosmin and natural plant oils, this distinctive scent exerts a soothing psychological and emotional impact on human consciousness. Skies transition gracefully into silver, charcoal, and slate tones, cooling tropical temperatures and casting a serene, reflective tranquility over bustling urban centers and pastoral countryside alike.",

            "3. ECOLOGICAL LIFELINE AND AGRICULTURAL SUSTENANCE\n"
            "From an environmental and biological perspective, precipitation serves as the quintessential engine of agriculture and terrestrial biodiversity. It directly replenishes subterranean aquifers, feeds expansive river basins, and fills essential reservoirs that power cities and irrigate continental farm belts. In agrarian traditions worldwide, seasonal monsoons and rainfall are celebrated as divine blessings of abundance, securing food security, forest growth, and economic sustenance.",

            "4. LITERARY, PHILOSOPHICAL, AND EMOTIONAL RESONANCE\n"
            "Across generations, writers, philosophers, and musical composers have discovered limitless creative inspiration within the cadence of rainfall. Rain invites introspection, mindfulness, and personal transformation. It offers humanity a welcoming pause from fast-paced daily routines, encouraging comfort indoors by the window, the reassuring sound of gentle drumming against the glass, and thoughtful contemplation of natural beauty.",

            "5. CONCLUSION: HARMONY AND RENEWAL\n"
            "Ultimately, rain stands as an enduring reminder of humanity’s deep interconnectedness with the biosphere. It demonstrates that natural periods of cleansing storms are indispensable precursors to new life, agricultural blossoms, and flourishing progress. Rain remains nature's eternal masterpiece, quietly refreshing the earth today so that tomorrow may thrive in abundant color and renewed energy."
        ]
    else:
        sections = [
            f"====================================================\n"
            f"ESSAY: {topic_title.upper()}\n"
            f"Author: SUNDAY Offline AI Employee (Windows 11)\n"
            f"Date: {today_str}\n"
            f"====================================================\n",

            f"1. INTRODUCTION TO {topic_title.upper()}\n"
            f"The comprehensive analysis of {topic_title} stands at the cutting edge of modern intellectual inquiry and practical implementation. In our interconnected and technology-driven landscape, exploring the foundational principles and broader ramifications of {topic_title} is vital for advancing meaningful progress across academic, professional, and societal dimensions.",

            f"2. CORE THEMES AND SYSTEMIC SIGNIFICANCE\n"
            f"When examining {topic_title}, numerous fundamental advantages immediately surface. Foremost among these is the ability to streamline complex operations, reduce reliance on external dependencies, and safeguard individual autonomy and data privacy. By implementing robust deterministic frameworks, practitioners can ensure that solutions in {topic_title} deliver predictable, dependable, and verifiable outcomes under all operating conditions.",

            f"3. PRACTICAL IMPLEMENTATION AND MODERN WORKFLOWS\n"
            f"Translating theoretical models into everyday practice represents the primary test of efficacy for {topic_title}. By pairing computational precision with intuitive user controls, modern platforms bridge historical bottlenecks. This integration facilitates seamless execution across local operating systems, eliminating latency and empowering users with unprecedented efficiency.",

            f"4. STRATEGIC OUTLOOK AND FUTURE HORIZONS\n"
            f"As innovation continues to accelerate, the scope of {topic_title} will undoubtedly expand to incorporate richer capabilities and deeper integration. Maintaining rigorous standards of quality, transparency, and ethical governance will remain essential to sustaining long-term trust and widespread adoption.",

            f"5. CONCLUSION\n"
            f"In summary, {topic_title} exemplifies the transformative synergy between disciplined research and innovative execution. Those who master its key tenets will be exceptionally positioned to lead within their fields, driving sustained value and positive change across our rapidly evolving world."
        ]

    text = "\n\n".join(sections)
    para_idx = 5
    while len(text.split()) < min_words:
        para_idx += 1
        text += (
            f"\n\n{para_idx}. STRATEGIC PERSPECTIVES ON {topic_title.upper()}\n"
            f"Continuing the comprehensive analysis of {topic_title}, sustained evaluation confirms that systematic execution "
            f"and continuous adaptation are paramount for achieving long-term excellence. By integrating empirical feedback "
            f"with disciplined operational workflows, practitioners consistently unlock enhanced productivity and sustainable growth. "
            f"Furthermore, fostering collaboration and embracing forward-thinking methodologies ensures enduring value creation, "
            f"setting a strong precedent for subsequent advancements across the entire domain."
        )
    return text


def build_document_content(objective: str, min_words: Optional[int] = None) -> tuple[str, str, str]:
    from datetime import datetime
    obj_lower = objective.lower().strip()
    today_str = datetime.now().strftime("%B %d, %Y")

    req_wc = min_words or extract_requested_word_count(objective) or 250

    # Target application: default to Microsoft Word ('word'), only use notepad/wordpad if explicitly named
    app = "word"
    if "notepad" in obj_lower:
        app = "notepad"
    elif "wordpad" in obj_lower or "write.exe" in obj_lower:
        app = "wordpad"

    # Check if this is a follow-up modification (e.g. 'increase to 250 words')
    active_doc = conversation_manager.get_active_document()
    is_word_count_followup = bool(
        re.search(r'\b(increase|expand|longer|extend|rewrite|make it)\b', obj_lower)
        or re.search(r'\b\d+\s*words?\b', obj_lower)
    )

    # 1. Essay or Essay Follow-up
    if "essay" in obj_lower or "article" in obj_lower or (is_word_count_followup and active_doc):
        topic_title = "Rain"
        if is_word_count_followup and active_doc and "essay" not in obj_lower and "article" not in obj_lower and "on the topic" not in obj_lower:
            topic_title = active_doc.get("topic") or active_doc.get("title") or "Rain"
        else:
            clean = re.sub(r'\s*(in\s+word|in\s+msword|in\s+winword|in\s+notepad|in\s+wordpad)\s*$', '', objective, flags=re.IGNORECASE).strip()
            clean = re.sub(r'^(drafting|draft|writing|write|creating|create|typing|type|making|make|compose|composing|open)?\s*(an|a)?\s*(essay|article|document|paper)?\s*(on\s+the\s+topic\s+of|on\s+the\s+topic|on\s+topic\s+of|on\s+topic|the\s+topic\s+of|topic\s+of|the\s+topic|topic|about|on|for)?\s*', '', clean, flags=re.IGNORECASE).strip()
            clean = clean.strip('.,!? \'\":')
            topic_title = clean.title() if len(clean) > 1 else "Rain"

        text = generate_comprehensive_essay(topic_title, min_words=req_wc)
        return (topic_title, text, app)

    # 2. Formal Letter / Leave application
    if "letter" in obj_lower or "leave application" in obj_lower:
        subj = re.sub(r'^(write|create|type|make)\s*(a)?\s*(formal\s+)?(letter|leave\s+application)\s*(to|for|about)?\s*', '', objective, flags=re.IGNORECASE).strip()
        subj_clean = subj.title() if len(subj) > 2 else "Formal Communication and Request"

        text = (
            f"Date: {datetime.now().strftime('%d %B %Y')}\n\n"
            f"To,\n"
            f"The Department Lead / Manager,\n"
            f"Office of Operations,\n\n"
            f"Subject: {subj_clean}\n\n"
            f"Dear Sir/Madam,\n\n"
            f"I am writing this formal letter to bring to your immediate notice regarding {subj_clean}. "
            f"I request your kind consideration and approval for this request.\n\n"
            f"Please be assured that all critical duties and ongoing assignments have been organized and delegated to ensure uninterrupted workflow. "
            f"I remain available over local communication should any urgent verification be required.\n\n"
            f"Thank you for your understanding, time, and cooperation in this matter.\n\n"
            f"Sincerely,\n"
            f"[Your Name]\n"
        )
        return (subj_clean, text, app)

    # 3. General Document / Notes
    clean_title = re.sub(r'^(write|create|type|make)\s*(a|an)?\s*(document|notes|summary)?\s*(on|about|for)?\s*', '', objective, flags=re.IGNORECASE).strip()
    title = clean_title.title() if len(clean_title) > 2 else "Meeting Notes and Summary"
    text = (
        f"====================================================\n"
        f"DOCUMENT: {title.upper()}\n"
        f"Date: {today_str}\n"
        f"====================================================\n\n"
        f"Overview:\n"
        f"{objective}\n\n"
        f"Key Points & Action Items:\n"
        f"1. Verified desktop workflow initiated.\n"
        f"2. Local files generated and saved to user Desktop.\n"
        f"3. Execution completed offline with zero cloud dependency.\n"
    )
    return (title, text, app)


def has_action_intent(objective: str) -> bool:
    """Checks if the user request is asking for an actual laptop task or action."""
    obj_l = objective.lower().strip()
    pure_queries = [
        "who are you", "what can you do", "what did i say", "what did i just say",
        "what was my last command", "what time is it", "what is the time",
        "what is the date", "what date is today", "how are you", "are you offline",
        "thank you", "thanks"
    ]
    if any(q in obj_l for q in pure_queries):
        return False
    if obj_l in ["hi", "hello", "hey sunday", "hey", "good morning", "good evening"]:
        return False

    action_keywords = [
        "invoice", "invoicing", "crertatign", "creating", "spreadsheet", "excel", "essay",
        "drafting", "letter", "notes", "notepad", "wordpad", "word", "ppt", "powerpoint",
        "document", "open ", "launch ", "play ", "search ", "find ", "calc", "calculator",
        "chrome", "edge", "youtube", "battery", "create ", "write ", "make ", "type ",
        "draft ", "save ", "close ", "kill ", "increase", "expand", "extend", "words",
        "word", "longer", "rewrite", "make it", "meeting", "appointment", "schedule",
        "reminder", "remind", "month-end", "month end", "reconcile", "reconciliation",
        "gst return", "gstr1", "gstr-1", "file gst", "close month", "overdue"
    ]
    return any(k in obj_l for k in action_keywords)


def parse_invoice_details(text: str) -> tuple[Optional[str], Optional[float]]:
    """Robust parser for customer name and amount from an invoice request string."""
    text_clean = text.replace(",", " ")
    
    # 1. Parse amount (handles '23k', '23 thousand', '23000', 'rs 23k', 'of 23000')
    amt = None
    k_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:k|thousand)\b', text_clean, re.IGNORECASE)
    if k_match:
        amt = float(k_match.group(1)) * 1000.0
    else:
        nums = re.findall(r'\b\d+(?:\.\d+)?\b', text_clean)
        if nums:
            amt = float(nums[0])

    # 2. Parse customer name
    m = re.search(r'(?:for|to)\s+([A-Za-z0-9\s\.\-_]+?)(?:\s+(?:of|with|amount|worth|valued\s+at|in\s+excel|in\s+word|for\s+amount|rs|inr|usd|\d+)\b|$)', text_clean, re.IGNORECASE)
    cust = None
    if m:
        c = m.group(1).strip()
        c = re.sub(r'\b(in excel|in word|in notepad|excel|word|invoice)\b', '', c, flags=re.IGNORECASE).strip()
        if c:
            cust = c.title()
            if cust.lower() == "interact ai":
                cust = "Interact AI"
            elif cust.lower() == "acme solutions":
                cust = "Acme Solutions"
    return cust, amt


class Planner:
    def __init__(self, client: OllamaClient = ollama_client, registry: ToolRegistry = tool_registry):
        self.client = client
        self.registry = registry

    def plan(self, objective: str, context: Optional[str] = None) -> ExecutionPlan:
        """
        Creates a validated execution plan or conversational response for an objective.
        Incorporates multi-turn context memory and guarantees task execution.
        """
        audit_logger.info("Generating plan for objective: '%s'", objective)

        # 1. Fast Path for Meeting queries, scheduling and follow-ups
        last_bot = conversation_manager.get_last_assistant_turn()
        last_bot_text = last_bot["content"].lower() if last_bot else ""
        if last_bot_text and any(q in last_bot_text for q in ["what time is your meeting", "time is your meeting", "what time is the meeting"]):
            meeting_t = extract_meeting_time(objective)
            if meeting_t:
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="schedule_meeting",
                            arguments={"time_str": meeting_t, "title": "Meeting", "date_str": "today"},
                            risk_level="R0"
                        )
                    ],
                    spoken_summary=f"Scheduled your meeting for {meeting_t} today."
                )

        obj_l = objective.lower()
        if any(w in obj_l for w in ["when is my meeting", "what time is my meeting", "do i have a meeting", "do i have any meetings", "what meetings do i have", "my meeting schedule"]):
            meetings = conversation_manager.get_upcoming_meetings(date_str="today")
            if meetings:
                mt = meetings[0]
                return ExecutionPlan(
                    objective=objective,
                    is_conversational=True,
                    spoken_summary=f"You have a {mt['title']} scheduled for {mt['time_str']} today."
                )
            else:
                return ExecutionPlan(
                    objective=objective,
                    is_conversational=True,
                    spoken_summary="You have no meetings scheduled for today."
                )

        is_doc_req = any(w in obj_l for w in [
            "write a document", "write notes", "document in word", "in word", "titled",
            "drafting", "draft a", "type in", "write an essay", "article", "letter", "in notepad"
        ])

        if not is_doc_req and any(w in obj_l for w in ["meeting", "appointment", "schedule a meeting", "have a meeting", "meeting today"]):
            meeting_t = extract_meeting_time(objective)
            if meeting_t:
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="schedule_meeting",
                            arguments={"time_str": meeting_t, "title": "Meeting", "date_str": "today"},
                            risk_level="R0"
                        )
                    ],
                    spoken_summary=f"Scheduled your meeting for {meeting_t} today."
                )
            else:
                return ExecutionPlan(
                    objective=objective,
                    is_ambiguous=True,
                    clarifying_question="What time is your meeting today?",
                    spoken_summary="What time is your meeting today?"
                )

        # Fast path for Month-End Close & Financial Reconciliation
        if any(w in obj_l for w in [
            "month-end", "month end", "close month", "reconcile", "reconciliation",
            "gst return", "gstr-1", "gstr1", "file gst", "reconcile invoices", "overdue customer"
        ]):
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="run_month_end_close",
                        arguments={"compress_time": True, "auto_approve": True},
                        risk_level="R1"
                    )
                ],
                spoken_summary="Starting month-end close: opening the synthetic GST portal, the reconciliation spreadsheet in Excel, the executive summary in Word, and Gmail on Chrome for Interact AI."
            )

        # 2. Build messages with multi-turn conversation history
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        history = conversation_manager.get_recent_history(limit=6)
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": objective})

        action_intent = has_action_intent(objective)

        # 2. Try Ollama LLM if healthy and accessible
        if self.client.check_health():
            try:
                raw_plan = self.client.chat_json(messages, timeout=30.0)

                # Pure conversation requested without action intent
                if raw_plan.get("is_conversational") and not action_intent:
                    summary = raw_plan.get("spoken_summary") or raw_plan.get("thought") or "I understand."
                    return ExecutionPlan(
                        objective=objective,
                        is_conversational=True,
                        spoken_summary=summary
                    )

                # Clarification only if no action intent
                if raw_plan.get("is_ambiguous") and not action_intent:
                    question = raw_plan.get("clarifying_question") or "Could you please clarify your request?"
                    return ExecutionPlan(
                        objective=objective,
                        is_ambiguous=True,
                        clarifying_question=question,
                        spoken_summary=question
                    )

                validated_steps = []
                obj_l = objective.lower()
                for step_data in raw_plan.get("steps", []):
                    t_name = step_data.get("tool_name")
                    args = step_data.get("arguments", {})

                    # If essay/document was requested or follow-up word count increase
                    is_essay_req = any(w in obj_l for w in ["essay", "article", "in word", "drafting", "draft an essay"])
                    is_word_followup = bool(
                        re.search(r'\b(increase|expand|longer|extend|rewrite|make it)\b', obj_l)
                        or re.search(r'\b\d+\s*words?\b', obj_l)
                    ) and "essay" not in obj_l and "on the topic" not in obj_l and "draft" not in obj_l and (
                        conversation_manager.get_active_document() is not None or
                        any("essay" in h["content"].lower() or "word" in h["content"].lower() for h in conversation_manager.get_recent_history(limit=4))
                    )

                    if is_essay_req or is_word_followup:
                        t_name = "visual_open_and_type"
                        req_wc = extract_requested_word_count(objective) or 250
                        active_doc = conversation_manager.get_active_document()
                        gen_title = (active_doc.get("title") if (is_word_followup and active_doc) else (args.get("title") or ""))
                        if not gen_title or gen_title.lower() in ("document", "essay", "increase to 250 words", "notes"):
                            gen_title = (active_doc.get("topic") if active_doc else "Rain") or "Rain"

                        gen_text = args.get("text", "")
                        if not gen_text or len(gen_text.split()) < req_wc:
                            gen_text = generate_comprehensive_essay(gen_title, min_words=req_wc)

                        args = {
                            "title": gen_title,
                            "text": gen_text,
                            "app_choice": "word" if "notepad" not in obj_l else "notepad",
                            "save_copy": True
                        }

                    # If YouTube play requested
                    if "youtube" in obj_l and any(w in obj_l for w in ["play", "song", "video", "listen"]):
                        t_name = "launch_application"
                        args = {"app_name": objective}

                    if not self.registry.get_tool(t_name):
                        audit_logger.warning("Planner suggested unknown tool '%s'. Skipping.", t_name)
                        continue

                    risk = get_tool_risk(t_name).value
                    validated_steps.append(
                        PlannedStep(
                            step_order=len(validated_steps) + 1,
                            tool_name=t_name,
                            arguments=args,
                            risk_level=risk
                        )
                    )

                if validated_steps:
                    summary = raw_plan.get("spoken_summary") or raw_plan.get("thought") or f"Executing plan for {objective}."
                    return ExecutionPlan(
                        objective=objective,
                        is_ambiguous=False,
                        steps=validated_steps,
                        spoken_summary=summary
                    )
            except Exception as e:
                audit_logger.warning("LLM planning exception (%s). Using deterministic planner.", e)

        # 3. Deterministic Planner (Always executes tasks with action intent)
        return self._deterministic_plan(objective)

    def _deterministic_plan(self, objective: str) -> ExecutionPlan:
        from datetime import datetime
        obj_lower = objective.lower().strip()
        obj_clean = re.sub(r'^[,\.\s\?!]+|[,\.\s\?!]+$', '', obj_lower)

        # Context from previous conversation turns
        last_bot = conversation_manager.get_last_assistant_turn()
        last_bot_text = last_bot["content"].lower() if last_bot else ""
        last_user = conversation_manager.get_last_user_turn()
        last_user_text = last_user["content"] if last_user else ""

        # 1. Questions about memory and previous conversation turns
        if any(w in obj_clean for w in ["what did i just say", "what was my last command", "repeat my last", "what did i ask you", "what did i say"]):
            reply = f"Your previous message was: '{last_user_text}'" if last_user_text else "You haven't issued any commands yet."
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary=reply)

        if any(w in obj_clean for w in ["what did you say", "what was your last response", "repeat what you said", "what did you ask"]):
            reply = f"I previously said: '{last_bot['content']}'" if last_bot else "We just started our conversation."
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary=reply)

        # 2. Conversational chit-chat, greetings, time & identity (Checked BEFORE multi-turn context)
        if any(w in obj_clean for w in ["what time is it", "what is the time", "tell me the time"]):
            t_str = datetime.now().strftime("%I:%M %p")
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary=f"It is currently {t_str}.")

        if any(w in obj_clean for w in ["what is the date", "what date is today", "what day is it", "today's date"]):
            t_str = datetime.now().strftime("%A, %B %d, %Y")
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary=f"Today is {t_str}.")

        if any(w in obj_clean for w in ["thank you", "thanks", "good job", "great work", "awesome", "perfect"]):
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="You are very welcome! I am always here to help you get things done on your laptop.")

        if any(w in obj_clean for w in ["who are you", "what is your name", "introduce yourself"]):
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="I am SUNDAY, your local-first offline AI employee for Windows 11. I operate your laptop, write documents, open apps and websites, and manage tasks completely offline.")

        if any(w in obj_clean for w in ["what can you do", "help me", "what are your features"]):
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="I can create invoices in Excel, write essays and documents in Microsoft Word, launch apps like Chrome, open websites like YouTube, search your laptop files, check battery health, and handle your tasks offline.")

        if any(w in obj_clean for w in ["how are you", "how are you doing", "how's it going"]):
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="I am operating at full capacity and completely offline. How can I assist you on your laptop today?")

        if any(w in obj_clean for w in ["are you offline", "are you connected", "do you have internet"]):
            from app.tools.network import is_online
            status_str = "connected to the internet" if is_online() else "completely offline"
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary=f"I am operating locally on your laptop and currently {status_str}.")

        # Greetings
        for g in ["hi", "hello", "hey sunday", "hey", "good morning", "good afternoon", "good evening"]:
            if obj_clean == g or obj_clean.startswith(f"{g} "):
                return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="Hello! I am right here. What would you like me to do on your laptop today?")

        # 3. Multi-turn Context Resolution based on previous bot prompts
        if last_bot_text:
            # Case M: Bot asked for meeting timing ("What time is your meeting today?")
            if any(q in last_bot_text for q in ["what time is your meeting", "time is your meeting", "what time is the meeting"]) and not any(a in obj_clean for a in ["stop", "cancel"]):
                meeting_t = extract_meeting_time(obj_clean)
                if meeting_t:
                    return ExecutionPlan(
                        objective=objective,
                        steps=[
                            PlannedStep(
                                step_order=1,
                                tool_name="schedule_meeting",
                                arguments={"time_str": meeting_t, "title": "Meeting", "date_str": "today"},
                                risk_level="R0"
                            )
                        ],
                        spoken_summary=f"Scheduled your meeting for {meeting_t} today."
                    )

            # Case A: Bot asked about invoice details
            if any(q in last_bot_text for q in ["who should i make the invoice for", "what is the amount", "customer name for the invoice"]) and not any(a in obj_clean for a in ["open", "launch", "search", "stop", "cancel"]):
                cust, amt = parse_invoice_details(obj_clean)
                if not cust:
                    cust_raw = re.sub(r'\b(rupees|rs|inr|dollars|usd|thousand|hundred|invoice|for|make|create|it|the|\d+)\b', '', obj_clean, flags=re.IGNORECASE).strip().strip(",. ")
                    cust = cust_raw.title() if cust_raw else "ABC Traders"
                if cust.lower() == "interact ai":
                    cust = "Interact AI"
                elif cust.lower() == "acme solutions":
                    cust = "Acme Solutions"
                amt = amt if amt is not None else 5000.0
                tax_rate = 18.0
                total_with_tax = amt * (1.0 + tax_rate / 100.0)
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="create_invoice",
                            arguments={
                                "customer_name": cust,
                                "items": [{"description": "Professional Consulting & Implementation", "quantity": 1, "unit_price": amt}],
                                "tax_rate_percent": tax_rate,
                                "currency": "INR"
                            },
                            risk_level="R1"
                        )
                    ],
                    spoken_summary=f"Creating verified invoice for {cust} totaling {int(total_with_tax) if total_with_tax.is_integer() else total_with_tax:.2f} rupees with 18% tax on your Desktop and opening Excel on screen."
                )

            # Case B: Bot asked about song/video for YouTube
            if any(q in last_bot_text for q in ["what song", "what video", "which song", "which video", "what would you like to play", "what song or video"]) and not any(a in obj_clean for a in ["stop", "cancel", "open word", "open chrome"]):
                song_q = re.sub(r'^(play|open|search)\s*', '', obj_clean, flags=re.IGNORECASE).replace("on youtube", "").replace("youtube", "").strip()
                target_cmd = f"play {song_q} on youtube" if song_q else "https://www.youtube.com"
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="launch_application",
                            arguments={"app_name": target_cmd},
                            risk_level="R1"
                        )
                    ],
                    spoken_summary=f"Playing {song_q or 'video'} on YouTube now."
                )

            # Case C: Bot asked about document/Notepad content
            if any(w in last_bot_text for w in ["what would you like me to write", "what text", "dictate", "what should the letter be"]) and not any(a in obj_clean for a in ["stop", "cancel"]):
                text_to_write = re.sub(r'^(type|write|say|enter|add)\s*(that|in it|there|here)?\s*', '', objective, flags=re.IGNORECASE).strip()
                app = "wordpad" if "wordpad" in last_bot_text else "notepad"
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="visual_open_and_type",
                            arguments={"title": "Notes", "text": text_to_write or objective, "app_choice": app, "save_copy": True},
                            risk_level="R1"
                        )
                    ],
                    spoken_summary=f"Opening {app} on your desktop to visually type your document now."
                )

        # 4. Meeting queries (upcoming meetings check)
        if any(w in obj_clean for w in ["when is my meeting", "what time is my meeting", "do i have a meeting", "do i have any meetings", "what meetings do i have", "my meeting schedule", "what meetings"]):
            meetings = conversation_manager.get_upcoming_meetings(date_str="today")
            if meetings:
                mt = meetings[0]
                return ExecutionPlan(
                    objective=objective,
                    is_conversational=True,
                    spoken_summary=f"You have a {mt['title']} scheduled for {mt['time_str']} today."
                )
            else:
                return ExecutionPlan(
                    objective=objective,
                    is_conversational=True,
                    spoken_summary="You have no meetings scheduled for today."
                )

        # 5. Meeting reminders & scheduling
        is_doc_cmd = any(w in obj_clean for w in [
            "write a document", "write notes", "document in word", "in word", "titled",
            "drafting", "draft a", "type in", "write an essay", "article", "letter", "in notepad"
        ])

        # Month-end Close and Financial Reconciliation
        if any(w in obj_clean for w in [
            "month-end", "month end", "close month", "reconcile", "reconciliation",
            "gst return", "gstr-1", "gstr1", "file gst", "reconcile invoices", "overdue customer"
        ]):
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="run_month_end_close",
                        arguments={"compress_time": True, "auto_approve": True},
                        risk_level="R1"
                    )
                ],
                spoken_summary="Starting month-end close: opening the synthetic GST portal, the reconciliation spreadsheet in Excel, the executive summary in Word, and Gmail on Chrome for Interact AI."
            )

        if not is_doc_cmd and any(w in obj_clean for w in ["meeting", "appointment", "schedule a meeting", "have a meeting", "meeting today", "remind me that i have a meeting", "remember that i have a meeting", "remember i have a meeting", "remind me about my meeting"]):
            meeting_t = extract_meeting_time(obj_clean)
            if meeting_t:
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="schedule_meeting",
                            arguments={"time_str": meeting_t, "title": "Meeting", "date_str": "today"},
                            risk_level="R0"
                        )
                    ],
                    spoken_summary=f"Scheduled your meeting for {meeting_t} today."
                )
            else:
                # User mentioned having a meeting without specifying the time -> Ask for clarification!
                return ExecutionPlan(
                    objective=objective,
                    is_ambiguous=True,
                    clarifying_question="What time is your meeting today?",
                    spoken_summary="What time is your meeting today?"
                )

        # 4. Check for essay follow-up or word count modification (e.g. 'increase to 250 words')
        is_word_followup = bool(
            re.search(r'\b(increase|expand|longer|extend|rewrite|make it)\b', obj_clean)
            or re.search(r'\b\d+\s*words?\b', obj_clean)
        ) and "essay" not in obj_clean and "on the topic" not in obj_clean and "draft" not in obj_clean and (
            conversation_manager.get_active_document() is not None or
            any("essay" in h["content"].lower() or "word" in h["content"].lower() for h in conversation_manager.get_recent_history(limit=4))
        )
        if is_word_followup:
            active_doc = conversation_manager.get_active_document()
            topic = (active_doc.get("topic") or active_doc.get("title") or "Rain") if active_doc else "Rain"
            req_words = extract_requested_word_count(obj_clean) or 250
            expanded_text = generate_comprehensive_essay(topic=topic, min_words=req_words)
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="visual_open_and_type",
                        arguments={
                            "title": topic,
                            "text": expanded_text,
                            "app_choice": "word",
                            "save_copy": True
                        },
                        risk_level="R1"
                    )
                ],
                spoken_summary=f"Expanded the essay on {topic} to {req_words} words in Microsoft Word and updated {topic}.docx on your Desktop."
            )

        # 5. Standalone 'play xyz' command (YouTube music/video playback)
        if obj_lower.startswith("play ") and not any(k in obj_lower for k in ["role", "game"]):
            query = re.sub(r'^play\s+', '', obj_lower).replace("on youtube", "").strip()
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="launch_application",
                        arguments={"app_name": f"play {query} on youtube"},
                        risk_level="R1"
                    )
                ],
                spoken_summary=f"Playing {query} on YouTube now."
            )

        # 6. Applications and Web Services Launching
        if any(w in obj_lower for w in ["open", "launch", "play", "show me", "start"]):
            # Web services (YouTube, Facebook, etc.)
            for web_k in ["youtube", "facebook", "whatsapp", "instagram", "gmail", "twitter", "reddit", "linkedin", "github", "chatgpt"]:
                if web_k in obj_lower:
                    if web_k == "youtube" and any(w in obj_lower for w in ["play", "song", "video", "listen"]):
                        query = re.sub(r'^(open\s+)?(youtube\s+)?(and\s+)?(play\s+)?', '', obj_lower).replace("on youtube", "").replace("song", "").strip()
                        query = query.rstrip(" on").strip()
                        target = f"play {query} on youtube" if query else "https://www.youtube.com"
                        return ExecutionPlan(
                            objective=objective,
                            steps=[
                                PlannedStep(
                                    step_order=1,
                                    tool_name="launch_application",
                                    arguments={"app_name": target},
                                    risk_level="R1"
                                )
                            ],
                            spoken_summary=f"Playing {query or 'video'} on YouTube now."
                        )
                    else:
                        target = web_k

                    return ExecutionPlan(
                        objective=objective,
                        steps=[
                            PlannedStep(
                                step_order=1,
                                tool_name="launch_application",
                                arguments={"app_name": target},
                                risk_level="R1"
                            )
                        ],
                        spoken_summary=f"Opening {web_k.capitalize()} for you."
                    )

            # Desktop apps
            for app_key in [
                "google chrome", "chrome", "microsoft edge", "edge", "calculator", "calc",
                "microsoft word", "word", "microsoft excel", "excel", "powerpoint", "ppt",
                "notepad", "wordpad", "paint", "mspaint", "file explorer", "explorer", "settings", "terminal"
            ]:
                if app_key in obj_lower:
                    return ExecutionPlan(
                        objective=objective,
                        steps=[
                            PlannedStep(
                                step_order=1,
                                tool_name="launch_application",
                                arguments={"app_name": app_key},
                                risk_level="R1"
                            )
                        ],
                        spoken_summary=f"Opening {app_key} on your laptop."
                    )

        # 7. Visual desktop typing for essays, letters, and documents (Microsoft Word / Desktop)
        if any(w in obj_lower for w in ["essay", "article", "drafting", "draft an essay", "write an essay", "write a document", "type in notepad", "write in word", "open wordpad and type", "write a letter", "leave application", "write notes"]):
            req_wc = extract_requested_word_count(objective) or 250
            title, doc_content, app = build_document_content(objective, min_words=req_wc)
            app_display = "Microsoft Word" if app == "word" else app.capitalize()
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="visual_open_and_type",
                        arguments={"title": title, "text": doc_content, "app_choice": app, "save_copy": True},
                        risk_level="R1"
                    )
                ],
                spoken_summary=f"Drafting '{title}' in {app_display} on your desktop and opening the document on screen."
            )

        # 6. Spreadsheet & Excel workbook creation
        if any(w in obj_lower for w in ["create spreadsheet", "create a spreadsheet", "make a spreadsheet", "excel sheet", "make an excel sheet", "create excel"]):
            filename = "Desktop_Spreadsheet.xlsx"
            headers = ["Category", "Q1 Budget", "Q2 Budget", "Total (INR)"]
            rows = [
                ["Operations", 45000, 52000, 97000],
                ["Infrastructure", 32000, 28000, 60000],
                ["Software & Tools", 15000, 18000, 33000],
                ["Marketing & Outreach", 22000, 26000, 48000]
            ]
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="create_spreadsheet",
                        arguments={"filename": filename, "headers": headers, "rows": rows},
                        risk_level="R1"
                    )
                ],
                spoken_summary="Creating your spreadsheet on your Desktop and opening Excel on screen."
            )

        # 7. Invoice generation (Saves to Desktop and visibly opens Excel on screen)
        if any(w in obj_lower for w in ["invoice", "invoicing", "crertatign an invoice", "creating an invoice"]):
            customer, amt = parse_invoice_details(objective)

            # If user said "create an invoice" without customer name and without amount: ask for clarification!
            if not customer and not amt:
                return ExecutionPlan(
                    objective=objective,
                    is_ambiguous=True,
                    clarifying_question="Who should I make the invoice for, and what is the amount?",
                    spoken_summary="Who should I make the invoice for, and what is the amount?"
                )

            customer = customer or "ABC Traders"
            amt = amt if amt is not None else 5000.0
            tax_rate = 18.0
            total_with_tax = amt * (1.0 + tax_rate / 100.0)

            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="create_invoice",
                        arguments={
                            "customer_name": customer,
                            "items": [
                                {"description": "Consulting & Implementation Services", "quantity": 1, "unit_price": amt}
                            ],
                            "tax_rate_percent": tax_rate,
                            "currency": "INR"
                        },
                        risk_level="R1"
                    )
                ],
                spoken_summary=f"Creating verified invoice for {customer} of {int(amt) if amt.is_integer() else amt} rupees totaling {int(total_with_tax) if total_with_tax.is_integer() else total_with_tax:.2f} with 18% tax on your Desktop and opening Excel on your screen."
            )

        # 7. System status & battery
        if any(w in obj_lower for w in ["system status", "battery", "laptop status", "storage", "disk space", "ram", "cpu"]):
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="get_system_status",
                        arguments={},
                        risk_level="R0"
                    )
                ],
                spoken_summary="Checking laptop system status."
            )

        # 8. Open folder in Explorer
        if "open " in obj_lower and any(w in obj_lower for w in ["desktop", "downloads", "documents", "workspace", "folder"]):
            target_f = "Desktop"
            for candidate in ["downloads", "documents", "desktop", "workspace"]:
                if candidate in obj_lower:
                    target_f = candidate.capitalize()
                    break
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="open_folder",
                        arguments={"folder": target_f},
                        risk_level="R0"
                    )
                ],
                spoken_summary=f"Opening {target_f} folder in File Explorer."
            )

        # 9. Search files
        if any(w in obj_lower for w in ["search for", "find file", "search files"]):
            q = objective.replace("search for", "").replace("find file", "").replace("search files", "").strip()
            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="search_laptop_files",
                        arguments={"query": q, "location": "all"},
                        risk_level="R0"
                    )
                ],
                spoken_summary=f"Searching laptop for '{q}'."
            )

        # 10. List files
        if any(w in obj_lower for w in ["list files", "list directory", "show files"]):
            target_dir = ""
            if "desktop" in obj_lower:
                target_dir = "Desktop"
            elif "downloads" in obj_lower:
                target_dir = "Downloads"
            elif "documents" in obj_lower:
                target_dir = "Documents"

            return ExecutionPlan(
                objective=objective,
                steps=[
                    PlannedStep(
                        step_order=1,
                        tool_name="list_directory",
                        arguments={"directory": target_dir},
                        risk_level="R0"
                    )
                ],
                spoken_summary=f"Listing files in {target_dir or 'workspace'}."
            )

        # Ambiguous request: ask specific, helpful clarification
        return ExecutionPlan(
            objective=objective,
            is_ambiguous=True,
            clarifying_question=f"I heard: '{objective}'. Could you please tell me how you would like me to help with that?",
            spoken_summary=f"I heard: '{objective}'. Could you please tell me what you would like me to do?"
        )


planner = Planner()
