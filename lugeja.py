#!/usr/bin/env python3
"""
Lugeja - Kaasaegne, minimalistlik veebirakendus RSS voogude ja veebiuudiste lugemiseks.
"""

import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TALLINN_TZ = ZoneInfo("Europe/Tallinn")
import base64
import hashlib
import html
import re
import secrets
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps
import requests
from flask import Flask, render_template, request, jsonify, Response, send_from_directory, make_response, session
from werkzeug.security import generate_password_hash, check_password_hash

import parser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'lugeja.db')

# Laeme lokaalselt .env faili väärtused, kui fail eksisteerib
_env_file = os.path.join(BASE_DIR, '.env')
try:
    from dotenv import load_dotenv
    load_dotenv(_env_file)
except ImportError:
    if os.path.exists(_env_file):
        try:
            with open(_env_file, 'r', encoding='utf-8') as _f:
                for _line in _f:
                    _line = _line.strip()
                    if _line and not _line.startswith('#') and '=' in _line:
                        _k, _v = _line.split('=', 1)
                        _k, _v = _k.strip(), _v.strip().strip('"').strip("'")
                        if _k and _k not in os.environ:
                            os.environ[_k] = _v
        except Exception:
            pass


app = Flask(__name__)
app.config['DATABASE'] = DB_PATH
configured_secret = os.environ.get('SECRET_KEY')
if not configured_secret:
    # Turvaline võti, kui keskkonnamuutujat pole määratud.
    # Salvestame lokaalsesse faili, et mitme Gunicorni töötajaga (multi-worker) seansid püsiksid stabiilsena.
    secret_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.secret_key')
    try:
        if os.path.exists(secret_file):
            with open(secret_file, 'r', encoding='utf-8') as f:
                app.secret_key = f.read().strip()
        else:
            new_key = secrets.token_hex(32)
            with open(secret_file, 'w', encoding='utf-8') as f:
                f.write(new_key)
            app.secret_key = new_key
    except Exception:
        app.secret_key = secrets.token_hex(32)
        if not app.debug:
            app.logger.warning("HOIATUS: SECRET_KEY puudub ja .secret_key faili ei saanud salvestada.")
else:
    app.secret_key = configured_secret
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_NAME'] = 'lugeja_session'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=365)
is_render = bool(os.environ.get('RENDER') or os.environ.get('RENDER_SERVICE_ID'))
is_secure_env = os.environ.get('SESSION_COOKIE_SECURE', '').strip().lower() in ('1', 'true', 'yes')
app.config['SESSION_COOKIE_SECURE'] = bool(is_render or is_secure_env)

# Lukustus andmebaasi tehingute ja uuendamiste koordineerimiseks
refresh_lock = threading.Lock()
active_user_refreshes = set()
global_is_refreshing = False
user_refresh_results = {}  # user_id -> dict
global_refresh_result = {
    'completed_at': None,
    'new_articles': 0,
    'error': None
}

# Turso pilve-andmebaasi seadistus (kui keskkonnamuutujad on määratud)
TURSO_DATABASE_URL = (os.environ.get('TURSO_DATABASE_URL') or os.environ.get('DATABASE_URL') or '').strip()
TURSO_AUTH_TOKEN = (os.environ.get('TURSO_AUTH_TOKEN') or '').strip().strip('"').strip("'")
IS_TURSO = bool(TURSO_DATABASE_URL and ('turso.io' in TURSO_DATABASE_URL or TURSO_DATABASE_URL.startswith(('libsql://', 'https://', 'http://'))))

class LibsqlRow:
    """Row-objekt, mis tagab sqlite3.Row-ga identse liidese nii indeksite kui veergude nimedega."""
    def __init__(self, description, values):
        self._values = tuple(values)
        self._fields = {}
        for i, col in enumerate(description):
            name = col[0]
            self._fields[name] = i
            self._fields[name.lower()] = i

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._values[item]
        if isinstance(item, str):
            if item in self._fields:
                return self._values[self._fields[item]]
            item_lower = item.lower()
            if item_lower in self._fields:
                return self._values[self._fields[item_lower]]
        raise KeyError(item)

    def get(self, item, default=None):
        try:
            return self[item]
        except (KeyError, IndexError):
            return default

    def __contains__(self, item):
        if isinstance(item, str):
            return item in self._fields or item.lower() in self._fields
        return False

    def keys(self):
        seen = set()
        res = []
        for k in self._fields.keys():
            if k.lower() not in seen:
                seen.add(k.lower())
                res.append(k)
        return res

    def values(self):
        return self._values

    def items(self):
        return [(k, self[k]) for k in self.keys()]

    def __iter__(self):
        return iter(self.keys())

    def __len__(self):
        return len(self._values)

    def __repr__(self):
        return f"<LibsqlRow {dict(self.items())}>"

class TursoCursor:
    """Cursor-wrapper Turso HTTP Pipeline API jaoks."""
    def __init__(self, client):
        self._client = client
        self._rows = []
        self._idx = 0
        self._cols = []
        self.lastrowid = None
        self.rowcount = -1
        self.description = None

    def execute(self, sql, params=None):
        cols, rows, affected, last_id = self._client._execute_single(sql, params)
        self._cols = cols
        self._rows = rows
        self._idx = 0
        self.rowcount = affected if affected is not None else -1
        try:
            self.lastrowid = int(last_id) if last_id is not None else None
        except (ValueError, TypeError):
            self.lastrowid = last_id
        if cols:
            self.description = [(c, None, None, None, None, None, None) for c in cols]
        else:
            self.description = None
        return self

    def executemany(self, sql, params_list):
        if not params_list:
            self._rows = []
            self._idx = 0
            self.rowcount = 0
            self.description = None
            return self
        total_affected, last_id = self._client._execute_batch(sql, params_list)
        self._rows = []
        self._idx = 0
        self.rowcount = total_affected
        try:
            self.lastrowid = int(last_id) if last_id is not None else None
        except (ValueError, TypeError):
            self.lastrowid = last_id
        self.description = None
        return self

    def fetchone(self):
        if self._idx < len(self._rows):
            row = self._rows[self._idx]
            self._idx += 1
            if self.description:
                return LibsqlRow(self.description, row)
            return row
        return None

    def fetchall(self):
        if self._idx >= len(self._rows):
            return []
        remaining = self._rows[self._idx:]
        self._idx = len(self._rows)
        if self.description:
            return [LibsqlRow(self.description, r) for r in remaining]
        return remaining

    def close(self):
        self._rows = []
        self._idx = 0

_thread_local = threading.local()

def _get_turso_session(auth_token):
    session = getattr(_thread_local, 'turso_session', None)
    stored_token = getattr(_thread_local, 'turso_token', None)
    if session is None or stored_token != auth_token:
        if session:
            try:
                session.close()
            except Exception:
                pass
        session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20)
        session.mount('https://', adapter)
        session.mount('http://', adapter)
        session.headers.update({
            'Authorization': f'Bearer {auth_token}',
            'Content-Type': 'application/json'
        })
        _thread_local.turso_session = session
        _thread_local.turso_token = auth_token
    return session

class TursoHttpClient:
    """
    Turso HTTP Pipeline API klient.
    Kasutab Turso ametlikku /v2/pipeline otspunkti üle HTTPS-i.
    Eelised:
      - Töötab 100% stabiilselt ilma Rust/C lisamoodulite hangumiste või ühenduse katkemisteta.
      - Toetab rangeid päringute ajalõppe (timeout=15s), välistades lõputu laadimise.
      - Lõimeturvaline ja sobib ideaalselt Render / Gunicorn pilvekeskkondadesse.
      - Kasutab lõimepõhist ühenduste basseini (Connection Pool), vältides TLS kätlusi igal päringul.
    """
    def __init__(self, db_url, auth_token, timeout=15):
        clean_url = db_url.strip()
        if clean_url.startswith('libsql://'):
            self.base_url = 'https://' + clean_url[len('libsql://'):]
        elif clean_url.startswith(('http://', 'https://')):
            self.base_url = clean_url
        else:
            self.base_url = 'https://' + clean_url
        self.endpoint = self.base_url.rstrip('/') + '/v2/pipeline'
        self.auth_token = auth_token.strip()
        self.timeout = timeout
        self.session = _get_turso_session(self.auth_token)

    def _to_arg(self, val):
        if val is None:
            return {'type': 'null'}
        elif isinstance(val, bool):
            return {'type': 'integer', 'value': str(int(val))}
        elif isinstance(val, int):
            return {'type': 'integer', 'value': str(val)}
        elif isinstance(val, float):
            return {'type': 'float', 'value': val}
        elif isinstance(val, bytes):
            return {'type': 'blob', 'base64': base64.b64encode(val).decode('ascii')}
        else:
            return {'type': 'text', 'value': str(val)}

    def _from_val(self, v):
        if not isinstance(v, dict):
            return v
        t = v.get('type')
        if t == 'null':
            return None
        elif t == 'integer':
            val = v.get('value', 0)
            try:
                return int(val)
            except (ValueError, TypeError):
                return val
        elif t == 'float':
            return float(v.get('value', 0.0))
        elif t == 'blob':
            b64 = v.get('base64', '')
            return base64.b64decode(b64) if b64 else b''
        return v.get('value')

    def _execute_single(self, sql, params=None):
        args = []
        if params is not None:
            if isinstance(params, (list, tuple)):
                args = [self._to_arg(p) for p in params]
            else:
                args = [self._to_arg(params)]

        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args
                    }
                },
                {"type": "close"}
            ]
        }

        resp = self.session.post(
            self.endpoint,
            json=payload,
            timeout=self.timeout
        )

        if resp.status_code != 200:
            raise Exception(f"Turso HTTP viga ({resp.status_code}): {resp.text}")

        data = resp.json()
        results = data.get('results', [])
        if not results:
            return [], [], 0, None

        res0 = results[0]
        if res0.get('type') == 'error':
            err_msg = (res0.get('error') or {}).get('message', 'Tundmatu Turso viga')
            if 'unique' in err_msg.lower():
                raise sqlite3.IntegrityError(err_msg)
            raise sqlite3.OperationalError(err_msg)

        resp_dict = res0.get('response') or {}
        exec_res = resp_dict.get('result') or {}
        raw_cols = exec_res.get('cols') or []
        cols = [c['name'] for c in raw_cols] if raw_cols else []
        raw_rows = exec_res.get('rows') or []
        rows = [[self._from_val(cell) for cell in r] for r in raw_rows] if raw_rows else []
        affected = exec_res.get('affected_row_count', 0)
        last_id = exec_res.get('last_insert_rowid')
        return cols, rows, affected, last_id

    def _execute_batch(self, sql, params_list):
        if not params_list:
            return 0, None

        chunk_size = 30
        total_affected = 0
        last_id = None

        for i in range(0, len(params_list), chunk_size):
            chunk = params_list[i:i + chunk_size]
            pipeline_requests = []
            for params in chunk:
                args = []
                if params is not None:
                    if isinstance(params, (list, tuple)):
                        args = [self._to_arg(p) for p in params]
                    else:
                        args = [self._to_arg(params)]
                pipeline_requests.append({
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args
                    }
                })
            pipeline_requests.append({"type": "close"})

            resp = self.session.post(
                self.endpoint,
                json={"requests": pipeline_requests},
                timeout=max(self.timeout, 25)
            )

            if resp.status_code != 200:
                raise Exception(f"Turso batch HTTP viga ({resp.status_code}): {resp.text}")

            data = resp.json()
            for r in data.get('results', []):
                if r.get('type') == 'error':
                    err_msg = (r.get('error') or {}).get('message', 'Tundmatu Turso viga')
                    if 'unique' in err_msg.lower():
                        continue
                    raise sqlite3.OperationalError(err_msg)
                if r.get('type') == 'ok':
                    resp_dict = r.get('response') or {}
                    res_data = resp_dict.get('result') or {}
                    total_affected += res_data.get('affected_row_count', 0)
                    if res_data.get('last_insert_rowid') is not None:
                        last_id = res_data.get('last_insert_rowid')

        return total_affected, last_id

    def cursor(self):
        return TursoCursor(self)

    def execute(self, sql, params=None):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, params_list):
        cur = self.cursor()
        cur.executemany(sql, params_list)
        return cur

    def execute_transaction(self, statements_and_params):
        """
        Käivitab mitu SQL-lauset ühes aatomilises Turso pipeline transaktsioonis (BEGIN ... COMMIT).
        statements_and_params on loend (sql, params) paaridest.
        """
        if not statements_and_params:
            return
        requests = [{"type": "execute", "stmt": {"sql": "BEGIN"}}]
        for sql, params in statements_and_params:
            args = []
            if params is not None:
                if isinstance(params, (list, tuple)):
                    args = [self._to_arg(p) for p in params]
                else:
                    args = [self._to_arg(params)]
            requests.append({"type": "execute", "stmt": {"sql": sql, "args": args}})
        requests.append({"type": "execute", "stmt": {"sql": "COMMIT"}})
        requests.append({"type": "close"})

        resp = self.session.post(self.endpoint, json={"requests": requests}, timeout=max(self.timeout, 25))
        if resp.status_code != 200:
            raise Exception(f"Turso transaktsiooni HTTP viga ({resp.status_code}): {resp.text}")
        data = resp.json()
        for res in data.get('results', []):
            if res.get('type') == 'error':
                err_msg = (res.get('error') or {}).get('message', 'Tundmatu Turso transaktsiooni viga')
                raise sqlite3.OperationalError(err_msg)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        # Sessioon säilitatakse lõimes ühenduste taaskasutamiseks (Connection Pooling)
        pass

