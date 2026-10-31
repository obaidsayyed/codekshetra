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


def build_document_content(objective: str) -> tuple[str, str, str]:
    from datetime import datetime
    obj_lower = objective.lower().strip()
    today_str = datetime.now().strftime("%B %d, %Y")

    # Target application
    app = "notepad"
    if "wordpad" in obj_lower:
        app = "wordpad"
    elif "word" in obj_lower or "winword" in obj_lower or "msword" in obj_lower:
        app = "word"

    # 1. Essay
    if "essay" in obj_lower or "article" in obj_lower:
        topic = re.sub(r'^(write|create|type|make|open)\s*(an|a)?\s*(in\s+word|in\s+notepad|in\s+wordpad)?\s*(essay|article)\s*(on|about|for)?\s*', '', objective, flags=re.IGNORECASE).strip()
        topic = re.sub(r'^(in\s+word|in\s+notepad|in\s+wordpad)\s*', '', topic, flags=re.IGNORECASE).strip()
        topic_title = topic.title() if len(topic) > 2 else "Artificial Intelligence and Future Technology"

        text = (
            f"====================================================\n"
            f"ESSAY: {topic_title.upper()}\n"
            f"Author: SUNDAY Offline AI Employee (Windows 11)\n"
            f"Date: {today_str}\n"
            f"====================================================\n\n"
            f"1. INTRODUCTION\n"
            f"The exploration of {topic_title} stands at the forefront of contemporary discussion. In an era defined by rapid technological adaptation, understanding the core dynamics and transformative principles of this domain is vital for both individual achievement and societal growth.\n\n"
            f"2. CORE PILLARS & PRACTICAL IMPACT\n"
            f"When evaluating {topic_title}, several fundamental strengths become evident. Automation and computational reasoning empower users to execute complex tasks locally, ensuring complete privacy, zero cloud dependency, and maximum speed. Furthermore, practical implementation bridges theoretical concepts with tangible everyday productivity.\n\n"
            f"3. ETHICAL CONSIDERATIONS & FUTURE HORIZONS\n"
            f"As innovations continue to unfold, maintaining transparency, robustness, and deterministic control remains paramount. By combining human oversight with autonomous desktop execution, solutions in {topic_title} can be deployed responsibly and efficiently.\n\n"
            f"4. CONCLUSION\n"
            f"In conclusion, {topic_title} offers boundless opportunities for those who leverage modern tools with purpose and discipline. As we move forward, local-first intelligence will remain a cornerstone of autonomous and secure computing.\n"
        )
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


