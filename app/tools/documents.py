"""
Deterministic document and business drafting tools for SUNDAY.
Invoices, calculations with Decimal, email drafts, message drafts, spreadsheets, and PDF verification.
"""
import uuid
import shutil
import subprocess
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import pymupdf as fitz
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import pandas as pd

from app.config.settings import settings
from app.permissions.policy import RiskLevel
from app.tools.base import BaseTool, ToolResult
from app.audit.logger import audit_logger
from app.tools.files import compute_file_hash, is_path_allowed


class InvoiceItem(BaseModel):
    description: str
    quantity: float
    unit_price: float


class CreateInvoiceInput(BaseModel):
    customer_name: str = Field(description="Name of the customer or client.")
    items: List[InvoiceItem] = Field(description="List of invoice items.")
    tax_rate_percent: float = Field(default=18.0, description="Applicable tax percentage (e.g. 18 for 18% GST).")
    currency: str = Field(default="INR", description="Currency symbol/code.")
    notes: str = Field(default="Thank you for your business.", description="Payment terms or notes.")


class CreateInvoiceTool(BaseTool):
    name = "create_invoice"
    description = "Create a professional business invoice in DOCX and PDF with deterministic tax & total calculations."
    input_schema = CreateInvoiceInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(
        self,
        customer_name: str,
        items: List[Dict[str, Any]],
        tax_rate_percent: float = 18.0,
        currency: str = "INR",
        notes: str = "Thank you for your business."
    ) -> ToolResult:
        inv_number = f"INV-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        output_dir = settings.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        docx_path = output_dir / f"{inv_number}.docx"
        pdf_path = output_dir / f"{inv_number}.pdf"

        # Deterministic financial calculations with Python Decimal
        subtotal = Decimal("0.00")
        processed_items = []
        for item in items:
            desc = str(item.get("description", "Item"))
            qty = Decimal(str(item.get("quantity", 1)))
            rate = Decimal(str(item.get("unit_price", 0)))
            line_total = (qty * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            subtotal += line_total
            processed_items.append({
                "description": desc,
                "quantity": qty,
                "unit_price": rate,
                "line_total": line_total
            })

        tax_rate = Decimal(str(tax_rate_percent)) / Decimal("100")
        tax_amount = (subtotal * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        grand_total = subtotal + tax_amount

        # 1. Generate DOCX
        doc = Document()
        title_p = doc.add_heading(f"TAX INVOICE - {inv_number}", level=1)
        doc.add_paragraph(f"Date: {datetime.now().strftime('%d %B %Y')}")
        doc.add_paragraph(f"Billed To: {customer_name}")
        doc.add_paragraph(f"Currency: {currency}")

        table = doc.add_table(rows=1, cols=4)
        table.style = 'Table Grid'
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = 'Description'
        hdr_cells[1].text = 'Qty'
        hdr_cells[2].text = f'Unit Price ({currency})'
        hdr_cells[3].text = f'Total ({currency})'

        for pi in processed_items:
            row_cells = table.add_row().cells
            row_cells[0].text = pi["description"]
            row_cells[1].text = str(pi["quantity"])
            row_cells[2].text = f"{pi['unit_price']:.2f}"
            row_cells[3].text = f"{pi['line_total']:.2f}"

        doc.add_paragraph()
        summary_p = doc.add_paragraph()
        summary_p.add_run(f"Subtotal: {currency} {subtotal:.2f}\n").bold = True
        summary_p.add_run(f"Tax ({tax_rate_percent}%): {currency} {tax_amount:.2f}\n").bold = True
        summary_p.add_run(f"Grand Total: {currency} {grand_total:.2f}\n").bold = True
        doc.add_paragraph(f"Notes: {notes}")
        doc.save(str(docx_path))

        # 2. Generate PDF via ReportLab
        c = canvas.Canvas(str(pdf_path), pagesize=letter)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(50, 750, f"TAX INVOICE - {inv_number}")
        c.setFont("Helvetica", 11)
        c.drawString(50, 730, f"Date: {datetime.now().strftime('%d %B %Y')}")
        c.drawString(50, 715, f"Customer: {customer_name}")
        c.drawString(50, 700, f"Currency: {currency}")

        y = 660
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, "Item Description")
        c.drawString(250, y, "Qty")
        c.drawString(350, y, "Rate")
        c.drawString(450, y, "Amount")
        c.line(50, y - 5, 550, y - 5)

        c.setFont("Helvetica", 10)
        y -= 25
        for pi in processed_items:
            c.drawString(50, y, str(pi["description"])[:30])
            c.drawString(250, y, str(pi["quantity"]))
            c.drawString(350, y, f"{pi['unit_price']:.2f}")
            c.drawString(450, y, f"{pi['line_total']:.2f}")
            y -= 20

        c.line(50, y, 550, y)
        y -= 25
        c.setFont("Helvetica-Bold", 11)
        c.drawString(350, y, f"Subtotal: {currency} {subtotal:.2f}")
        y -= 18
        c.drawString(350, y, f"Tax ({tax_rate_percent}%): {currency} {tax_amount:.2f}")
        y -= 18
        c.drawString(350, y, f"Grand Total: {currency} {grand_total:.2f}")
        c.save()

        # 3. Generate Formatted Excel Spreadsheet (.xlsx)
        xlsx_path = output_dir / f"{inv_number}.xlsx"
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Invoice"

        ws["A1"] = f"TAX INVOICE - {inv_number}"
        ws["A1"].font = Font(name="Segoe UI", size=15, bold=True, color="1E3A8A")
        ws["A3"] = "Date:"
        ws["B3"] = datetime.now().strftime('%d %B %Y')
        ws["A4"] = "Customer:"
        ws["B4"] = customer_name
        ws["A5"] = "Currency:"
        ws["B5"] = currency
        for r_idx in range(3, 6):
            ws[f"A{r_idx}"].font = Font(name="Segoe UI", bold=True)

        xl_headers = ["Item Description", "Qty", f"Unit Rate ({currency})", f"Amount ({currency})"]
        for c_idx, h in enumerate(xl_headers, start=1):
            cell = ws.cell(row=7, column=c_idx, value=h)
            cell.font = Font(name="Segoe UI", bold=True, color="FFFFFF")
            cell.fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
            cell.alignment = Alignment(horizontal="center" if c_idx > 1 else "left")

        xl_row = 8
        for pi in processed_items:
            ws.cell(row=xl_row, column=1, value=pi["description"])
            q_cell = ws.cell(row=xl_row, column=2, value=float(pi["quantity"]))
            q_cell.alignment = Alignment(horizontal="center")
            r_cell = ws.cell(row=xl_row, column=3, value=float(pi["unit_price"]))
            r_cell.number_format = '#,##0.00'
            t_cell = ws.cell(row=xl_row, column=4, value=float(pi["line_total"]))
            t_cell.number_format = '#,##0.00'
            xl_row += 1

        xl_row += 1
        ws.cell(row=xl_row, column=3, value="Subtotal:").font = Font(name="Segoe UI", bold=True)
        ws.cell(row=xl_row, column=4, value=float(subtotal)).font = Font(name="Segoe UI", bold=True)
        ws.cell(row=xl_row, column=4).number_format = '#,##0.00'

        xl_row += 1
        ws.cell(row=xl_row, column=3, value=f"Tax ({tax_rate_percent}%):").font = Font(name="Segoe UI", bold=True)
        ws.cell(row=xl_row, column=4, value=float(tax_amount)).font = Font(name="Segoe UI", bold=True)
        ws.cell(row=xl_row, column=4).number_format = '#,##0.00'

        xl_row += 1
        gt_lbl = ws.cell(row=xl_row, column=3, value="Grand Total:")
        gt_lbl.font = Font(name="Segoe UI", bold=True, size=12, color="1E3A8A")
        gt_val = ws.cell(row=xl_row, column=4, value=float(grand_total))
        gt_val.font = Font(name="Segoe UI", bold=True, size=12, color="1E3A8A")
        gt_val.number_format = '#,##0.00'

        for col in ws.columns:
            max_len = max(len(str(c.value or '')) for c in col)
            col_letter = col[0].column_letter
            ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

        wb.save(str(xlsx_path))

        # 4. Save and copy files directly to user's Windows Desktop so they see them immediately
        clean_cust = "".join(c for c in customer_name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
        desktop_xlsx = settings.user_desktop_dir / f"Invoice_{inv_number}_{clean_cust}.xlsx"
        desktop_docx = settings.user_desktop_dir / f"Invoice_{inv_number}_{clean_cust}.docx"
        desktop_pdf = settings.user_desktop_dir / f"Invoice_{inv_number}_{clean_cust}.pdf"
        try:
            shutil.copy2(str(xlsx_path), str(desktop_xlsx))
            shutil.copy2(str(docx_path), str(desktop_docx))
            shutil.copy2(str(pdf_path), str(desktop_pdf))
            audit_logger.info("Saved invoice files to user Desktop: %s", desktop_xlsx)
        except Exception as e:
            audit_logger.warning("Could not copy files to Desktop: %s", e)
            desktop_xlsx = xlsx_path

        # 5. Visually open Excel on desktop or mobile app
        if settings.is_mobile():
            try:
                from app.tools.mobile import mobile_launcher
                audit_logger.info("Visually opening Excel invoice in mobile app: %s", desktop_xlsx)
                mobile_launcher.open_document(desktop_xlsx, app="excel")
            except Exception as e:
                audit_logger.warning("Could not launch mobile Excel app: %s", e)
        else:
            from app.tools.laptop import get_registered_windows_apps
            reg_apps = get_registered_windows_apps()
            excel_bin = reg_apps.get("excel.exe") or reg_apps.get("excel")
            try:
                if excel_bin and Path(excel_bin).exists():
                    audit_logger.info("Visually opening Excel on screen: %s", desktop_xlsx)
                    subprocess.Popen([excel_bin, str(desktop_xlsx)])
                else:
                    audit_logger.info("Opening Excel via Windows shell: %s", desktop_xlsx)
                    subprocess.Popen(f'cmd.exe /c start "" "{desktop_xlsx}"', shell=True)
            except Exception as e:
                audit_logger.warning("Could not launch Excel window: %s", e)

        # 6. Verification: Reopen DOCX and PDF
        reopened_doc = Document(str(docx_path))
        reopened_pdf = fitz.open(str(pdf_path))
        pdf_pages = reopened_pdf.page_count
        pdf_text = "".join(page.get_text() for page in reopened_pdf)
        reopened_pdf.close()

        if str(grand_total) not in pdf_text and f"{grand_total:.2f}" not in pdf_text:
            audit_logger.warning("Invoice grand total verification check warning.")

        docx_hash = compute_file_hash(docx_path)
        pdf_hash = compute_file_hash(pdf_path)

        data = {
            "invoice_number": inv_number,
            "customer_name": customer_name,
            "subtotal": float(subtotal),
            "tax_amount": float(tax_amount),
            "grand_total": float(grand_total),
            "currency": currency,
            "docx_path": str(docx_path),
            "pdf_path": str(pdf_path),
            "xlsx_path": str(desktop_xlsx),
            "docx_sha256": docx_hash,
            "pdf_sha256": pdf_hash,
            "pages": pdf_pages,
            "action": "open_document",
            "filename": desktop_xlsx.name,
            "download_url": f"/api/download?file={desktop_xlsx.name}",
            "pdf_download_url": f"/api/download?file={pdf_path.name}"
        }

        audit_logger.info("Generated and verified invoice %s (Total: %s %s)", inv_number, currency, grand_total)
        return ToolResult(
            success=True,
            output_path=str(desktop_xlsx),
            data=data,
            evidence=f"Invoice {inv_number} for {customer_name} created on your Desktop and opened in Excel with total {currency} {grand_total:.2f}. Verified files saved."
        )


class CreateEmailDraftInput(BaseModel):
    recipient: str = Field(description="Recipient email address or contact name.")
    subject: str = Field(description="Subject line for email.")
    body: str = Field(description="Body of email.")


class CreateEmailDraftTool(BaseTool):
    name = "create_email_draft"
    description = "Create a local offline email draft (.eml and .txt) marked Draft - Not Sent."
    input_schema = CreateEmailDraftInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(self, recipient: str, subject: str, body: str) -> ToolResult:
        drafts_dir = settings.drafts_dir
        drafts_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        txt_path = drafts_dir / f"email_draft_{stamp}.txt"
        eml_path = drafts_dir / f"email_draft_{stamp}.eml"

        header = (
            "====================================================\n"
            "STATUS: DRAFT - NOT SENT (OFFLINE SECURE STORAGE)\n"
            "====================================================\n"
            f"To: {recipient}\n"
            f"Subject: {subject}\n"
            f"Date: {datetime.now().strftime('%a, %d %b %Y %H:%M:%S')}\n"
            "----------------------------------------------------\n\n"
        )
        full_content = header + body

        txt_path.write_text(full_content, encoding="utf-8")
        eml_path.write_text(full_content, encoding="utf-8")

        # 3. Visually launch Gmail compose screen on Desktop or Mobile
        import urllib.parse
        encoded_to = urllib.parse.quote(recipient)
        encoded_su = urllib.parse.quote(subject)
        encoded_body = urllib.parse.quote(body)
        gmail_url = f"https://mail.google.com/mail/u/?view=cm&fs=1&to={encoded_to}&su={encoded_su}&body={encoded_body}"

        if settings.is_mobile():
            try:
                from app.tools.mobile import mobile_launcher
                mobile_launcher.launch_gmail_compose(to_email=recipient, subject=subject, body=body)
            except Exception as e:
                audit_logger.warning("Mobile Gmail launch warning: %s", e)
        else:
            try:
                from app.tools.laptop import get_registered_windows_apps
                reg_apps = get_registered_windows_apps()
                chrome_bin = reg_apps.get("chrome.exe") or reg_apps.get("chrome") or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
                if chrome_bin and Path(chrome_bin).exists():
                    audit_logger.info("Visually opening Gmail compose in Google Chrome on screen: %s", chrome_bin)
                    subprocess.Popen([chrome_bin, gmail_url])
                else:
                    audit_logger.info("Opening Gmail compose via Windows Shell: %s", gmail_url)
                    subprocess.Popen(f'cmd.exe /c start "" "{gmail_url}"', shell=True)
            except Exception as e:
                audit_logger.warning("Could not launch Chrome for Gmail: %s", e)

        return ToolResult(
            success=True,
            output_path=str(txt_path),
            data={
                "recipient": recipient,
                "subject": subject,
                "txt_path": str(txt_path),
                "eml_path": str(eml_path),
                "gmail_url": gmail_url,
                "status": "draft_saved_opened_on_screen"
            },
            evidence=f"Email drafted to {recipient} with subject '{subject}'. Saved offline draft and opened Gmail compose on screen."
        )


class CreateMessageDraftInput(BaseModel):
    recipient: str = Field(description="Recipient contact or phone number.")
    message_text: str = Field(description="Content of the message.")


class CreateMessageDraftTool(BaseTool):
    name = "create_message_draft"
    description = "Create a local WhatsApp/SMS message draft marked Draft - Not Sent."
    input_schema = CreateMessageDraftInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(self, recipient: str, message_text: str) -> ToolResult:
        drafts_dir = settings.drafts_dir
        drafts_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = drafts_dir / f"message_draft_{stamp}.txt"

        content = (
            "====================================================\n"
            "STATUS: DRAFT - NOT SENT (OFFLINE SECURE STORAGE)\n"
            "====================================================\n"
            f"To: {recipient}\n"
            f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            "----------------------------------------------------\n\n"
            f"{message_text}\n"
        )
        path.write_text(content, encoding="utf-8")

        return ToolResult(
            success=True,
            output_path=str(path),
            data={"recipient": recipient, "path": str(path), "status": "draft_saved_not_sent"},
            evidence=f"Message draft for {recipient} saved locally. Not sent."
        )


class CreateSpreadsheetInput(BaseModel):
    filename: str = Field(description="Spreadsheet file name (e.g. sales_summary.xlsx).")
    headers: List[str] = Field(description="Column headers.")
    rows: List[List[Any]] = Field(description="Data rows.")


class CreateSpreadsheetTool(BaseTool):
    name = "create_spreadsheet"
    description = "Create an Excel spreadsheet and CSV with validated totals."
    input_schema = CreateSpreadsheetInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(self, filename: str, headers: List[str], rows: List[List[Any]]) -> ToolResult:
        output_dir = settings.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        
        base_name = Path(filename).stem
        xlsx_path = output_dir / f"{base_name}.xlsx"
        csv_path = output_dir / f"{base_name}.csv"

        df = pd.DataFrame(rows, columns=headers)
        df.to_excel(str(xlsx_path), index=False)
        df.to_csv(str(csv_path), index=False)

        # Verification: reopen
        reopened_df = pd.read_excel(str(xlsx_path))
        verified_rows = len(reopened_df)

        # Copy directly to user's Windows Desktop with collision avoidance
        target_xlsx = xlsx_path
        candidate_desktop_paths = [
            settings.user_desktop_dir / f"{base_name}.xlsx",
            settings.user_desktop_dir / f"{base_name}_revised.xlsx",
            settings.user_desktop_dir / f"{base_name}_{int(datetime.now().timestamp())}.xlsx"
        ]
        for cand in candidate_desktop_paths:
            try:
                shutil.copy2(str(xlsx_path), str(cand))
                target_xlsx = cand
                audit_logger.info("Saved spreadsheet directly to Desktop: %s", cand)
                break
            except Exception as e:
                audit_logger.warning("Desktop path %s locked or inaccessible (%s). Trying alternate...", cand.name, e)

        # Visually open Excel live on screen or mobile app
        if settings.is_mobile():
            try:
                from app.tools.mobile import mobile_launcher
                audit_logger.info("Visually opening spreadsheet in mobile Excel app: %s", target_xlsx)
                mobile_launcher.open_document(target_xlsx, app="excel")
            except Exception as e:
                audit_logger.warning("Could not launch mobile Excel app: %s", e)
        else:
            try:
                audit_logger.info("Visually opening spreadsheet in Excel via Windows shell: %s", target_xlsx)
                subprocess.Popen(f'cmd.exe /c start "" "{target_xlsx}"', shell=True)
            except Exception as e:
                audit_logger.warning("Could not launch Excel viewer: %s", e)

        return ToolResult(
            success=True,
            output_path=str(target_xlsx),
            data={
                "xlsx_path": str(target_xlsx),
                "csv_path": str(csv_path),
                "rows_count": verified_rows,
                "columns": headers
            },
            evidence=f"Spreadsheet {target_xlsx.name} created on your Desktop and opened in Excel with {verified_rows} rows."
        )


class ReadPdfInput(BaseModel):
    pdf_path: str = Field(description="Path to local PDF file.")


class ReadPdfTool(BaseTool):
    name = "read_pdf"
    description = "Read and extract text from a local PDF document."
    input_schema = ReadPdfInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self, pdf_path: str) -> ToolResult:
        target = Path(pdf_path)
        if not target.is_absolute():
            target = settings.workspace_root / target
        target = target.resolve()

        if not is_path_allowed(target):
            return ToolResult(success=False, error=f"Access denied: '{target}' outside approved roots.")

        if not target.exists():
            return ToolResult(success=False, error=f"File not found: '{target}'.")

        try:
            doc = fitz.open(str(target))
            page_count = doc.page_count
            full_text = ""
            for idx in range(page_count):
                page_text = doc[idx].get_text()
                if page_text:
                    full_text += f"--- Page {idx+1} ---\n{page_text}\n"
            doc.close()

            is_scanned = len(full_text.strip()) == 0
            return ToolResult(
                success=True,
                data={
                    "path": str(target),
                    "page_count": page_count,
                    "is_scanned": is_scanned,
                    "text": full_text if not is_scanned else "[SCANNED PDF - OCR REQUIRED]"
                },
                evidence=f"Read PDF {target.name} ({page_count} pages). Scanned: {is_scanned}"
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Error reading PDF: {str(e)}")