def get_db_connection():
    if IS_TURSO:
        return TursoHttpClient(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
    else:
        conn = sqlite3.connect(app.config['DATABASE'], timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA foreign_keys = ON")
        except Exception:
            pass
        return conn

def init_db():
    if IS_TURSO:
        print(f"[Lugeja] Kasutatakse Turso pilve-andmebaasi HTTP API kaudu: {TURSO_DATABASE_URL}")
    else:
        print(f"[Lugeja] Kasutatakse kohalikku SQLite andmebaasi: {app.config['DATABASE']}")
    conn = get_db_connection()
    cursor = conn.cursor()

    # 0. Users tabel
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin BOOLEAN DEFAULT 0,
            device_mobile_count INTEGER DEFAULT 0,
            device_desktop_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 1. Categories tabel (kasutajapõhine)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, name)
        )
    """)

    # 2. Sources tabel (kasutajapõhine)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            is_rss BOOLEAN DEFAULT 1,
            logo_url TEXT,
            category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
            last_polled_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, url)
        )
    """)

    # 3. Articles tabel (allikapõhine, kuulub allika kaudu kasutajale)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            image_url TEXT,
            published_at DATETIME,
            is_read BOOLEAN DEFAULT 0,
            is_read_later BOOLEAN DEFAULT 0,
            is_opened BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_id, url)
        )
    """)

    # Migratsioon: lisame vajadusel is_opened veeru olemasolevasse tabelisse
    try:
        cursor.execute("ALTER TABLE articles ADD COLUMN is_opened BOOLEAN DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN device_mobile_count INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN device_desktop_count INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT")
    except Exception:
        pass

    # 4. Password resets tabel (parooli taastamise koodid)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Indeksid kiireks pärimiseks
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name COLLATE NOCASE)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sources_category ON sources(category_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_source_read ON articles(source_id, is_read)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_source_read_pub ON articles(source_id, is_read, published_at DESC, id DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_source_opened ON articles(source_id, is_opened)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_read_later ON articles(is_read_later)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users(email COLLATE NOCASE) WHERE email IS NOT NULL")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)")
    except Exception as e:
        print(f"Hoiatus indeksite loomisel: {e}")

    conn.commit()
    conn.close()

def is_valid_email(email_str):
    """Kontrollib e-posti aadressi baasvormingu korrektsust."""
    if not email_str or not isinstance(email_str, str):
        return False
    email_regex = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    return bool(re.match(email_regex, email_str.strip()))

def send_password_reset_email(to_email, reset_url, username=""):
    """
    Saadab parooli taastamise e-kirja.
    Kui SMTP keskkonnamuutujat SMTP_HOST pole määratud, kuvab taastamislingi konsoolis
    ja tagastab True (arendus- ja testrežiim).
    """
    smtp_host = os.environ.get('SMTP_HOST', '').strip()
    smtp_port_raw = os.environ.get('SMTP_PORT', '587').strip()
    try:
        smtp_port = int(smtp_port_raw)
    except ValueError:
        smtp_port = 587
    smtp_user = os.environ.get('SMTP_USER', '').strip()
    smtp_pass = os.environ.get('SMTP_PASSWORD', '').strip()
    smtp_from = os.environ.get('SMTP_FROM', '').strip() or smtp_user or 'noreply@lugeja.app'
    use_tls = os.environ.get('SMTP_TLS', 'true').strip().lower() in ('1', 'true', 'yes')
    use_ssl = os.environ.get('SMTP_SSL', 'false').strip().lower() in ('1', 'true', 'yes') or smtp_port == 465

    if not to_email or '\r' in to_email or '\n' in to_email:
        return False
    clean_to = to_email.strip()
    if not is_valid_email(clean_to):
        return False

    if not smtp_host:
        print("\n" + "=" * 60)
        print("[Lugeja] PAROOLI TAASTAMINE (SMTP_HOST pole määratud)")
        print(f"Saaja e-post: {clean_to}")
        if username:
            print(f"Kasutaja:     {username}")
        print(f"Taastamislink: {reset_url}")
        print("=" * 60 + "\n")
        return True

    try:
        escaped_username = html.escape(username)
        escaped_reset_url = html.escape(reset_url)

        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Lugeja - Parooli taastamine'
        msg['From'] = f"Lugeja <{smtp_from}>"
        msg['To'] = clean_to

        user_greeting = f" {username}" if username else ""
        plain_text = (
            f"Tere{user_greeting}!\n\n"
            f"Oled taotlenud Lugeja rakenduse parooli taastamist.\n"
            f"Uue parooli määramiseks ava järgmine link:\n\n"
            f"{reset_url}\n\n"
            f"See link kehtib 1 tund. Kui sa ei taotlenud parooli taastamist, võid seda kirja eirata.\n\n"
            f"Parimate soovidega,\nLugeja meeskond"
        )

        html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{
      font-family: Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background-color: #0F1511;
      color: #DEE4DE;
      padding: 30px 15px;
      margin: 0;
    }}
    .container {{
      max-width: 500px;
      margin: 0 auto;
      background-color: #1B211D;
      border: 1px solid #303632;
      border-radius: 20px;
      padding: 32px 28px;
    }}
    .brand-title {{
      font-size: 22px;
      font-weight: 700;
      color: #8BD69E;
      letter-spacing: -0.01em;
      margin-bottom: 20px;
    }}
    h1 {{
      font-size: 18px;
      font-weight: 600;
      color: #DEE4DE;
      margin: 0 0 16px 0;
    }}
    p {{
      font-size: 14px;
      line-height: 1.6;
      color: #BFC9C0;
      margin: 0 0 18px 0;
    }}
    .btn {{
      display: inline-block;
      background-color: #8BD69E;
      color: #003919 !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      padding: 12px 28px;
      border-radius: 9999px;
      margin: 8px 0 20px 0;
    }}
    .link-alt {{
      font-size: 12px;
      color: #89938B;
      word-break: break-all;
    }}
    .footer {{
      font-size: 12px;
      color: #89938B;
      border-top: 1px solid #303632;
      padding-top: 16px;
      margin-top: 24px;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-title">Lugeja</div>
    <h1>Parooli taastamine</h1>
    <p>Tere{f' <strong>{escaped_username}</strong>' if escaped_username else ''}! Oled taotlenud oma konto parooli taastamist.</p>
    <p>Uue parooli määramiseks vajuta allolevale nupule:</p>
    <p><a href="{escaped_reset_url}" class="btn">Määra uus parool</a></p>
    <p class="link-alt">Kui nupp ei toimi, kopeeri brauserisse järgmine aadress:<br>{escaped_reset_url}</p>
    <div class="footer">
      Taastamislink kehtib 1 tund.<br>Kui sa ei taotlenud parooli taastamist, võid seda teadet rahulikult eirata.
    </div>
  </div>
</body>
</html>"""

        msg.attach(MIMEText(plain_text, 'plain', 'utf-8'))
        msg.attach(MIMEText(html_content, 'html', 'utf-8'))

        if use_ssl:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
            if use_tls:
                server.starttls()

        if smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)

        server.sendmail(smtp_from, [clean_to], msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"[Lugeja] Viga e-kirja saatmisel ({clean_to}): {e}")
        return False

def get_trusted_base_url():
    """
    Tagastab usaldusväärse rakenduse baas-URL-i parooli taastamise ja teadete jaoks.
    Eelistab keskkonnamuutujat APP_URL.
    Kui seda pole määratud, valideerib Host-päist rangelt lubatud hostide loendi vastu,
    tõkestades Host Header Injection ründeid.
    """
    configured_app_url = os.environ.get('APP_URL', '').strip().rstrip('/')
    if configured_app_url:
        return configured_app_url

    raw_host = request.host.split(':')[0].strip().lower()
    allowed_hosts = {'127.0.0.1', 'localhost'}
    allowed_from_env = os.environ.get('ALLOWED_HOSTS', '').strip()
    if allowed_from_env:
        for h in allowed_from_env.split(','):
            h_clean = h.strip().lower()
            if h_clean:
                allowed_hosts.add(h_clean)

    if raw_host in allowed_hosts or raw_host.endswith('.onrender.com'):
        proto = (request.headers.get('X-Forwarded-Proto') or request.scheme or 'http').strip().lower()
        scheme = 'https' if proto == 'https' else 'http'
        return f"{scheme}://{request.host}".rstrip('/')

    return f"http://127.0.0.1:{os.environ.get('PORT', 5000)}"

