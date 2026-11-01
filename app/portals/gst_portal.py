"""
Realistic Indian SME Mock GST Portal Server.
Emulates the Government of India Goods and Services Tax (GST) Portal for automated computer-use testing.
Has NO REST API; requires authentic web navigation, form entry, session handling, and filing confirmation.
"""
import http.server
import urllib.parse
import json
import threading
import time
from typing import Optional, Dict, Any, List
from app.audit.logger import audit_logger


PORTAL_HTML_LOGIN = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GST Portal - Government of India</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f6f9; color: #333; }
        .top-bar { background-color: #0b2f6d; color: white; padding: 12px 40px; display: flex; align-items: center; justify-content: space-between; }
        .gov-title { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; }
        .sub-bar { background-color: #f26522; height: 4px; }
        .container { max-width: 480px; margin: 60px auto; background: white; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); border-top: 4px solid #0b2f6d; padding: 32px; }
        h2 { color: #0b2f6d; margin-top: 0; font-size: 22px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #4a5568; }
        input[type="text"], input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 15px; }
        input:focus { outline: none; border-color: #0b2f6d; box-shadow: 0 0 0 2px rgba(11,47,109,0.2); }
        .captcha-box { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
        .captcha-img { background: #e2e8f0; padding: 8px 16px; font-weight: bold; font-family: monospace; font-size: 20px; letter-spacing: 4px; color: #1a202c; border: 1px dashed #718096; border-radius: 4px; }
        .btn-submit { width: 100%; background: #0b2f6d; color: white; padding: 12px; font-size: 16px; font-weight: 600; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
        .btn-submit:hover { background: #082250; }
        .notice { font-size: 12px; color: #718096; text-align: center; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div class="gov-title">Goods and Services Tax Common Portal &bull; Government of India</div>
        <div>Helpdesk: 1800-103-4786</div>
    </div>
    <div class="sub-bar"></div>
    <div class="container">
        <h2>Taxpayer Login</h2>
        <form method="POST" action="/gst/login">
            <div class="form-group">
                <label for="username">GSTIN / Username</label>
                <input type="text" id="username" name="username" value="07AAAAA1234A1Z9" required autofocus>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" value="Gst2026#Secure" required>
            </div>
            <div class="form-group">
                <label for="captcha">Enter Captcha Shown</label>
                <div class="captcha-box">
                    <div class="captcha-img">9X7KP</div>
                    <input type="text" id="captcha" name="captcha" value="9X7KP" required>
                </div>
            </div>
            <button type="submit" id="btn-login" class="btn-submit">LOGIN</button>
        </form>
        <div class="notice">
            Official Portal for Filing Returns, ITC Claims, and Tax Remittances.<br>
            Secure 256-bit Encrypted Session.
        </div>
    </div>
</body>
</html>
"""

PORTAL_HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Returns Dashboard - GST Portal</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f6f9; color: #333; }
        .top-bar { background-color: #0b2f6d; color: white; padding: 12px 40px; display: flex; justify-content: space-between; align-items: center; }
        .sub-bar { background-color: #f26522; height: 4px; }
        .header-info { background: white; padding: 16px 40px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 14px; }
        .container { max-width: 1080px; margin: 30px auto; padding: 0 20px; }
        h1 { color: #0b2f6d; font-size: 24px; margin-bottom: 20px; }
        .search-box { background: white; padding: 20px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); display: flex; gap: 20px; align-items: center; margin-bottom: 30px; }
        .tile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .tile { background: white; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; border-top: 4px solid #0b2f6d; }
        .tile-header { padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #edf2f7; font-weight: bold; font-size: 16px; color: #1a202c; }
        .tile-body { padding: 20px; font-size: 14px; color: #4a5568; }
        .tile-footer { padding: 16px 20px; background: #fafafa; border-top: 1px solid #edf2f7; text-align: right; }
        .btn-action { background: #0b2f6d; color: white; padding: 8px 18px; border-radius: 4px; text-decoration: none; font-weight: 600; font-size: 13px; display: inline-block; cursor: pointer; border: none; }
        .btn-action:hover { background: #082250; }
        .status-due { color: #c53030; font-weight: bold; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div style="font-size: 18px; font-weight: bold;">Goods and Services Tax Portal</div>
        <div>Logged in as: <strong>07AAAAA1234A1Z9 (ABC Enterprises)</strong> | <a href="/gst/login" style="color: white; text-decoration: underline;">Logout</a></div>
    </div>
    <div class="sub-bar"></div>
    <div class="header-info">
        <div>Legal Name: <strong>ABC Enterprises</strong> | Trade Name: <strong>ABC Enterprises</strong></div>
        <div>State: <strong>Delhi (07)</strong> | Status: <strong style="color: green;">ACTIVE</strong></div>
    </div>
    <div class="container">
        <h1>File Returns Dashboard</h1>
        <div class="search-box">
            <div><strong>Financial Year:</strong> 2026-27</div>
            <div><strong>Quarter:</strong> Q3 (Oct - Dec)</div>
            <div><strong>Return Period:</strong> October 2026</div>
        </div>
        <div class="tile-grid">
            <div class="tile">
                <div class="tile-header">Details of outward supplies of goods or services (GSTR-1)</div>
                <div class="tile-body">
                    <p>Status: <span class="status-due">NOT FILED</span></p>
                    <p>Due Date: <strong>11/11/2026</strong></p>
                    <p>Record all outward B2B supplies, debit/credit notes, and export invoices for October 2026.</p>
                </div>
                <div class="tile-footer">
                    <a href="/gst/gstr1" id="btn-prepare-gstr1" class="btn-action">PREPARE ONLINE</a>
                </div>
            </div>
            <div class="tile" style="border-top-color: #718096; opacity: 0.85;">
                <div class="tile-header">Monthly Summary Return (GSTR-3B)</div>
                <div class="tile-body">
                    <p>Status: <strong>DRAFT</strong></p>
                    <p>Due Date: <strong>20/11/2026</strong></p>
                    <p>Summary return of inward and outward supplies with tax payment.</p>
                </div>
                <div class="tile-footer">
                    <button class="btn-action" style="background: #718096;" disabled>LOCKED UNTIL GSTR-1</button>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
"""

PORTAL_HTML_GSTR1 = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GSTR-1 - Outward Supplies Entry</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f6f9; color: #333; }
        .top-bar { background-color: #0b2f6d; color: white; padding: 12px 40px; display: flex; justify-content: space-between; align-items: center; }
        .sub-bar { background-color: #f26522; height: 4px; }
        .container { max-width: 1100px; margin: 30px auto; padding: 0 20px; }
        h1 { color: #0b2f6d; font-size: 22px; margin-bottom: 20px; }
        .card { background: white; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); padding: 24px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
        th { background-color: #244061; color: white; padding: 10px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) { background-color: #f8fafc; }
        .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
        .form-group { display: flex; flex-direction: column; }
        label { font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 4px; }
        input[type="text"], input[type="number"] { padding: 8px 10px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px; }
        .btn-add { background: #2b6cb0; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 18px; }
        .btn-add:hover { background: #2c5282; }
        .btn-summary { background: #0b2f6d; color: white; border: none; padding: 12px 28px; border-radius: 4px; font-weight: bold; font-size: 15px; cursor: pointer; float: right; margin-top: 20px; text-decoration: none; display: inline-block; }
        .btn-summary:hover { background: #082250; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div style="font-size: 18px; font-weight: bold;">GSTR-1 Details of Outward Supplies</div>
        <div>Tax Period: <strong>October 2026</strong> | <a href="/gst/dashboard" style="color: white;">Dashboard</a></div>
    </div>
    <div class="sub-bar"></div>
    <div class="container">
        <h1>4A, 4B, 6B, 6C - B2B Invoices</h1>
        <div class="card">
            <h3>Add New Inward / Outward B2B Invoice Record</h3>
            <form method="POST" action="/gst/add_invoice">
                <div class="form-grid">
                    <div class="form-group">
                        <label>Receiver GSTIN</label>
                        <input type="text" id="input_gstin" name="gstin" placeholder="07AAAAA0000A1Z5" required>
                    </div>
                    <div class="form-group">
                        <label>Invoice Number</label>
                        <input type="text" id="input_inv_no" name="inv_no" placeholder="INV-2026-1042" required>
                    </div>
                    <div class="form-group">
                        <label>Invoice Date</label>
                        <input type="text" id="input_date" name="inv_date" value="2026-10-10" required>
                    </div>
                    <div class="form-group">
                        <label>Total Invoice Value (INR)</label>
                        <input type="number" step="0.01" id="input_total" name="total" placeholder="27140.00" required>
                    </div>
                    <div class="form-group">
                        <label>Taxable Value (INR)</label>
                        <input type="number" step="0.01" id="input_taxable" name="taxable" placeholder="23000.00" required>
                    </div>
                    <div class="form-group">
                        <label>CGST (INR)</label>
                        <input type="number" step="0.01" id="input_cgst" name="cgst" placeholder="2070.00" value="0.00">
                    </div>
                    <div class="form-group">
                        <label>SGST (INR)</label>
                        <input type="number" step="0.01" id="input_sgst" name="sgst" placeholder="2070.00" value="0.00">
                    </div>
                    <div class="form-group">
                        <label>IGST (INR)</label>
                        <input type="number" step="0.01" id="input_igst" name="igst" placeholder="0.00" value="0.00">
                    </div>
                </div>
                <button type="submit" id="btn-add-invoice" class="btn-add">+ SAVE INVOICE RECORD</button>
            </form>
        </div>

        <div class="card">
            <h3>Entered B2B Supplies for Tax Period (October 2026)</h3>
            <table id="table-invoices">
                <thead>
                    <tr>
                        <th>Receiver GSTIN</th>
                        <th>Invoice No</th>
                        <th>Date</th>
                        <th>Taxable Value</th>
                        <th>CGST</th>
                        <th>SGST</th>
                        <th>IGST</th>
                        <th>Total Value</th>
                    </tr>
                </thead>
                <tbody>
                    {{TABLE_ROWS}}
                </tbody>
            </table>
            <div style="overflow: hidden;">
                <a href="/gst/summary" id="btn-proceed-summary" class="btn-summary">GENERATE RETURN SUMMARY &rarr;</a>
            </div>
        </div>
    </div>
</body>
</html>
"""

PORTAL_HTML_SUMMARY = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GSTR-1 Summary & Verification</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f6f9; color: #333; }
        .top-bar { background-color: #0b2f6d; color: white; padding: 12px 40px; display: flex; justify-content: space-between; align-items: center; }
        .sub-bar { background-color: #f26522; height: 4px; }
        .container { max-width: 900px; margin: 30px auto; padding: 0 20px; }
        h1 { color: #0b2f6d; font-size: 22px; margin-bottom: 20px; }
        .card { background: white; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); padding: 28px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
        th { background-color: #244061; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
        .total-row { font-weight: bold; background: #e2e8f0; }
        .declaration-box { background: #fffaf0; border: 1px solid #feebc8; padding: 16px; border-radius: 4px; margin: 24px 0; }
        .btn-file { background: #2f855a; color: white; border: none; padding: 14px 32px; border-radius: 4px; font-weight: bold; font-size: 16px; cursor: pointer; float: right; }
        .btn-file:hover { background: #276749; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div style="font-size: 18px; font-weight: bold;">GSTR-1 Consolidated Summary</div>
        <div>GSTIN: <strong>07AAAAA1234A1Z9</strong> | Period: <strong>October 2026</strong></div>
    </div>
    <div class="sub-bar"></div>
    <div class="container">
        <h1>Review Consolidated Outward Supplies</h1>
        <div class="card">
            <h3>Summary of Tax Liability</h3>
            <table>
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Count</th>
                        <th>Taxable Value</th>
                        <th>Central Tax</th>
                        <th>State Tax</th>
                        <th>Integrated Tax</th>
                        <th>Total Liability</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>4A, 4B - B2B Invoices</td>
                        <td>{{INV_COUNT}}</td>
                        <td>INR {{TAXABLE_SUM}}</td>
                        <td>INR {{CGST_SUM}}</td>
                        <td>INR {{SGST_SUM}}</td>
                        <td>INR {{IGST_SUM}}</td>
                        <td><strong>INR {{TOTAL_TAX}}</strong></td>
                    </tr>
                    <tr class="total-row">
                        <td colspan="2">TOTAL OUTWARD LIABILITY</td>
                        <td>INR {{TAXABLE_SUM}}</td>
                        <td>INR {{CGST_SUM}}</td>
                        <td>INR {{SGST_SUM}}</td>
                        <td>INR {{IGST_SUM}}</td>
                        <td style="color: #2f855a;">INR {{TOTAL_TAX}}</td>
                    </tr>
                </tbody>
            </table>

            <form method="POST" action="/gst/submit">
                <div class="declaration-box">
                    <label>
                        <input type="checkbox" id="chk-declaration" name="declaration" required checked>
                        <strong>Declaration:</strong> I hereby solemnly affirm and declare that the information given herein is true and correct to the best of my knowledge and belief, and nothing has been concealed therefrom.
                    </label>
                </div>
                <div style="overflow: hidden;">
                    <a href="/gst/gstr1" style="color: #4a5568; font-weight: 600; line-height: 48px; text-decoration: none;">&larr; Back to Edit Invoices</a>
                    <button type="submit" id="btn-file-return" class="btn-file">FILE WITH EVC (ELECTRONIC VERIFICATION)</button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
"""

PORTAL_HTML_FILED = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GSTR-1 Filed Acknowledgment</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f6f9; color: #333; }
        .top-bar { background-color: #0b2f6d; color: white; padding: 12px 40px; display: flex; justify-content: space-between; align-items: center; }
        .sub-bar { background-color: #f26522; height: 4px; }
        .container { max-width: 720px; margin: 50px auto; background: white; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); padding: 40px; text-align: center; }
        .success-icon { font-size: 56px; color: #38a169; }
        h1 { color: #276749; margin-top: 10px; }
        .arn-badge { background: #e6fffa; border: 2px dashed #319795; padding: 16px; border-radius: 6px; font-size: 18px; font-family: monospace; font-weight: bold; color: #234e52; margin: 24px 0; }
        .meta-table { width: 100%; border-collapse: collapse; text-align: left; margin: 24px 0; font-size: 14px; }
        .meta-table td { padding: 10px; border-bottom: 1px solid #edf2f7; }
        .meta-table td:first-child { font-weight: bold; color: #4a5568; width: 40%; }
        .btn-home { background: #0b2f6d; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; display: inline-block; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div style="font-size: 18px; font-weight: bold;">Government of India &bull; GST Return Acknowledgment</div>
        <div>Date: <strong>01-Nov-2026</strong></div>
    </div>
    <div class="sub-bar"></div>
    <div class="container">
        <div class="success-icon">&#10004;</div>
        <h1>GSTR-1 Return Successfully Filed!</h1>
        <p>The outward supplies return for tax period October 2026 has been authenticated and filed successfully.</p>
        <div class="arn-badge" id="arn-display">
            ARN: {{ARN_NUMBER}}
        </div>
        <table class="meta-table">
            <tr><td>Legal Name:</td><td>ABC Enterprises</td></tr>
            <tr><td>GSTIN:</td><td>07AAAAA1234A1Z9</td></tr>
            <tr><td>Tax Period:</td><td>October 2026</td></tr>
            <tr><td>Filing Mode:</td><td>Electronic Verification Code (EVC) Verified</td></tr>
            <tr><td>Acknowledgment ARN:</td><td><strong>{{ARN_NUMBER}}</strong></td></tr>
            <tr><td>Timestamp:</td><td>{{FILED_TIMESTAMP}}</td></tr>
            <tr><td>Status:</td><td><strong style="color: #276749;">FILED - PROCESSED</strong></td></tr>
        </table>
        <a href="/gst/dashboard" class="btn-home">Back to Dashboard</a>
    </div>
</body>
</html>
"""


class GSTPortalHandler(http.server.BaseHTTPRequestHandler):
    """Handles requests for the simulated no-API Indian GST Portal."""

    # In-memory session state for invoices entered during this session
    invoices: List[Dict[str, Any]] = []
    is_authenticated: bool = False
    filed_arn: Optional[str] = None
    filed_timestamp: Optional[str] = None

    def log_message(self, format, *args):
        # Quiet standard HTTP access logs to keep terminal uncluttered
        pass

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path in ("", "/", "/gst", "/gst/login"):
            self._respond_html(PORTAL_HTML_LOGIN)
        elif path == "/gst/dashboard":
            self._respond_html(PORTAL_HTML_DASHBOARD)
        elif path == "/gst/gstr1":
            self._render_gstr1()
        elif path == "/gst/summary":
            self._render_summary()
        elif path == "/gst/filed":
            self._render_filed()
        elif path == "/gst/api/state":
            # State query for automated verification
            data = {
                "authenticated": GSTPortalHandler.is_authenticated,
                "invoice_count": len(GSTPortalHandler.invoices),
                "invoices": GSTPortalHandler.invoices,
                "filed_arn": GSTPortalHandler.filed_arn,
                "filed_timestamp": GSTPortalHandler.filed_timestamp
            }
            self._respond_json(data)
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Page Not Found on GST Portal")

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        params = urllib.parse.parse_qs(body)

        if path == "/gst/login":
            GSTPortalHandler.is_authenticated = True
            audit_logger.info("GST Portal login successful for 07AAAAA1234A1Z9.")
            self._redirect("/gst/dashboard")

        elif path == "/gst/add_invoice":
            inv_entry = {
                "gstin": params.get("gstin", [""])[0],
                "inv_no": params.get("inv_no", [""])[0],
                "inv_date": params.get("inv_date", [""])[0],
                "total": float(params.get("total", [0.0])[0]),
                "taxable": float(params.get("taxable", [0.0])[0]),
                "cgst": float(params.get("cgst", [0.0])[0]),
                "sgst": float(params.get("sgst", [0.0])[0]),
                "igst": float(params.get("igst", [0.0])[0]),
            }
            GSTPortalHandler.invoices.append(inv_entry)
            audit_logger.info("Added invoice to GST Portal: %s (Total: Rs.%.2f)", inv_entry["inv_no"], inv_entry["total"])
            self._redirect("/gst/gstr1")

        elif path == "/gst/submit":
            arn = f"AA071026098{len(GSTPortalHandler.invoices):02d}Z"
            GSTPortalHandler.filed_arn = arn
            GSTPortalHandler.filed_timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            audit_logger.info("GSTR-1 successfully submitted on portal! Generated ARN: %s", arn)
            self._redirect("/gst/filed")

        else:
            self.send_response(404)
            self.end_headers()

    def _respond_html(self, html: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _respond_json(self, data: dict):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def _redirect(self, target: str):
        self.send_response(303)
        self.send_header("Location", target)
        self.end_headers()

    def _render_gstr1(self):
        rows = ""
        for inv in GSTPortalHandler.invoices:
            rows += (
                f"<tr>"
                f"<td>{inv['gstin']}</td>"
                f"<td><strong>{inv['inv_no']}</strong></td>"
                f"<td>{inv['inv_date']}</td>"
                f"<td>₹{inv['taxable']:,.2f}</td>"
                f"<td>₹{inv['cgst']:,.2f}</td>"
                f"<td>₹{inv['sgst']:,.2f}</td>"
                f"<td>₹{inv['igst']:,.2f}</td>"
                f"<td><strong>₹{inv['total']:,.2f}</strong></td>"
                f"</tr>\n"
            )
        if not rows:
            rows = "<tr><td colspan='8' style='text-align:center; color:#718096;'>No B2B invoices recorded yet. Use the form above to add supply records.</td></tr>"

        html = PORTAL_HTML_GSTR1.replace("{{TABLE_ROWS}}", rows)
        self._respond_html(html)

    def _render_summary(self):
        count = len(GSTPortalHandler.invoices)
        taxable_sum = sum(i["taxable"] for i in GSTPortalHandler.invoices)
        cgst_sum = sum(i["cgst"] for i in GSTPortalHandler.invoices)
        sgst_sum = sum(i["sgst"] for i in GSTPortalHandler.invoices)
        igst_sum = sum(i["igst"] for i in GSTPortalHandler.invoices)
        total_tax = cgst_sum + sgst_sum + igst_sum

        html = (
            PORTAL_HTML_SUMMARY
            .replace("{{INV_COUNT}}", str(count))
            .replace("{{TAXABLE_SUM}}", f"{taxable_sum:,.2f}")
            .replace("{{CGST_SUM}}", f"{cgst_sum:,.2f}")
            .replace("{{SGST_SUM}}", f"{sgst_sum:,.2f}")
            .replace("{{IGST_SUM}}", f"{igst_sum:,.2f}")
            .replace("{{TOTAL_TAX}}", f"{total_tax:,.2f}")
        )
        self._respond_html(html)

    def _render_filed(self):
        arn = GSTPortalHandler.filed_arn or "AA071026098451Z"
        ts = GSTPortalHandler.filed_timestamp or time.strftime("%Y-%m-%d %H:%M:%S")
        html = (
            PORTAL_HTML_FILED
            .replace("{{ARN_NUMBER}}", arn)
            .replace("{{FILED_TIMESTAMP}}", ts)
        )
        self._respond_html(html)


class GSTPortalServer:
    """Manages the background HTTP thread for the mock GST Portal."""
    def __init__(self, host: str = "127.0.0.1", port: int = 8088):
        self.host = host
        self.port = port
        self.server: Optional[http.server.ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self.server is not None:
            return
        try:
            self.server = http.server.ThreadingHTTPServer((self.host, self.port), GSTPortalHandler)
            self._thread = threading.Thread(target=self.server.serve_forever, daemon=True, name="MockGSTPortal")
            self._thread.start()
            audit_logger.info("Mock Indian GST Portal running at http://%s:%d/gst/login", self.host, self.port)
        except Exception as e:
            audit_logger.warning("Could not bind GST Portal to port %d (%s). Retrying on alternate port...", self.port, e)
            self.port = 8089
            self.server = http.server.ThreadingHTTPServer((self.host, self.port), GSTPortalHandler)
            self._thread = threading.Thread(target=self.server.serve_forever, daemon=True, name="MockGSTPortal")
            self._thread.start()
            audit_logger.info("Mock Indian GST Portal running at http://%s:%d/gst/login", self.host, self.port)

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def reset_state(self):
        GSTPortalHandler.invoices = []
        GSTPortalHandler.is_authenticated = False
        GSTPortalHandler.filed_arn = None
        GSTPortalHandler.filed_timestamp = None


gst_portal_server = GSTPortalServer()