class Planner:
    def __init__(self, client: OllamaClient = ollama_client, registry: ToolRegistry = tool_registry):
        self.client = client
        self.registry = registry

    def plan(self, objective: str, context: Optional[str] = None) -> ExecutionPlan:
        """
        Creates a validated execution plan or conversational response for an objective.
        Incorporates multi-turn context memory.
        """
        audit_logger.info("Generating plan for objective: '%s'", objective)

        # 1. Build messages with multi-turn conversation history
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        history = conversation_manager.get_recent_history(limit=6)
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": objective})

        # 2. Try Ollama LLM if healthy and accessible
        if self.client.check_health():
            try:
                raw_plan = self.client.chat_json(messages, timeout=30.0)

                # Check conversational response
                if raw_plan.get("is_conversational"):
                    summary = raw_plan.get("spoken_summary") or "I understand."
                    return ExecutionPlan(
                        objective=objective,
                        is_conversational=True,
                        spoken_summary=summary
                    )

                # Check ambiguity / clarification
                if raw_plan.get("is_ambiguous"):
                    question = raw_plan.get("clarifying_question") or "Could you please clarify your request?"
                    return ExecutionPlan(
                        objective=objective,
                        is_ambiguous=True,
                        clarifying_question=question,
                        spoken_summary=question
                    )

                validated_steps = []
                for step_data in raw_plan.get("steps", []):
                    t_name = step_data.get("tool_name")
                    if not self.registry.get_tool(t_name):
                        audit_logger.warning("Planner suggested unknown tool '%s'. Skipping.", t_name)
                        continue

                    args = step_data.get("arguments", {})
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
                    summary = raw_plan.get("spoken_summary") or f"Executing plan for {objective}."
                    return ExecutionPlan(
                        objective=objective,
                        is_ambiguous=False,
                        steps=validated_steps,
                        spoken_summary=summary
                    )
            except Exception as e:
                audit_logger.warning("LLM planning exception (%s). Using deterministic planner.", e)

        # 3. Deterministic Fallback Planner (Context-Aware)
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
            return ExecutionPlan(objective=objective, is_conversational=True, spoken_summary="I can create invoices, write documents live in Notepad and WordPad on your desktop, launch apps like Chrome and Word, open websites like YouTube, search your laptop files, check battery health, and handle your tasks offline.")

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
            # Case A: Bot asked about invoice details
            if "invoice" in last_bot_text and not any(a in obj_clean for a in ["open", "launch", "search", "stop", "cancel"]):
                nums = re.findall(r'\d+(?:\.\d+)?', obj_clean.replace(",", ""))
                amt = float(nums[0]) if nums else 5000.0
                cust = re.sub(r'\b(rupees|rs|inr|dollars|usd|thousand|hundred|invoice|for|make|create|it|the|\d+)\b', '', obj_clean, flags=re.IGNORECASE).strip()
                cust = cust.strip(",. ").title() if cust else "ABC Traders"
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="create_invoice",
                            arguments={
                                "customer_name": cust,
                                "items": [{"description": "Professional Consulting & Implementation", "quantity": 1, "unit_price": amt}],
                                "tax_rate_percent": 18.0,
                                "currency": "INR"
                            },
                            risk_level="R1"
                        )
                    ],
                    spoken_summary=f"Creating verified invoice for {cust} on your Desktop and opening Excel on screen."
                )

            # Case B: Bot asked about song/video for YouTube
            if ("youtube" in last_bot_text or "song" in last_bot_text or "video" in last_bot_text) and not any(a in obj_clean for a in ["stop", "cancel", "open word", "open chrome"]):
                song_q = re.sub(r'^(play|open|search)\s*', '', obj_clean, flags=re.IGNORECASE).replace("on youtube", "").replace("youtube", "").strip()
                search_url = f"https://www.youtube.com/results?search_query={song_q}" if song_q else "https://www.youtube.com"
                return ExecutionPlan(
                    objective=objective,
                    steps=[
                        PlannedStep(
                            step_order=1,
                            tool_name="launch_application",
                            arguments={"app_name": search_url},
                            risk_level="R1"
                        )
                    ],
                    spoken_summary=f"Opening YouTube for {song_q or 'you'}."
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

        # 4. Applications and Web Services Launching
        if any(w in obj_lower for w in ["open", "launch", "play", "show me", "start"]):
            # Web services (YouTube, Facebook, etc.)
            for web_k in ["youtube", "facebook", "whatsapp", "instagram", "gmail", "twitter", "reddit", "linkedin", "github", "chatgpt"]:
                if web_k in obj_lower:
                    if web_k == "youtube" and ("play " in obj_lower or "song" in obj_lower):
                        query = re.sub(r'^(open\s+)?(youtube\s+)?(and\s+)?(play\s+)?', '', obj_lower).replace("on youtube", "").replace("song", "").strip()
                        query = query.rstrip(" on").strip()
                        target = f"https://www.youtube.com/results?search_query={query}" if query else "https://www.youtube.com"
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

        # 5. Visual desktop typing for essays, letters, and documents (Claude Cowork style)
        if any(w in obj_lower for w in ["essay", "article", "write a document", "type in notepad", "write in word", "open wordpad and type", "write a letter", "leave application", "write notes"]):
            title, doc_content, app = build_document_content(objective)
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
                spoken_summary=f"Opening {app.capitalize()} on your desktop to visually write '{title}' live on your screen."
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
        if "invoice" in obj_lower:
            m = re.search(r'for\s+([A-Za-z0-9\s]+?)(?:for|with|amount|$)', objective, re.IGNORECASE)
            nums = re.findall(r'\d+(?:\.\d+)?', objective.replace(",", ""))

            # If user said "create an invoice" without customer name and without amount: ask for clarification!
            if not m and not nums:
                return ExecutionPlan(
                    objective=objective,
                    is_ambiguous=True,
                    clarifying_question="Who should I make the invoice for, and what is the amount?",
                    spoken_summary="Who should I make the invoice for, and what is the amount?"
                )

            customer = m.group(1).strip().title() if m else "ABC Traders"
            amt = float(nums[0]) if nums else 5000.0

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
                            "tax_rate_percent": 18.0,
                            "currency": "INR"
                        },
                        risk_level="R1"
                    )
                ],
                spoken_summary=f"Creating verified invoice for {customer} on your Desktop and opening Excel on your screen."
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