AUTH_RATE_LIMITS = {}
RATE_LIMIT_LOCK = threading.Lock()

def check_rate_limit(ip: str, endpoint: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    """Kontrollib, kas antud IP on ületanud lubatud päringute arvu antud ajaaknas."""
    now = time.time()
    with RATE_LIMIT_LOCK:
        records = AUTH_RATE_LIMITS.get(ip, [])
        records = [r for r in records if now - r[0] < window_seconds]
        endpoint_count = sum(1 for r in records if r[1] == endpoint)
        if endpoint_count >= max_requests:
            AUTH_RATE_LIMITS[ip] = records
            return False
        records.append((now, endpoint))
        AUTH_RATE_LIMITS[ip] = records
        if len(AUTH_RATE_LIMITS) > 1000:
            for k in list(AUTH_RATE_LIMITS.keys()):
                AUTH_RATE_LIMITS[k] = [r for r in AUTH_RATE_LIMITS[k] if now - r[0] < window_seconds]
                if not AUTH_RATE_LIMITS[k]:
                    del AUTH_RATE_LIMITS[k]
        return True

def get_client_ip():
    """Tuvastab usaldusväärse kliendi IP aadressi kiiruspiirangute jaoks."""
    # 1. Cloudflare ametlik päis (kui spetsiaalselt sisse lülitatud)
    if os.environ.get('TRUST_CLOUDFLARE', '').strip().lower() in ('1', 'true', 'yes'):
        cf_ip = request.headers.get('CF-Connecting-IP', '').strip()
        if cf_ip:
            return cf_ip

    # 2. Pöördpuhverserver (Render.com või spetsiaalselt seadistatud TRUST_PROXY)
    trust_proxy = is_render or os.environ.get('TRUST_PROXY', '').strip().lower() in ('1', 'true', 'yes')
    if trust_proxy:
        forwarded = request.headers.get('X-Forwarded-For', '')
        if forwarded:
            parts = [p.strip() for p in forwarded.split(',') if p.strip()]
            if parts:
                return parts[-1]

    # 3. Otseühendus (turvaline vaikeväärtus ilma võltsitavate päisteta)
    return request.remote_addr or '127.0.0.1'

def get_pwd_version(pwd_hash: str) -> str:
    """Genereerib parooliräsi SHA-256 kontrollkoodi seansside kehtetuks tunnistamiseks."""
    if not pwd_hash:
        return ''
    return hashlib.sha256(pwd_hash.encode('utf-8')).hexdigest()[:16]

@app.before_request
def make_session_permanent():
    if 'user_id' in session:
        session.permanent = True

def get_current_user():
    """Tagastab hetkel sisselogitud kasutaja sõnastikuna või None."""
    user_id = session.get('user_id')
    if not user_id:
        return None
    session.permanent = True
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, is_admin, created_at, password_hash FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        session.clear()
        return None

    pwd_hash = row['password_hash']
    pwd_version = get_pwd_version(pwd_hash)
    saved_version = session.get('pwd_version')
    if saved_version and saved_version != pwd_version:
        session.clear()
        return None
    if not saved_version and pwd_version:
        session['pwd_version'] = pwd_version

    user_dict = dict(row)
    user_dict.pop('password_hash', None)
    return user_dict

def login_required(f):
    """Dekoraator, mis tagab et marsruudile pääseb ligi ainult sisselogitud kasutaja."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Autentimine on nõutav', 'authenticated': False}), 401
        return f(user, *args, **kwargs)
    return decorated_function

def is_mobile_request(req):
    """Tuvastab User-Agent päise või kohandatud päise põhjal, kas päring tehti mobiiliseadmest."""
    client_hint = req.headers.get('X-Device-Type', '').strip().lower()
    if client_hint in ('mobile', 'desktop'):
        return client_hint == 'mobile'
    ua = (req.headers.get('User-Agent') or '').lower()
    mobile_keywords = ['mobile', 'android', 'iphone', 'ipod', 'blackberry', 'iemobile', 'opera mini', 'webos']
    if 'ipad' in ua:
        return True
    return any(k in ua for k in mobile_keywords)


def prune_unread_articles(cursor, source_id, max_unread=500, max_read=100):
    """
    Iga andmeallika kohta hoitakse alles maksimaalselt `max_unread` (500) lugemata uudist
    ja maksimaalselt `max_read` (100) loetud uudist.
    Uute uudiste lisandumisel alustatakse vanemate kustutamist tagantpoolt.
    Hiljem lugemiseks märgitud lood (is_read_later = 1) ei kustu andmebaasist kunagi.
    """
    try:
        # 1. Kärbi lugemata uudised (max 500)
        cursor.execute("""
            DELETE FROM articles
            WHERE id IN (
                SELECT id FROM articles
                WHERE source_id = ? AND is_read = 0 AND (is_read_later = 0 OR is_read_later IS NULL)
                ORDER BY published_at DESC, id DESC
                LIMIT 100000 OFFSET ?
            )
        """, (source_id, max_unread))

        # 2. Kärbi loetud uudised (kuni 100 viimast allika kohta)
        cursor.execute("""
            DELETE FROM articles
            WHERE id IN (
                SELECT id FROM articles
                WHERE source_id = ? AND is_read = 1 AND (is_read_later = 0 OR is_read_later IS NULL)
                ORDER BY published_at DESC, id DESC
                LIMIT 100000 OFFSET ?
            )
        """, (source_id, max_read))
    except Exception as e:
        print(f"Hoiatus artiklite kärpimisel: {e}")

def _fetch_source_worker(s):
    """Tõmbab üksiku allika artiklid eraldi lõimes."""
    try:
        items = parser.fetch_articles(s['url'], bool(s['is_rss']))
        return s, items, None
    except Exception as e:
        return s, [], e

def refresh_all_sources(specific_source_id=None, is_new_source=False, user_id=None):
    """
    Käivitab allikate uuendamise ja salvestab uued artiklid andmebaasi.
    Kasutab paralleelset allikate allalaadimist (ThreadPoolExecutor) ja
    andmebaasi hulgilisamist (executemany / batch API), tagades ülikiire toimimise
    ilma ajalõppude või hangumisteta.
    """
    global global_is_refreshing, active_user_refreshes, user_refresh_results, global_refresh_result
    with refresh_lock:
        if user_id:
            active_user_refreshes.add(user_id)
        else:
            if global_is_refreshing:
                print("[Lugeja] Globaalne uuendamine juba käib teises lõimes, vahelejätmine.")
                return 0
            global_is_refreshing = True

    new_articles_count = 0
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if specific_source_id:
            if isinstance(specific_source_id, (list, tuple, set)):
                id_list = [int(sid) for sid in specific_source_id if sid]
                if not id_list:
                    return 0
                placeholders = ','.join(['?'] * len(id_list))
                if user_id:
                    cursor.execute(f"SELECT id, name, url, is_rss FROM sources WHERE id IN ({placeholders}) AND user_id = ?", id_list + [user_id])
                else:
                    cursor.execute(f"SELECT id, name, url, is_rss FROM sources WHERE id IN ({placeholders})", id_list)
            else:
                if user_id:
                    cursor.execute("SELECT id, name, url, is_rss FROM sources WHERE id = ? AND user_id = ?", (specific_source_id, user_id))
                else:
                    cursor.execute("SELECT id, name, url, is_rss FROM sources WHERE id = ?", (specific_source_id,))
        elif user_id:
            cursor.execute("SELECT id, name, url, is_rss FROM sources WHERE user_id = ?", (user_id,))
        else:
            cursor.execute("SELECT id, name, url, is_rss FROM sources")
        
        sources = cursor.fetchall()
        if not sources:
            return 0

        now_str = datetime.now(TALLINN_TZ).strftime("%Y-%m-%d %H:%M:%S")

        # Paralleelne uudiste tõmbamine välisveebidest (kõik allikad korraga paralleelselt, kuni 12 lõime)
        max_threads = min(len(sources), 12)
        if max_threads > 1:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=max_threads) as executor:
                fetched_results = list(executor.map(_fetch_source_worker, sources))
        else:
            fetched_results = [_fetch_source_worker(s) for s in sources]

        # Küsime kõigi allikate minimaalse avaldamisaja korraga üheainsa koondpäringuga (väldib iga allika eraldi võrgupäringut)
        min_pub_map = {}
        if not is_new_source:
            try:
                if specific_source_id:
                    if isinstance(specific_source_id, (list, tuple, set)):
                        id_list = [int(sid) for sid in specific_source_id if sid]
                        placeholders = ','.join(['?'] * len(id_list))
                        cursor.execute(f"SELECT source_id, MIN(published_at) FROM articles WHERE source_id IN ({placeholders}) GROUP BY source_id", id_list)
                    else:
                        cursor.execute("SELECT source_id, MIN(published_at) FROM articles WHERE source_id = ? GROUP BY source_id", (specific_source_id,))
                else:
                    cursor.execute("SELECT source_id, MIN(published_at) FROM articles GROUP BY source_id")
                for r in cursor.fetchall():
                    min_pub_map[r[0]] = r[1]
            except Exception as min_err:
                print(f"Hoiatus min_pub pärimisel: {min_err}")

        # Kogume kõigi allikate uued artiklid ühte nimekirja
        all_rows_to_insert = []
        sources_with_new_articles = set()

        for s, items, fetch_err in fetched_results:
            source_id = s['id']
            if fetch_err:
                print(f"Viga allika uuendamisel ({s['name']}): {fetch_err}")
                continue

            try:
                # Deduplikeeri URL järgi
                seen_urls = set()
                unique_items = []
                for item in items:
                    u = item.get('url', '').strip()
                    if u and u not in seen_urls:
                        seen_urls.add(u)
                        unique_items.append(item)
                items = unique_items

                # Sorteeri avaldamisaja järgi kahanevalt (kõige uuemad ees)
                items.sort(key=lambda x: x.get('published_at') or '', reverse=True)

                if is_new_source:
                    top_items = items[:20]
                    for it in top_items:
                        all_rows_to_insert.append((source_id, it['title'], it['url'], it.get('image_url'), it['published_at']))
                    if top_items:
                        sources_with_new_articles.add(source_id)
                else:
                    min_pub = min_pub_map.get(source_id)
                    if min_pub is None:
                        # Kui allikal pole veel andmebaasis ühtegi artiklit, piirame samuti 20 viimase uudisega
                        top_items = items[:20]
                        for it in top_items:
                            all_rows_to_insert.append((source_id, it['title'], it['url'], it.get('image_url'), it['published_at']))
                        if top_items:
                            sources_with_new_articles.add(source_id)
                    else:
                        added_for_source = 0
                        for it in items:
                            if min_pub and it.get('published_at') and it['published_at'] < min_pub:
                                continue
                            all_rows_to_insert.append((source_id, it['title'], it['url'], it.get('image_url'), it['published_at']))
                            added_for_source += 1
                        if added_for_source > 0:
                            sources_with_new_articles.add(source_id)
            except Exception as src_err:
                print(f"Viga allika andmete ettevalmistamisel ({s['name']}): {src_err}")

        # Salvestame kõikide allikate uued artiklid andmebaasi korraga
        if all_rows_to_insert:
            insert_sql = """
                INSERT OR IGNORE INTO articles (source_id, title, url, image_url, published_at, is_read)
                VALUES (?, ?, ?, ?, ?, 0)
            """
            if IS_TURSO:
                cursor.executemany(insert_sql, all_rows_to_insert)
                if cursor.rowcount and cursor.rowcount > 0:
                    new_articles_count += cursor.rowcount
            else:
                before_changes = conn.total_changes
                cursor.executemany(insert_sql, all_rows_to_insert)
                new_articles_count += (conn.total_changes - before_changes)

        # Kärbime vanu artikleid ainult nendes allikates, kuhu reaalselt lisandus uusi lugusid
        sources_to_prune = [s for s in sources if s['id'] in sources_with_new_articles]
        for s in sources_to_prune:
            prune_unread_articles(cursor, s['id'], max_unread=500, max_read=100)

        # Uuendame allikate viimase pärimise aja üheainsa päringuga
        if specific_source_id:
            if isinstance(specific_source_id, (list, tuple, set)):
                id_list = [int(sid) for sid in specific_source_id if sid]
                placeholders = ','.join(['?'] * len(id_list))
                cursor.execute(f"UPDATE sources SET last_polled_at = ? WHERE id IN ({placeholders})", [now_str] + id_list)
            else:
                cursor.execute("UPDATE sources SET last_polled_at = ? WHERE id = ?", (now_str, specific_source_id))
        elif user_id:
            cursor.execute("UPDATE sources SET last_polled_at = ? WHERE user_id = ?", (now_str, user_id))
        else:
            cursor.execute("UPDATE sources SET last_polled_at = ?", (now_str,))

        conn.commit()
        conn.close()
        conn = None

        res_info = {
            'completed_at': datetime.now().isoformat(),
            'new_articles': new_articles_count,
            'error': None
        }
        if user_id:
            user_refresh_results[user_id] = res_info
        else:
            global_refresh_result = res_info
    except Exception as e:
        print(f"Viga refresh_all_sources täitmisel: {e}")
        err_info = {
            'completed_at': datetime.now().isoformat(),
            'new_articles': 0,
            'error': str(e)
        }
        if user_id:
            user_refresh_results[user_id] = err_info
        else:
            global_refresh_result = err_info
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        with refresh_lock:
            if user_id:
                active_user_refreshes.discard(user_id)
            else:
                global_is_refreshing = False

    return new_articles_count

def background_scheduler():
    """
    Automaatne taustauuenduse lõim (iga 30 minuti ehk 1800 sekundi järel).
    """
    # Teeme alguses väikese viitega esimese uuenduse
    time.sleep(2)
    refresh_all_sources()
    
    while True:
        time.sleep(1800)
        try:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Automaatne taustauuendus käivitus...")
            refresh_all_sources()
        except Exception as e:
            print("Viga taustauuenduses:", e)

# Marsruudid

@app.route('/')
def index():
    reset_token = request.args.get('token', '').strip() or None
    user = get_current_user()
    user_initial = (user['username'][:1].upper() if user and user.get('username') else None)
    has_users = True
    if not user:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        row = cursor.fetchone()
        has_users = bool(row[0] > 0) if row else False
        conn.close()
    return render_template('index.html', user=user, user_initial=user_initial, has_users=has_users, reset_token=reset_token)

@app.route('/reset-password')
def reset_password_page():
    reset_token = request.args.get('token', '').strip() or None
    user = get_current_user()
    user_initial = (user['username'][:1].upper() if user and user.get('username') else None)
    has_users = True
    if not user:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        row = cursor.fetchone()
        has_users = bool(row[0] > 0) if row else False
        conn.close()
    return render_template('index.html', user=user, user_initial=user_initial, has_users=has_users, reset_token=reset_token)

@app.route('/manifest.json')
def manifest():
    response = make_response(send_from_directory('static', 'manifest.json'))
    response.headers['Content-Type'] = 'application/manifest+json'
    return response

@app.route('/sw.js')
def service_worker():
    response = make_response(send_from_directory('static', 'sw.js'))
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "img-src 'self' data: https: http:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "connect-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "manifest-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self';"
    )
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# ==============================================================================
# Autentimise marsruudid (Auth API)
# ==============================================================================

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM users")
    row = cursor.fetchone()
    user_count = row[0] if row else 0
    conn.close()

    user = get_current_user()
    if not user:
        return jsonify({
            'authenticated': False,
            'user': None,
            'has_users': user_count > 0,
            'user_count': user_count
        })
    return jsonify({
        'authenticated': True,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user.get('email'),
            'is_admin': bool(user['is_admin']),
            'created_at': user.get('created_at')
        },
        'has_users': user_count > 0,
        'user_count': user_count
    })

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip, 'register', max_requests=10, window_seconds=60):
        return jsonify({'error': 'Liiga palju registreerimiskatseid! Palun oota minut aega.'}), 429

    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    raw_email = (data.get('email') or '').strip()
    email_val = raw_email if raw_email else None

    if not username or len(username) < 3:
        return jsonify({'error': 'Kasutajanimi peab olema vähemalt 3 tähemärki pikk!'}), 400
    if len(username) > 50:
        return jsonify({'error': 'Kasutajanimi ei tohi olla pikem kui 50 tähemärki!'}), 400
    if not re.match(r'^[a-zA-Z0-9_\-\.]{3,50}$', username):
        return jsonify({'error': 'Kasutajanimi tohib sisaldada ainult tähti, numbreid, alakriipsu, sidekriipsu ja punkti (3-50 märki)!'}), 400
    if not password or len(password) < 8:
        return jsonify({'error': 'Salasõna peab olema vähemalt 8 tähemärki pikk!'}), 400
    if email_val and not is_valid_email(email_val):
        return jsonify({'error': 'Vigane e-posti aadressi formaat!'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    # Kontrolli, kas kasutajanimi on juba olemas
    cursor.execute("SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Sellise nimega kasutaja on juba olemas!'}), 400

    # Kontrolli, kas e-post on juba olemas
    if email_val:
        cursor.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE", (email_val,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Sellise e-posti aadressiga kasutaja on juba olemas!'}), 400

    # Kontrolli, kas tegemist on esimese registreeritud kasutajaga (Admin)
    cursor.execute("SELECT COUNT(*) FROM users")
    row = cursor.fetchone()
    user_count = row[0] if row else 0
    is_admin = 1 if user_count == 0 else 0

    password_hash = generate_password_hash(password)

    try:
        cursor.execute("""
            INSERT INTO users (username, password_hash, is_admin, email)
            VALUES (?, ?, ?, ?)
            RETURNING id, created_at
        """, (username, password_hash, is_admin, email_val))
        ret_row = cursor.fetchone()
        user_id = ret_row[0] if ret_row else cursor.lastrowid
        created_at = ret_row['created_at'] if ret_row and 'created_at' in ret_row.keys() else datetime.now().isoformat()
        conn.commit()
    except Exception as e:
        conn.close()
        app.logger.error(f"Konto loomisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Konto loomisel tekkis viga. Palun proovi hiljem uuesti.'}), 500

    conn.close()

    # Seadistame püsiva sessiooni ja parooli versiooni
    session.clear()
    session.permanent = True
    session['user_id'] = user_id
    session['username'] = username
    session['pwd_version'] = get_pwd_version(password_hash)

    return jsonify({
        'success': True,
        'user': {
            'id': user_id,
            'username': username,
            'email': email_val,
            'is_admin': bool(is_admin),
            'created_at': created_at
        }
    }), 201

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip, 'login', max_requests=10, window_seconds=60):
        return jsonify({'error': 'Liiga palju sisselogimiskatseid! Palun oota minut aega.'}), 429

    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    if not username or not password:
        return jsonify({'error': 'Kasutajanimi ja salasõna on kohustuslikud!'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, password_hash, is_admin, created_at FROM users WHERE username = ? COLLATE NOCASE", (username,))
    user = cursor.fetchone()
    conn.close()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Vale kasutajanimi või salasõna!'}), 401

    session.clear()
    session.permanent = True
    session['user_id'] = user['id']
    session['username'] = user['username']
    session['pwd_version'] = get_pwd_version(user['password_hash'])

    return jsonify({
        'success': True,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user['email'],
            'is_admin': bool(user['is_admin']),
            'created_at': user['created_at']
        }
    })

@app.route('/api/auth/forgot-password', methods=['POST'])
def auth_forgot_password():
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip, 'forgot-password', max_requests=5, window_seconds=60):
        return jsonify({'error': 'Liiga palju taotlusi! Palun oota minut enne uue lingi küsimist.'}), 429

    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or '').strip()

    if not identifier:
        return jsonify({'error': 'Palun sisesta kasutajanimi või e-posti aadress!'}), 400

    generic_msg = 'Kui sisestatud kasutajanimi või e-post on süsteemis olemas ning kontoga on seotud e-posti aadress, saadeti taastamislink.'

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, email FROM users
        WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
        LIMIT 1
    """, (identifier, identifier))
    user = cursor.fetchone()

    if not user or not user['email']:
        conn.close()
        # Turvakaalutlustel ei avalikustata, kas konto eksisteerib või kas email on seadistatud
        return jsonify({'success': True, 'message': generic_msg})

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    expires_at = (datetime.now() + timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')

    try:
        cursor.execute("""
            INSERT INTO password_resets (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
        """, (user['id'], token_hash, expires_at))
        conn.commit()
    except Exception as e:
        conn.close()
        app.logger.error(f"Taastamiskoodi salvestamisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Taastamiskoodi salvestamisel tekkis viga. Palun proovi hiljem uuesti.'}), 500

    conn.close()

    trusted_base_url = get_trusted_base_url()
    reset_url = f"{trusted_base_url}/reset-password?token={raw_token}"
    send_password_reset_email(user['email'], reset_url, username=user['username'])

    return jsonify({'success': True, 'message': generic_msg})

@app.route('/api/auth/reset-password', methods=['POST'])
def auth_reset_password():
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip, 'reset-password', max_requests=10, window_seconds=60):
        return jsonify({'error': 'Liiga palju katseid! Palun oota minut aega.'}), 429

    data = request.get_json(silent=True) or {}
    raw_token = (data.get('token') or '').strip()
    new_password = (data.get('new_password') or '').strip()

    if not raw_token:
        return jsonify({'error': 'Taastamiskood (token) puudub!'}), 400

    if not new_password or len(new_password) < 8:
        return jsonify({'error': 'Uus salasõna peab olema vähemalt 8 tähemärki pikk!'}), 400

    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    now_dt = datetime.now()
    now_str = now_dt.strftime('%Y-%m-%d %H:%M:%S')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, user_id, expires_at, used_at FROM password_resets
        WHERE token_hash = ?
        ORDER BY id DESC LIMIT 1
    """, (token_hash,))
    reset_row = cursor.fetchone()

    if not reset_row:
        conn.close()
        return jsonify({'error': 'Taastamislink on kehtetu või seda pole leitud.'}), 400

    if reset_row['used_at'] is not None:
        conn.close()
        return jsonify({'error': 'Seda taastamislinki on juba kasutatud!'}), 400

    expires_at_val = reset_row['expires_at']
    is_expired = False
    try:
        exp_str = str(expires_at_val).replace('Z', '').split('.')[0]
        exp_dt = datetime.fromisoformat(exp_str) if 'T' in exp_str else datetime.strptime(exp_str, '%Y-%m-%d %H:%M:%S')
        if now_dt > exp_dt:
            is_expired = True
    except Exception:
        if str(expires_at_val) < now_str:
            is_expired = True

    if is_expired:
        conn.close()
        return jsonify({'error': 'Taastamislink on aegunud (kehtivusaeg 1 tund). Palun taotle uus link.'}), 400

    user_id = reset_row['user_id']
    new_password_hash = generate_password_hash(new_password)

    try:
        cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_password_hash, user_id))
        cursor.execute("UPDATE password_resets SET used_at = ? WHERE id = ?", (now_str, reset_row['id']))
        conn.commit()
    except Exception as e:
        conn.close()
        app.logger.error(f"Parooli muutmisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Parooli muutmisel tekkis viga. Palun proovi hiljem uuesti.'}), 500

    conn.close()

    # Kui praegune seanss oli selle kasutaja oma, uuendame pwd_versionit
    if session.get('user_id') == user_id:
        session['pwd_version'] = get_pwd_version(new_password_hash)

    return jsonify({
        'success': True,
        'message': 'Parool on edukalt uuendatud! Saad nüüd uue parooliga sisse logida.'
    })

@app.route('/api/user/email', methods=['PUT'])
@login_required
def update_user_email(current_user):
    data = request.get_json(silent=True) or {}
    raw_email = (data.get('email') or '').strip()

    if raw_email and not is_valid_email(raw_email):
        return jsonify({'error': 'Vigane e-posti aadressi formaat!'}), 400

    email_val = raw_email if raw_email else None

    conn = get_db_connection()
    cursor = conn.cursor()

    if email_val:
        cursor.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?", (email_val, current_user['id']))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': 'See e-posti aadress on juba teise kasutaja poolt kasutusel!'}), 400

    try:
        cursor.execute("UPDATE users SET email = ? WHERE id = ?", (email_val, current_user['id']))
        conn.commit()
    except Exception as e:
        conn.close()
        app.logger.error(f"E-posti salvestamisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'E-posti salvestamisel tekkis viga. Palun proovi hiljem uuesti.'}), 500

    conn.close()
    return jsonify({'success': True, 'email': email_val})

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/auth/delete-account', methods=['POST'])
@login_required
def auth_delete_account(current_user):
    if current_user['is_admin']:
        return jsonify({'error': 'Peakasutaja (admin) kontot ei saa kustutada!'}), 403

    user_id = current_user['id']
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        if hasattr(conn, 'execute_transaction'):
            conn.execute_transaction([
                ("DELETE FROM articles WHERE source_id IN (SELECT id FROM sources WHERE user_id = ?)", (user_id,)),
                ("DELETE FROM sources WHERE user_id = ?", (user_id,)),
                ("DELETE FROM categories WHERE user_id = ?", (user_id,)),
                ("DELETE FROM password_resets WHERE user_id = ?", (user_id,)),
                ("DELETE FROM users WHERE id = ?", (user_id,))
            ])
        else:
            # Kustutame kasutaja artiklid (kaskaadselt)
            cursor.execute("DELETE FROM articles WHERE source_id IN (SELECT id FROM sources WHERE user_id = ?)", (user_id,))
            # Kustutame kasutaja allikad
            cursor.execute("DELETE FROM sources WHERE user_id = ?", (user_id,))
            # Kustutame kasutaja kategooriad
            cursor.execute("DELETE FROM categories WHERE user_id = ?", (user_id,))
            # Kustutame kasutaja paroolitaastamised
            cursor.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
            # Kustutame kasutaja kirje
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
    except Exception as e:
        conn.close()
        app.logger.error(f"Konto kustutamisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Konto kustutamisel tekkis viga. Palun proovi hiljem uuesti.'}), 500

    conn.close()
    session.clear()

    # Kontrollime järelejäänud kasutajate arvu
    conn2 = get_db_connection()
    cur2 = conn2.cursor()
    cur2.execute("SELECT COUNT(*) FROM users")
    row = cur2.fetchone()
    remaining_users = row[0] if row else 0
    conn2.close()

    return jsonify({
        'success': True,
        'message': 'Konto ja kõik sellega seonduvad andmed on kustutatud.',
        'has_users': remaining_users > 0,
        'user_count': remaining_users
    })

@app.route('/api/user/stats', methods=['GET'])
@login_required
def get_user_stats(current_user):
    user_id = current_user['id']
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Konto vanus
    created_at_val = current_user.get('created_at')
    account_age_days = 0
    account_age_text = "Täna liitunud"
    if created_at_val:
        try:
            s = str(created_at_val).replace('Z', '').split('.')[0]
            if 'T' in s:
                dt = datetime.fromisoformat(s)
            else:
                dt = datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
            if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            delta = datetime.now() - dt
            account_age_days = max(0, delta.days)
            if account_age_days == 0:
                account_age_text = "Täna liitunud"
            elif account_age_days == 1:
                account_age_text = "1 päev"
            elif account_age_days < 30:
                account_age_text = f"{account_age_days} päeva"
            elif account_age_days < 365:
                months = account_age_days // 30
                rem = account_age_days % 30
                account_age_text = f"{months} k {rem} p" if rem > 0 else f"{months} kuud"
            else:
                years = account_age_days // 365
                account_age_text = f"{years} a" if years == 1 else f"{years} aastat"
        except Exception as e:
            print(f"Hoiatus konto vanuse arvutamisel: {e}")

    # 2. Loetud uudised (avatud lood, millel kasutaja on eraldi klikkinud)
    cursor.execute("""
        SELECT COUNT(*) FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE s.user_id = ? AND a.is_opened = 1
    """, (user_id,))
    opened_count = cursor.fetchone()[0] or 0

    # 3. Läbi sirvitud (voos loetuks märgitud / mööda keritud)
    cursor.execute("""
        SELECT COUNT(*) FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE s.user_id = ? AND a.is_read = 1
    """, (user_id,))
    scrolled_read_count = cursor.fetchone()[0] or 0

    # 4. Artikleid kokku
    cursor.execute("""
        SELECT COUNT(*) FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE s.user_id = ?
    """, (user_id,))
    total_articles = cursor.fetchone()[0] or 0

    # Lugemise määr (%)
    read_rate_percent = round((opened_count / total_articles * 100), 1) if total_articles > 0 else 0.0

    # 5. Tellitud allikad ja kategooriad
    cursor.execute("SELECT COUNT(*) FROM sources WHERE user_id = ?", (user_id,))
    sources_count = cursor.fetchone()[0] or 0

    cursor.execute("SELECT COUNT(*) FROM categories WHERE user_id = ?", (user_id,))
    categories_count = cursor.fetchone()[0] or 0

    # 6. Kõige aktiivsem allikas (kust tuleb voogu enim uudiseid)
    cursor.execute("""
        SELECT s.name, COUNT(a.id) as art_count
        FROM sources s
        LEFT JOIN articles a ON a.source_id = s.id
        WHERE s.user_id = ?
        GROUP BY s.id, s.name
        ORDER BY art_count DESC, s.name COLLATE NOCASE ASC
        LIMIT 1
    """, (user_id,))
    active_row = cursor.fetchone()
    most_active_source = {
        'name': active_row[0] if active_row and active_row[0] else "Puudub",
        'count': active_row[1] if active_row else 0
    }

    # 7. Lemmikallikas / Enim loetud allikas (kust on enim avatud lugusid; varulahendusena enim läbi sirvitud)
    cursor.execute("""
        SELECT s.name, COUNT(a.id) as op_count
        FROM sources s
        JOIN articles a ON a.source_id = s.id
        WHERE s.user_id = ? AND a.is_opened = 1
        GROUP BY s.id, s.name
        ORDER BY op_count DESC, s.name COLLATE NOCASE ASC
        LIMIT 1
    """, (user_id,))
    fav_row = cursor.fetchone()
    if fav_row and fav_row[1] > 0:
        favorite_source = {
            'name': fav_row[0],
            'count': fav_row[1],
            'type': 'opened'
        }
    else:
        cursor.execute("""
            SELECT s.name, COUNT(a.id) as rd_count
            FROM sources s
            JOIN articles a ON a.source_id = s.id
            WHERE s.user_id = ? AND a.is_read = 1
            GROUP BY s.id, s.name
            ORDER BY rd_count DESC, s.name COLLATE NOCASE ASC
            LIMIT 1
        """, (user_id,))
        fav_read_row = cursor.fetchone()
        if fav_read_row and fav_read_row[1] > 0:
            favorite_source = {
                'name': fav_read_row[0],
                'count': fav_read_row[1],
                'type': 'read'
            }
        else:
            favorite_source = {
                'name': most_active_source['name'] if sources_count > 0 else "Puudub",
                'count': 0,
                'type': 'none'
            }

    # 8. Seadmete kasutus (Mobiil vs Arvuti)
    cursor.execute("SELECT device_mobile_count, device_desktop_count FROM users WHERE id = ?", (user_id,))
    dev_row = cursor.fetchone()
    mobile_count = (dev_row[0] if dev_row and dev_row[0] is not None else 0) or 0
    desktop_count = (dev_row[1] if dev_row and dev_row[1] is not None else 0) or 0
    total_dev = mobile_count + desktop_count

    if total_dev > 0:
        mobile_pct = round((mobile_count / total_dev) * 100)
        desktop_pct = 100 - mobile_pct
        if mobile_pct > desktop_pct:
            dominant = 'mobile'
        elif desktop_pct > mobile_pct:
            dominant = 'desktop'
        else:
            dominant = 'equal'
    else:
        mobile_pct = 50
        desktop_pct = 50
        dominant = 'equal'

    device_stats = {
        'mobile_count': mobile_count,
        'desktop_count': desktop_count,
        'mobile_percent': mobile_pct,
        'desktop_percent': desktop_pct,
        'dominant': dominant
    }

    conn.close()

    return jsonify({
        'account_age_days': account_age_days,
        'account_age_text': account_age_text,
        'opened_count': opened_count,
        'read_rate_percent': read_rate_percent,
        'scrolled_read_count': scrolled_read_count,
        'total_articles': total_articles,
        'sources_count': sources_count,
        'categories_count': categories_count,
        'most_active_source': most_active_source,
        'favorite_source': favorite_source,
        'device_stats': device_stats
    })

@app.route('/api/user/device', methods=['POST'])
@login_required
def record_user_device(current_user):
    """Salvestab seadme kasutuse (mobiil vs arvuti) kasutajakonto statistikas."""
    data = request.get_json(silent=True) or {}
    device = data.get('device')
    if device not in ('mobile', 'desktop'):
        device = 'mobile' if is_mobile_request(request) else 'desktop'

    col = 'device_mobile_count' if device == 'mobile' else 'device_desktop_count'
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"UPDATE users SET {col} = COALESCE({col}, 0) + 1 WHERE id = ?", (current_user['id'],))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'device': device})


# ==============================================================================
# Kategooriate marsruudid (Categories API)
# ==============================================================================

@app.route('/api/categories', methods=['GET'])
@login_required
def get_categories(current_user):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.id, c.name, c.created_at,
               COUNT(DISTINCT s.id) as source_count,
               COUNT(CASE WHEN a.is_read = 0 THEN 1 END) as unread_count
        FROM categories c
        LEFT JOIN sources s ON c.id = s.category_id AND s.user_id = ?
        LEFT JOIN articles a ON s.id = a.source_id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE ASC
    """, (current_user['id'], current_user['id']))
    rows = cursor.fetchall()
    categories = [dict(r) for r in rows]
    conn.close()
    return jsonify({'categories': categories})

@app.route('/api/categories', methods=['POST'])
@login_required
def add_category(current_user):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Kategooria nimi on kohustuslik!'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO categories (user_id, name) VALUES (?, ?) RETURNING id", (current_user['id'], name))
        ret_row = cursor.fetchone()
        category_id = ret_row[0] if ret_row else cursor.lastrowid
        conn.commit()
    except Exception as e:
        conn.close()
        err_str = str(e).lower()
        if 'unique' in err_str or 'already exists' in err_str:
            return jsonify({'error': 'Sellise nimega kategooria on juba olemas!'}), 400
        app.logger.error(f"Kategooria lisamisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Kategooria lisamine ebaõnnestus. Palun proovi hiljem uuesti.'}), 500

    conn.close()
    return jsonify({
        'success': True,
        'category': {
            'id': category_id,
            'name': name
        }
    }), 201

@app.route('/api/categories/<int:category_id>', methods=['PUT'])
@login_required
def update_category(current_user, category_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Kategooria nimi on kohustuslik!'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE categories SET name = ? WHERE id = ? AND user_id = ?", (name, category_id, current_user['id']))
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Kategooriat ei leitud'}), 404
        conn.commit()
    except Exception as e:
        conn.close()
        err_str = str(e).lower()
        if 'unique' in err_str or 'already exists' in err_str:
            return jsonify({'error': 'Sellise nimega kategooria on juba olemas!'}), 400
        app.logger.error(f"Kategooria uuendamisel tekkis viga: {e}", exc_info=True)
        return jsonify({'error': 'Kategooria uuendamine ebaõnnestus. Palun proovi hiljem uuesti.'}), 500

    conn.close()
    return jsonify({
        'success': True,
        'category': {
            'id': category_id,
            'name': name
        }
    })

@app.route('/api/categories/<int:category_id>', methods=['DELETE'])
@login_required
def delete_category(current_user, category_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE sources SET category_id = NULL WHERE category_id = ? AND user_id = ?", (category_id, current_user['id']))
    except Exception:
        pass
    cursor.execute("DELETE FROM categories WHERE id = ? AND user_id = ?", (category_id, current_user['id']))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

# ==============================================================================
# Allikate marsruudid (Sources API)
# ==============================================================================

@app.route('/api/sources', methods=['GET'])
@login_required
def get_sources(current_user):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.name, s.url, s.is_rss, s.logo_url, s.last_polled_at, s.category_id,
               c.name as category_name,
               COUNT(CASE WHEN a.is_read = 0 THEN 1 END) as unread_count,
               COUNT(a.id) as total_count
        FROM sources s
        LEFT JOIN categories c ON s.category_id = c.id
        LEFT JOIN articles a ON s.id = a.source_id
        WHERE s.user_id = ?
        GROUP BY s.id
        ORDER BY s.name COLLATE NOCASE ASC
    """, (current_user['id'],))
    rows = cursor.fetchall()
    sources = [dict(r) for r in rows]

    cursor.execute("""
        SELECT COUNT(*)
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE s.user_id = ? AND a.is_read_later = 1
    """, (current_user['id'],))
    rl_row = cursor.fetchone()
    read_later_count = rl_row[0] if rl_row else 0

    conn.close()
    is_user_refreshing = (current_user['id'] in active_user_refreshes) or global_is_refreshing
    return jsonify({
        'sources': sources,
        'read_later_count': read_later_count,
        'is_refreshing': is_user_refreshing
    })

@app.route('/api/sources', methods=['POST'])
@login_required
def add_source(current_user):
    data = request.get_json(silent=True) or {}
    url = data.get('url', '').strip()
    name = data.get('name', '').strip()
    logo_url = data.get('logo_url', '').strip()
    category_id_raw = data.get('category_id')
    category_id = None
    if category_id_raw is not None and str(category_id_raw).strip() != '':
        try:
            category_id = int(category_id_raw)
        except (ValueError, TypeError):
            category_id = None

    if not url:
        return jsonify({'error': 'URL on kohustuslik!'}), 400

    if not parser.is_safe_url(url):
        return jsonify({'error': 'Lubamatu või sisevõrgu veebiaadress!'}), 400

    # Kui kategooria on määratud, veendu et see kuulub sellele kasutajale
    if category_id is not None:
        conn_cat = get_db_connection()
        cur_cat = conn_cat.cursor()
        cur_cat.execute("SELECT id FROM categories WHERE id = ? AND user_id = ?", (category_id, current_user['id']))
        cat_found = cur_cat.fetchone()
        conn_cat.close()
        if not cat_found:
            category_id = None

    # Tuvasta allika omadused turvaliselt
    try:
        meta = parser.discover_source(url)
    except Exception as disc_err:
        print(f"Hoiatus parser.discover_source ebaõnnestus: {disc_err}")
        from urllib.parse import urlparse
        parsed = urlparse(url if url.startswith(('http://', 'https://')) else 'https://' + url)
        domain = parsed.netloc.replace('www.', '')
        name_parts = domain.split('.')
        default_name = name_parts[0].capitalize() if name_parts else domain
        meta = {
            'name': default_name,
            'url': url if url.startswith(('http://', 'https://')) else 'https://' + url,
            'is_rss': False,
            'logo_url': f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
        }

    final_name = name if name else (meta.get('name') or url)
    final_url = meta.get('url') or url
    final_logo = logo_url if logo_url else meta.get('logo_url')
    is_rss = 1 if meta.get('is_rss') else 0

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO sources (user_id, name, url, is_rss, logo_url, category_id)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
        """, (current_user['id'], final_name, final_url, is_rss, final_logo, category_id))
        ret_row = cursor.fetchone()
        source_id = ret_row[0] if ret_row else cursor.lastrowid
        conn.commit()
    except Exception as e:
        conn.close()
        err_str = str(e).lower()
        if 'unique' in err_str or 'already exists' in err_str:
            return jsonify({'error': 'See allikas või URL on juba lisatud!'}), 400
        app.logger.error(f"Viga allika lisamisel andmebaasi: {e}", exc_info=True)
        return jsonify({'error': 'Allika salvestamine ebaõnnestus. Palun proovi hiljem uuesti.'}), 500

    conn.close()

    # Tõmba kohe selle allika artiklid (20 viimast uudist)
    try:
        refresh_all_sources(source_id, is_new_source=True, user_id=current_user['id'])
    except Exception as ref_err:
        print(f"Hoiatus allika esmasel värskendamisel: {ref_err}")

    return jsonify({
        'success': True,
        'source': {
            'id': source_id,
            'name': final_name,
            'url': final_url,
            'is_rss': is_rss,
            'logo_url': final_logo,
            'category_id': category_id
        }
    }), 201

@app.route('/api/sources/<int:source_id>', methods=['PUT'])
@login_required
def update_source(current_user, source_id):
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    category_id_raw = data.get('category_id')
    category_id = None
    if category_id_raw is not None and str(category_id_raw).strip() != '':
        try:
            category_id = int(category_id_raw)
        except (ValueError, TypeError):
            category_id = None

    if not name or not url:
        return jsonify({'error': 'Nimi ja veebiaadress on kohustuslikud!'}), 400

    if not parser.is_safe_url(url):
        return jsonify({'error': 'Lubamatu või sisevõrgu veebiaadress!'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, name, url, is_rss, logo_url, category_id FROM sources WHERE id = ? AND user_id = ?", (source_id, current_user['id']))
    source = cursor.fetchone()
    if not source:
        conn.close()
        return jsonify({'error': 'Allikat ei leitud'}), 404

    # Kui kategooria on määratud, veendu et see kuulub sellele kasutajale
    if category_id is not None:
        cursor.execute("SELECT id FROM categories WHERE id = ? AND user_id = ?", (category_id, current_user['id']))
        if not cursor.fetchone():
            category_id = None

    url_changed = (url != source['url'])
    is_rss = source['is_rss']
    final_logo = source['logo_url']

    if url_changed:
        try:
            meta = parser.discover_source(url)
            url = meta['url']
            is_rss = 1 if meta['is_rss'] else 0
            if meta.get('logo_url'):
                final_logo = meta['logo_url']
        except Exception:
            pass

    try:
        cursor.execute("""
            UPDATE sources
            SET name = ?, url = ?, is_rss = ?, logo_url = ?, category_id = ?
            WHERE id = ? AND user_id = ?
        """, (name, url, is_rss, final_logo, category_id, source_id, current_user['id']))
        conn.commit()
    except Exception as e:
        conn.close()
        err_str = str(e).lower()
        if 'unique' in err_str:
            return jsonify({'error': 'See veebiaadress on juba teise allika poolt kasutusel!'}), 400
        app.logger.error(f"Viga allika uuendamisel: {e}", exc_info=True)
        return jsonify({'error': 'Allika uuendamine ebaõnnestus. Palun proovi hiljem uuesti.'}), 500

    conn.close()

    # Kui URL muutus, värskenda uudiseid taustal
    if url_changed:
        thread = threading.Thread(target=refresh_all_sources, args=(source_id, True, current_user['id']))
        thread.daemon = True
        thread.start()

    return jsonify({
        'success': True,
        'source': {
            'id': source_id,
            'name': name,
            'url': url,
            'is_rss': is_rss,
            'logo_url': final_logo,
            'category_id': category_id
        }
    })

@app.route('/api/sources/<int:source_id>', methods=['DELETE'])
@login_required
def delete_source(current_user, source_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM sources WHERE id = ? AND user_id = ?", (source_id, current_user['id']))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Allikat ei leitud'}), 404

    try:
        cursor.execute("DELETE FROM articles WHERE source_id = ?", (source_id,))
    except Exception:
        pass
    cursor.execute("DELETE FROM sources WHERE id = ? AND user_id = ?", (source_id, current_user['id']))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

# ==============================================================================
# OPML eksport
# ==============================================================================

@app.route('/api/export/opml', methods=['GET'])
@login_required
def export_opml(current_user):
    """Ekspordib kasutaja uudisteallikad standardse OPML 2.0 XML failina koos kategooriatega."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.name, s.url, s.is_rss, s.category_id, c.name as category_name
        FROM sources s
        LEFT JOIN categories c ON s.category_id = c.id
        WHERE s.user_id = ?
        ORDER BY c.name COLLATE NOCASE ASC, s.name COLLATE NOCASE ASC
    """, (current_user['id'],))
    rows = cursor.fetchall()
    sources = [dict(r) for r in rows]
    conn.close()

    import xml.etree.ElementTree as ET
    from datetime import datetime, timezone
    from email.utils import format_datetime
    from urllib.parse import urlparse

    opml = ET.Element('opml', version='2.0')
    head = ET.SubElement(opml, 'head')

    title_el = ET.SubElement(head, 'title')
    title_el.text = f'Lugeja tellimused - {current_user["username"]}'

    date_created = ET.SubElement(head, 'dateCreated')
    date_created.text = format_datetime(datetime.now(timezone.utc))

    docs_el = ET.SubElement(head, 'docs')
    docs_el.text = 'http://opml.org/spec2.opml'

    body = ET.SubElement(opml, 'body')

    # Grupeerime kategooriate kaupa
    categories_dict = {}
    uncategorized = []

    for s in sources:
        cat_name = s.get('category_name')
        if cat_name:
            if cat_name not in categories_dict:
                categories_dict[cat_name] = []
            categories_dict[cat_name].append(s)
        else:
            uncategorized.append(s)

    def add_outline(parent, s):
        name = (s.get('name') or '').strip() or 'Nimetu allikas'
        url = (s.get('url') or '').strip()
        parsed = urlparse(url)
        html_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else url
        ET.SubElement(parent, 'outline', {
            'text': name,
            'title': name,
            'type': 'rss',
            'xmlUrl': url,
            'htmlUrl': html_url
        })

    for cat_name, cat_sources in categories_dict.items():
        cat_outline = ET.SubElement(body, 'outline', {
            'text': cat_name,
            'title': cat_name
        })
        for s in cat_sources:
            add_outline(cat_outline, s)

    for s in uncategorized:
        add_outline(body, s)

    if hasattr(ET, 'indent'):
        ET.indent(opml, space='  ')

    xml_bytes = ET.tostring(opml, encoding='utf-8', xml_declaration=True)

    return Response(
        xml_bytes,
        mimetype='text/x-opml',
        headers={
            'Content-Disposition': 'attachment; filename="lugeja_tellimused.opml"',
            'Content-Type': 'text/x-opml; charset=utf-8'
        }
    )

def extract_opml_feeds(element, current_category=None):
    """Parsib OPML puust rekursiivselt välja uudisteallikad ja nende kategooriad."""
    feeds = []
    for child in element:
        tag = child.tag.split('}')[-1].lower() if '}' in child.tag else child.tag.lower()
        if tag == 'outline':
            attrs = {k.lower(): v for k, v in child.attrib.items()}
            xml_url = (attrs.get('xmlurl') or attrs.get('url') or '').strip()
            html_url = (attrs.get('htmlurl') or '').strip()
            feed_type = (attrs.get('type') or '').lower()
            name = (attrs.get('text') or attrs.get('title') or '').strip()

            child_outlines = [c for c in child if (c.tag.split('}')[-1].lower() if '}' in c.tag else c.tag.lower()) == 'outline']

            if xml_url:
                feeds.append({
                    'name': name or html_url or xml_url,
                    'url': xml_url,
                    'html_url': html_url,
                    'category': current_category
                })
            elif feed_type in ('rss', 'atom') and html_url:
                feeds.append({
                    'name': name or html_url,
                    'url': html_url,
                    'html_url': html_url,
                    'category': current_category
                })

            if child_outlines:
                cat_name = name if name else current_category
                feeds.extend(extract_opml_feeds(child, current_category=cat_name))
        elif tag in ('body', 'opml'):
            feeds.extend(extract_opml_feeds(child, current_category=current_category))

    return feeds

@app.route('/api/import/opml', methods=['POST'])
@login_required
def import_opml(current_user):
    """Impordib kasutaja uudisteallikad ja kategooriad üleslaaditud OPML failist."""
    if 'file' not in request.files:
        return jsonify({'error': 'Ühtegi faili ei edastatud!'}), 400

    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({'error': 'Ühtegi faili ei valitud!'}), 400

    try:
        file_bytes = file.read()
    except Exception as read_err:
        return jsonify({'error': f'Faili lugemine ebaõnnestus: {str(read_err)}'}), 400

    if not file_bytes:
        return jsonify({'error': 'Valitud fail on tühi!'}), 400

    if len(file_bytes) > 10 * 1024 * 1024:
        return jsonify({'error': 'Fail on liiga suur (maksimaalselt 10 MB)!'}), 400

    # Eemalda võimalik UTF-8 BOM
    if file_bytes.startswith(b'\xef\xbb\xbf'):
        file_bytes = file_bytes[3:]

    # Turvaline XML parsimine (XXE ja Entity Expansion kaitse)
    if b'<!ENTITY' in file_bytes or b'<!DOCTYPE' in file_bytes:
        if b'SYSTEM' in file_bytes or b'PUBLIC' in file_bytes:
            return jsonify({'error': 'OPML fail sisaldab keelatud väliseid olemideklaratsioone!'}), 400

    try:
        try:
            import defusedxml.ElementTree as ET
        except ImportError:
            import xml.etree.ElementTree as ET
        root = ET.fromstring(file_bytes)
    except Exception as e:
        return jsonify({'error': f'Faili parsimine ebaõnnestus: {str(e)}'}), 400

    raw_feeds = extract_opml_feeds(root)
    if not raw_feeds:
        return jsonify({'error': 'OPML failist ei leitud ühtegi uudisteallika (RSS/Atom) voogu!'}), 400

    # Eemalda duplikaadid samast OPML failist
    seen_urls = set()
    feeds = []
    for f in raw_feeds:
        clean_url = (f.get('url') or '').strip()
        if not clean_url:
            continue
        url_lower = clean_url.lower()
        if url_lower not in seen_urls:
            seen_urls.add(url_lower)
            feeds.append(f)

    conn = get_db_connection()
    cursor = conn.cursor()

    # Laadi olemasolevad kategooriad ja allikad
    cursor.execute("SELECT id, name FROM categories WHERE user_id = ?", (current_user['id'],))
    categories_map = {row['name'].strip().lower(): row['id'] for row in cursor.fetchall()}

    cursor.execute("SELECT url FROM sources WHERE user_id = ?", (current_user['id'],))
    existing_urls = {row['url'].strip().lower() for row in cursor.fetchall()}

    from urllib.parse import urlparse

    imported_count = 0
    skipped_count = 0
    categories_created = 0
    new_source_ids = []

    for feed in feeds:
        feed_url = feed['url'].strip()
        if not parser.is_safe_url(feed_url):
            skipped_count += 1
            continue

        url_lower = feed_url.lower()

        if url_lower in existing_urls:
            skipped_count += 1
            continue

        category_id = None
        cat_name = (feed.get('category') or '').strip()
        if cat_name:
            cat_key = cat_name.lower()
            if cat_key in categories_map:
                category_id = categories_map[cat_key]
            else:
                try:
                    cursor.execute("INSERT INTO categories (user_id, name) VALUES (?, ?) RETURNING id", (current_user['id'], cat_name))
                    ret_row = cursor.fetchone()
                    category_id = ret_row[0] if ret_row else cursor.lastrowid
                    categories_map[cat_key] = category_id
                    categories_created += 1
                except Exception as cat_err:
                    print(f"Hoiatus kategooria loomisel OPML impordis: {cat_err}")
                    cursor.execute("SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?)", (current_user['id'], cat_name))
                    found_cat = cursor.fetchone()
                    if found_cat:
                        category_id = found_cat[0]
                        categories_map[cat_key] = category_id

        # Genereeri favicon logo domeeni järgi
        try:
            parsed = urlparse(feed_url if feed_url.startswith(('http://', 'https://')) else 'https://' + feed_url)
            domain = parsed.netloc.replace('www.', '')
            logo_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=64" if domain else ""
        except Exception:
            logo_url = ""

        feed_name = feed.get('name') or feed_url

        try:
            cursor.execute("""
                INSERT INTO sources (user_id, name, url, is_rss, logo_url, category_id)
                VALUES (?, ?, ?, 1, ?, ?)
                RETURNING id
            """, (current_user['id'], feed_name, feed_url, logo_url, category_id))
            ret_row = cursor.fetchone()
            new_source_id = ret_row[0] if ret_row else cursor.lastrowid
            if new_source_id:
                new_source_ids.append(new_source_id)
            existing_urls.add(url_lower)
            imported_count += 1
        except Exception as src_err:
            print(f"Hoiatus allika lisamisel OPML impordis: {src_err}")
            skipped_count += 1

    conn.commit()
    conn.close()

    # Kui imporditi uusi allikaid, käivita taustavärskendus ALATI asünkroonselt
    if new_source_ids:
        try:
            threading.Thread(
                target=refresh_all_sources,
                args=(new_source_ids, True, current_user['id']),
                daemon=True
            ).start()
        except Exception as ref_err:
            print(f"Hoiatus taustavärskenduse käivitamisel pärast OPML importi: {ref_err}")

    msg = f"Imporditi edukalt {imported_count} allikat."
    if skipped_count > 0:
        msg += f" ({skipped_count} oli juba olemas)."
    if categories_created > 0:
        msg += f" Loodi {categories_created} uut kategooriat."

    return jsonify({
        'success': True,
        'imported_count': imported_count,
        'skipped_count': skipped_count,
        'categories_created': categories_created,
        'message': msg
    })


# ==============================================================================
# Artiklite marsruudid (Articles API)
# ==============================================================================

@app.route('/api/articles', methods=['GET'])
@login_required
def get_articles(current_user):
    source_id = request.args.get('source_id', type=int)
    category_id = request.args.get('category_id', type=int)
    include_read = request.args.get('include_read', '0') == '1'
    read_later = request.args.get('read_later', '0') == '1'
    limit_per_source = request.args.get('limit', type=int)

    conn = get_db_connection()
    cursor = conn.cursor()

    # Päringu koostamine kasutaja skoobis
    conditions = ["s.user_id = ?"]
    params = [current_user['id']]

    if read_later:
        conditions.append("a.is_read_later = 1")
    else:
        if not include_read:
            conditions.append("a.is_read = 0")

    if source_id:
        conditions.append("a.source_id = ?")
        params.append(source_id)
    elif category_id:
        conditions.append("s.category_id = ?")
        params.append(category_id)

    where_clause = "WHERE " + " AND ".join(conditions)

    # Kui valida "Kuva ka loetud uudised", näita iga andmeallika kohta maksimaalselt viimased 100 uudist
    max_per_source = limit_per_source if limit_per_source is not None else (100 if (include_read and not read_later) else None)
    if max_per_source is not None:
        max_per_source = max(1, min(max_per_source, 500))

    if max_per_source:
        query = f"""
            SELECT a.id, a.source_id, a.title, a.url, a.image_url, a.published_at, a.is_read, a.is_read_later, a.is_opened,
                   s.name as source_name, s.logo_url as source_logo
            FROM (
                SELECT a2.id, a2.source_id, a2.title, a2.url, a2.image_url, a2.published_at, a2.is_read, a2.is_read_later, a2.is_opened,
                       ROW_NUMBER() OVER (PARTITION BY a2.source_id ORDER BY a2.published_at DESC, a2.id DESC) as rn
                FROM articles a2
                JOIN sources s ON a2.source_id = s.id
                {where_clause.replace('a.', 'a2.')}
            ) a
            JOIN sources s ON a.source_id = s.id
            WHERE a.rn <= ?
            ORDER BY s.name COLLATE NOCASE ASC, a.published_at DESC, a.id DESC
        """
        params.append(max_per_source)
    else:
        # Sorteerituna andmeallika nime ja seejärel avaldamise kuupäeva järgi
        query = f"""
            SELECT a.id, a.source_id, a.title, a.url, a.image_url, a.published_at, a.is_read, a.is_read_later, a.is_opened,
                   s.name as source_name, s.logo_url as source_logo
            FROM articles a
            JOIN sources s ON a.source_id = s.id
            {where_clause}
            ORDER BY s.name COLLATE NOCASE ASC, a.published_at DESC, a.id DESC
        """

    cursor.execute(query, params)
    rows = cursor.fetchall()
    articles = [dict(r) for r in rows]
    conn.close()

    return jsonify({'articles': articles, 'count': len(articles)})

@app.route('/api/articles/<int:article_id>/read-later', methods=['POST'])
@login_required
def toggle_read_later(current_user, article_id):
    data = request.get_json(silent=True) or {}
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT a.id, a.is_read_later
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE a.id = ? AND s.user_id = ?
    """, (article_id, current_user['id']))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Artiklit ei leitud'}), 404

    current_val = bool(row['is_read_later'])
    if 'is_read_later' in data:
        new_val = 1 if data['is_read_later'] else 0
    else:
        new_val = 0 if current_val else 1

    cursor.execute("UPDATE articles SET is_read_later = ? WHERE id = ?", (new_val, article_id))
    conn.commit()

    cursor.execute("""
        SELECT COUNT(*)
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE s.user_id = ? AND a.is_read_later = 1
    """, (current_user['id'],))
    rl_row = cursor.fetchone()
    read_later_count = rl_row[0] if rl_row else 0

    conn.close()

    return jsonify({
        'success': True,
        'article_id': article_id,
        'is_read_later': bool(new_val),
        'read_later_count': read_later_count
    })

@app.route('/api/articles/<int:article_id>/read', methods=['POST'])
@login_required
def mark_article_read(current_user, article_id):
    data = request.get_json(silent=True) or {}
    is_read = 1 if data.get('is_read', True) else 0

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT a.id, a.source_id
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE a.id = ? AND s.user_id = ?
    """, (article_id, current_user['id']))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Artiklit ei leitud'}), 404

    cursor.execute("UPDATE articles SET is_read = ? WHERE id = ?", (is_read, article_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'article_id': article_id, 'is_read': is_read})

@app.route('/api/articles/<int:article_id>/open', methods=['POST'])
@login_required
def mark_article_opened(current_user, article_id):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT a.id, a.source_id
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE a.id = ? AND s.user_id = ?
    """, (article_id, current_user['id']))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Artiklit ei leitud'}), 404

    cursor.execute("UPDATE articles SET is_opened = 1, is_read = 1 WHERE id = ?", (article_id,))

    # Registreerime ka seadme kasutuse (mobiil vs arvuti)
    data = request.get_json(silent=True) or {}
    device = data.get('device')
    if device not in ('mobile', 'desktop'):
        device = 'mobile' if is_mobile_request(request) else 'desktop'
    dev_col = 'device_mobile_count' if device == 'mobile' else 'device_desktop_count'
    cursor.execute(f"UPDATE users SET {dev_col} = COALESCE({dev_col}, 0) + 1 WHERE id = ?", (current_user['id'],))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'article_id': article_id, 'is_opened': 1, 'is_read': 1, 'device': device})

@app.route('/api/articles/read-batch', methods=['POST'])
@login_required
def mark_articles_batch(current_user):
    data = request.get_json(silent=True) or {}
    article_ids = data.get('article_ids') or data.get('ids', [])
    if not article_ids:
        return jsonify({'success': True, 'affected': 0})

    # Valideeri ID-d ja piira massiivi pikkust (SQLite SQLITE_MAX_VARIABLE_NUMBER kaitseks)
    valid_ids = []
    for aid in article_ids:
        try:
            valid_ids.append(int(aid))
        except (ValueError, TypeError):
            continue
    if not valid_ids:
        return jsonify({'success': True, 'affected': 0})
    valid_ids = valid_ids[:500]

    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ','.join('?' for _ in valid_ids)
    cursor.execute(f"""
        UPDATE articles
        SET is_read = 1
        WHERE id IN ({placeholders})
          AND source_id IN (SELECT id FROM sources WHERE user_id = ?)
    """, valid_ids + [current_user['id']])
    affected = cursor.rowcount
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'affected': affected})

@app.route('/api/articles/read-all', methods=['POST'])
@login_required
def mark_all_read(current_user):
    source_id = request.args.get('source_id', type=int)
    category_id = request.args.get('category_id', type=int)
    read_later = request.args.get('read_later', '0') == '1'
    conn = get_db_connection()
    cursor = conn.cursor()
    if read_later:
        if source_id:
            cursor.execute("""
                UPDATE articles
                SET is_read = 1
                WHERE source_id = ? AND is_read_later = 1 AND is_read = 0
                  AND source_id IN (SELECT id FROM sources WHERE user_id = ?)
            """, (source_id, current_user['id']))
        else:
            cursor.execute("""
                UPDATE articles
                SET is_read = 1
                WHERE is_read_later = 1 AND is_read = 0
                  AND source_id IN (SELECT id FROM sources WHERE user_id = ?)
            """, (current_user['id'],))
    elif source_id:
        cursor.execute("""
            UPDATE articles
            SET is_read = 1
            WHERE source_id = ? AND is_read = 0
              AND source_id IN (SELECT id FROM sources WHERE user_id = ?)
        """, (source_id, current_user['id']))
    elif category_id:
        cursor.execute("""
            UPDATE articles
            SET is_read = 1
            WHERE source_id IN (SELECT id FROM sources WHERE category_id = ? AND user_id = ?)
              AND is_read = 0
        """, (category_id, current_user['id']))
    else:
        cursor.execute("""
            UPDATE articles
            SET is_read = 1
            WHERE is_read = 0
              AND source_id IN (SELECT id FROM sources WHERE user_id = ?)
        """, (current_user['id'],))
    affected = cursor.rowcount
    if affected > 0 and not read_later:
        # Kärbime loetud uudised (kuni 100 viimast allika kohta)
        if source_id:
            prune_unread_articles(cursor, source_id, max_unread=500, max_read=100)
        elif category_id:
            cursor.execute("SELECT id FROM sources WHERE category_id = ? AND user_id = ?", (category_id, current_user['id']))
            for s_row in cursor.fetchall():
                prune_unread_articles(cursor, s_row['id'], max_unread=500, max_read=100)
        else:
            cursor.execute("SELECT id FROM sources WHERE user_id = ?", (current_user['id'],))
            for s_row in cursor.fetchall():
                prune_unread_articles(cursor, s_row['id'], max_unread=500, max_read=100)

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'affected': affected})

# ==============================================================================
# Uuendamise staatus ja käsitsi uuendamine
# ==============================================================================

@app.route('/api/refresh/status', methods=['GET'])
@login_required
def get_refresh_status(current_user):
    is_user_refreshing = (current_user['id'] in active_user_refreshes) or global_is_refreshing
    user_res = user_refresh_results.get(current_user['id'], global_refresh_result)
    return jsonify({
        'is_refreshing': is_user_refreshing,
        'last_result': user_res
    })

@app.route('/api/refresh', methods=['POST'])
@app.route('/api/refresh/', methods=['POST'])
@login_required
def manual_refresh(current_user):
    try:
        source_id = request.args.get('source_id', type=int)
        conn = get_db_connection()
        cursor = conn.cursor()
        if source_id:
            cursor.execute("SELECT COUNT(*) FROM sources WHERE id = ? AND user_id = ?", (source_id, current_user['id']))
        else:
            cursor.execute("SELECT COUNT(*) FROM sources WHERE user_id = ?", (current_user['id'],))
        row = cursor.fetchone()
        count_sources = row[0] if row else 0
        conn.close()

        if count_sources == 0:
            return jsonify({
                'success': False,
                'no_sources': True,
                'message': 'Ühtegi allikat ei leitud',
                'new_articles': 0,
                'is_refreshing': False
            })

        with refresh_lock:
            if (current_user['id'] in active_user_refreshes) or global_is_refreshing:
                return jsonify({
                    'success': True,
                    'already_running': True,
                    'is_refreshing': True,
                    'message': 'Uudiste uuendamine juba käib taustal'
                })
            active_user_refreshes.add(current_user['id'])

        # Käivitame uuendamise taustalõimes selle kasutaja allikate jaoks
        try:
            t = threading.Thread(target=refresh_all_sources, args=(source_id, False, current_user['id']), daemon=True)
            t.start()
        except Exception:
            with refresh_lock:
                active_user_refreshes.discard(current_user['id'])
            raise

        return jsonify({
            'success': True,
            'started': True,
            'is_refreshing': True,
            'message': 'Uuendamine käivitati taustal'
        })
    except Exception as e:
        with refresh_lock:
            active_user_refreshes.discard(current_user['id'])
        app.logger.error(f"Viga /api/refresh käivitamisel: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'message': 'Uudisvoogude värskendamine ebaõnnestus. Palun proovi uuesti.',
            'error': 'Värskendamine ebaõnnestus',
            'new_articles': 0,
            'is_refreshing': False
        }), 500

@app.errorhandler(500)
def handle_500_error(e):
    app.logger.error(f"Sisemine serveri viga (500): {e}", exc_info=True)
    if request.path.startswith('/api/'):
        return jsonify({
            'success': False,
            'message': 'Sisemine serveri viga. Palun proovi hiljem uuesti.'
        }), 500
    return render_template('index.html', user=None, user_initial=None, has_users=True), 500

@app.errorhandler(Exception)
def handle_general_exception(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    app.logger.error(f"Käsitlemata serveri viga: {e}", exc_info=True)
    if request.path.startswith('/api/'):
        return jsonify({
            'success': False,
            'message': 'Serveri viga päringu töötlemisel.'
        }), 500
    raise e

# Taustalõime käivitamine
def start_background_thread():
    t = threading.Thread(target=background_scheduler, daemon=True)
    t.start()

# Initsialiseeri andmebaas
init_db()

# Käivita taustauuendaja
if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
    start_background_thread()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Lugeja rakendus käivitub aadressil http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)
