"""
ThinkPort AI Gateway - Saf Python PostgreSQL v3 Wire Protocol & pgvector Sürücüsü (postgres_driver.py).
Harici C derlemesi veya pip paketi gerektirmeden doğrudan TCP soketi üzerinden PostgreSQL 17 (pgvector)
sunucusuyla iletişim kurar; SCRAM-SHA-256 / MD5 / Cleartext kimlik doğrulamasını, sorgu parametre
dönüşümünü ve pgvector tabanlı RAG / Oturum Hafızası tablolarını yönetir.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import os
import re
import secrets
import socket
import struct
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


class PgRow:
    """
    Sözlük ve indeks erişimi destekleyen PostgreSQL satır nesnesi.
    Hem sütun adına göre (`row['id']`), hem indekse göre (`row[0]`), hem de `dict(row)` dönüşümüyle erişim sağlar.
    """

    __slots__ = ("_columns", "_values", "_map")

    def __init__(self, columns: List[str], values: List[Any]) -> None:
        self._columns = columns
        self._values = values
        self._map = {col: val for col, val in zip(columns, values)}

    def __getitem__(self, key: int | str | slice) -> Any:
        if isinstance(key, str):
            if key in self._map:
                return self._map[key]
            lower_key = key.lower()
            for k, v in self._map.items():
                if k.lower() == lower_key:
                    return v
            raise KeyError(key)
        return self._values[key]

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default

    def keys(self) -> List[str]:
        return list(self._columns)

    def values(self) -> List[Any]:
        return list(self._values)

    def items(self) -> List[Tuple[str, Any]]:
        return list(zip(self._columns, self._values))

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __contains__(self, key: object) -> bool:
        return key in self._map

    def __repr__(self) -> str:
        return f"PgRow({self._map!r})"


class PgCursorResult:
    """Veritabanı sorgu sonucunu (`fetchone`, `fetchall`, iterasyon) sarmalayan imleç nesnesi."""

    def __init__(self, rows: List[PgRow], rowcount: int = 0) -> None:
        self._rows = rows
        self._idx = 0
        self.rowcount = rowcount

    def fetchone(self) -> Optional[PgRow]:
        if self._idx >= len(self._rows):
            return None
        row = self._rows[self._idx]
        self._idx += 1
        return row

    def fetchall(self) -> List[PgRow]:
        if self._idx == 0:
            self._idx = len(self._rows)
            return list(self._rows)
        rem = self._rows[self._idx :]
        self._idx = len(self._rows)
        return rem

    def __iter__(self) -> Iterator[PgRow]:
        return iter(self._rows)


# PostgreSQL OID -> Python tip dönüştürücü tablosu
_INT_OIDS = {20, 21, 23, 26}          # int8, int2, int4, oid
_FLOAT_OIDS = {700, 701, 1700}        # float4, float8, numeric
_BOOL_OIDS = {16}                     # bool


def _decode_pg_value(raw_bytes: Optional[bytes], type_oid: int) -> Any:
    if raw_bytes is None:
        return None
    text = raw_bytes.decode("utf-8", errors="replace")
    if type_oid in _INT_OIDS:
        try:
            return int(text)
        except ValueError:
            return text
    if type_oid in _FLOAT_OIDS:
        try:
            return float(text)
        except ValueError:
            return text
    if type_oid in _BOOL_OIDS:
        return 1 if text in ("t", "true", "1", "TRUE") else 0
    return text


class PgWireConnection:
    """
    PostgreSQL v3 Wire Protocol üzerinde çalışan saf Python TCP soket bağlantısı.
    SCRAM-SHA-256, MD5 ve Cleartext kimlik doğrulamasını destekler.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 5432,
        user: str = "gateway",
        password: str = "gateway_secret_password",
        database: str = "thinkport_db",
        timeout: float = 30.0,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.user = user
        self.password = password
        self.database = database
        self.timeout = timeout
        self._sock: Optional[socket.socket] = None
        self._in_tx = False
        self._connect()

    def _connect(self) -> None:
        sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._sock = sock
        try:
            params = (
                f"user\x00{self.user}\x00"
                f"database\x00{self.database}\x00"
                f"client_encoding\x00UTF8\x00"
                f"application_name\x00thinkport_api\x00\x00"
            ).encode("utf-8")
            startup_len = 4 + 4 + len(params)
            startup_pkt = struct.pack("!II", startup_len, 196608) + params
            self._send_raw(startup_pkt)
            self._handle_auth_and_startup()
        except Exception:
            self.close()
            raise

    def _send_raw(self, data: bytes) -> None:
        assert self._sock is not None
        self._sock.sendall(data)

    def _send_msg(self, msg_type: bytes, payload: bytes) -> None:
        length = 4 + len(payload)
        self._send_raw(msg_type + struct.pack("!I", length) + payload)

    def _recv_exact(self, n: int) -> bytes:
        assert self._sock is not None
        buf = bytearray()
        while len(buf) < n:
            chunk = self._sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("PostgreSQL sunucusu bağlantıyı kapattı.")
            buf.extend(chunk)
        return bytes(buf)

    def _read_msg(self) -> Tuple[str, bytes]:
        hdr = self._recv_exact(5)
        msg_type = chr(hdr[0])
        length = struct.pack("!I", 0)  # dummy for type checker
        (msg_len,) = struct.unpack("!I", hdr[1:5])
        payload = self._recv_exact(msg_len - 4) if msg_len > 4 else b""
        return msg_type, payload

    @staticmethod
    def _parse_error_payload(payload: bytes) -> str:
        parts: Dict[str, str] = {}
        idx = 0
        while idx < len(payload):
            field_type = payload[idx]
            idx += 1
            if field_type == 0:
                break
            end = payload.find(b"\x00", idx)
            if end == -1:
                break
            val = payload[idx:end].decode("utf-8", errors="replace")
            parts[chr(field_type)] = val
            idx = end + 1
        code = parts.get("C", "")
        msg = parts.get("M", "PostgreSQL hatası")
        detail = parts.get("D", "")
        return f"[{code}] {msg}" + (f" ({detail})" if detail else "")

    def _handle_auth_and_startup(self) -> None:
        while True:
            mtype, payload = self._read_msg()
            if mtype == "R":
                (auth_code,) = struct.unpack("!I", payload[:4])
                if auth_code == 0:
                    continue
                elif auth_code == 3:
                    # Cleartext password
                    self._send_msg(b"p", self.password.encode("utf-8") + b"\x00")
                elif auth_code == 5:
                    # MD5 password
                    salt = payload[4:8]
                    inner = hashlib.md5(
                        (self.password + self.user).encode("utf-8")
                    ).hexdigest().encode("ascii")
                    outer = hashlib.md5(inner + salt).hexdigest()
                    md5_pwd = ("md5" + outer).encode("ascii") + b"\x00"
                    self._send_msg(b"p", md5_pwd)
                elif auth_code == 10:
                    # SASL (SCRAM-SHA-256)
                    self._perform_scram_sha256()
                else:
                    raise RuntimeError(f"Desteklenmeyen PostgreSQL auth kodu: {auth_code}")
            elif mtype == "E":
                raise RuntimeError(self._parse_error_payload(payload))
            elif mtype == "Z":
                return
            else:
                # 'S' (ParameterStatus), 'K' (BackendKeyData), 'N' (NoticeResponse)
                continue

    def _perform_scram_sha256(self) -> None:
        client_nonce = base64.b64encode(secrets.token_bytes(18)).decode("ascii")
        client_first_bare = f"n=,r={client_nonce}"
        gs2_header = "n,,"
        client_first_msg = (gs2_header + client_first_bare).encode("utf-8")

        mech = b"SCRAM-SHA-256\x00"
        initial_Payload = mech + struct.pack("!I", len(client_first_msg)) + client_first_msg
        self._send_msg(b"p", initial_Payload)

        mtype, payload = self._read_msg()
        if mtype == "E":
            raise RuntimeError(self._parse_error_payload(payload))
        if mtype != "R":
            raise RuntimeError(f"Beklenmeyen SCRAM yanıt tipi: {mtype}")
        (auth_code,) = struct.unpack("!I", payload[:4])
        if auth_code != 11:
            raise RuntimeError(f"SCRAM SASLContinue (11) bekleniyordu, gelen: {auth_code}")

        server_first_str = payload[4:].decode("utf-8")
        attrs: Dict[str, str] = {}
        for part in server_first_str.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                attrs[k] = v

        combined_nonce = attrs.get("r", "")
        salt_b64 = attrs.get("s", "")
        iterations = int(attrs.get("i", "4096"))
        if not combined_nonce.startswith(client_nonce):
            raise RuntimeError("SCRAM sunucu nonce doğrulaması başarısız.")

        salt = base64.b64decode(salt_b64)
        salted_pwd = hashlib.pbkdf2_hmac(
            "sha256",
            self.password.encode("utf-8"),
            salt,
            iterations,
        )
        client_key = hmac.new(salted_pwd, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        channel_binding = base64.b64encode(gs2_header.encode("utf-8")).decode("ascii")
        client_final_without_proof = f"c={channel_binding},r={combined_nonce}"
        auth_message = f"{client_first_bare},{server_first_str},{client_final_without_proof}".encode("utf-8")

        client_signature = hmac.new(stored_key, auth_message, hashlib.sha256).digest()
        client_proof = bytes(a ^ b for a, b in zip(client_key, client_signature))
        proof_b64 = base64.b64encode(client_proof).decode("ascii")
        client_final_msg = f"{client_final_without_proof},p={proof_b64}".encode("utf-8")

        self._send_msg(b"p", client_final_msg)

        mtype2, payload2 = self._read_msg()
        if mtype2 == "E":
            raise RuntimeError(self._parse_error_payload(payload2))
        if mtype2 == "R":
            (auth_code2,) = struct.unpack("!I", payload2[:4])
            if auth_code2 not in (0, 12):
                raise RuntimeError(f"SCRAM SASLFinal hatası: {auth_code2}")

    def execute_raw_sql(self, sql: str) -> PgCursorResult:
        """Basit sorgu protokolü ('Q') ile SQL çalıştırır ve tüm sonuçları okur."""
        query_bytes = sql.encode("utf-8") + b"\x00"
        self._send_msg(b"Q", query_bytes)

        columns: List[str] = []
        col_oids: List[int] = []
        rows: List[PgRow] = []
        rowcount = 0
        error_msg: Optional[str] = None

        while True:
            mtype, payload = self._read_msg()
            if mtype == "T":
                # RowDescription
                (num_fields,) = struct.unpack("!H", payload[:2])
                idx = 2
                columns = []
                col_oids = []
                for _ in range(num_fields):
                    end = payload.find(b"\x00", idx)
                    col_name = payload[idx:end].decode("utf-8", errors="replace")
                    idx = end + 1
                    # table_oid(4), attr_num(2), type_oid(4), type_size(2), type_mod(4), fmt(2) = 18 bytes
                    (_tbl_oid, _attr_num, type_oid, _tsize, _tmod, _fmt) = struct.unpack(
                        "!Ihihih", payload[idx : idx + 18]
                    )
                    idx += 18
                    columns.append(col_name)
                    col_oids.append(type_oid)
            elif mtype == "D":
                # DataRow
                (num_cols,) = struct.unpack("!H", payload[:2])
                idx = 2
                vals: List[Any] = []
                for c_idx in range(num_cols):
                    (col_len,) = struct.unpack("!i", payload[idx : idx + 4])
                    idx += 4
                    if col_len == -1:
                        vals.append(None)
                    else:
                        raw_val = payload[idx : idx + col_len]
                        idx += col_len
                        oid = col_oids[c_idx] if c_idx < len(col_oids) else 25
                        vals.append(_decode_pg_value(raw_val, oid))
                rows.append(PgRow(columns, vals))
            elif mtype == "C":
                # CommandComplete (e.g. "INSERT 0 1\x00", "UPDATE 3\x00", "SELECT 5\x00")
                tag = payload.rstrip(b"\x00").decode("utf-8", errors="replace")
                parts = tag.split()
                if parts and parts[-1].isdigit():
                    rowcount = int(parts[-1])
            elif mtype == "E":
                error_msg = self._parse_error_payload(payload)
            elif mtype == "Z":
                # ReadyForQuery ('I' idle, 'T' in transaction, 'E' failed transaction)
                break
            else:
                continue

        if error_msg is not None:
            raise RuntimeError(f"{error_msg} | SQL: {sql[:300]}")

        return PgCursorResult(rows=rows, rowcount=rowcount)

    @staticmethod
    def format_sql_value(val: Any) -> str:
        """Python değerini güvenli PostgreSQL SQL sabitine (literal) dönüştürür."""
        if val is None:
            return "NULL"
        if isinstance(val, bool):
            return "1" if val else "0"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, (bytes, bytearray)):
            return f"'\\x{bytes(val).hex()}'"
        if isinstance(val, list):
            # pgvector listesi ise '[0.1, 0.2, ...]'
            if all(isinstance(x, (int, float)) for x in val):
                vec_str = ",".join(f"{float(x):.6f}" for x in val)
                return f"'[{vec_str}]'"
        s = str(val).replace("\x00", "")
        escaped = s.replace("'", "''")
        return f"'{escaped}'"

    @classmethod
    def translate_sqlite_to_pg(cls, sql: str, params: Optional[Sequence[Any]] = None) -> Optional[str]:
        """
        SQLite sorgu sözdizimini (`?` parametreleri, `PRAGMA`, `INSERT OR IGNORE`, `INSERT OR REPLACE`,
        `rowid`, `COLLATE NOCASE`, `LIKE`) PostgreSQL 17 uyumlu SQL sorgusuna dönüştürür.
        """
        stripped = sql.strip()
        if not stripped:
            return None

        upper = stripped.upper()

        # PRAGMA komutları
        if upper.startswith("PRAGMA"):
            m_info = re.match(r"PRAGMA\s+table_info\(\s*([a-zA-Z0-9_]+)\s*\)", stripped, re.IGNORECASE)
            if m_info:
                tbl = m_info.group(1).lower()
                return (
                    f"SELECT ordinal_position - 1 AS cid, column_name AS name, data_type AS type, "
                    f"CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull, "
                    f"column_default AS dflt_value, 0 AS pk "
                    f"FROM information_schema.columns "
                    f"WHERE table_schema = 'public' AND table_name = '{tbl}' "
                    f"ORDER BY ordinal_position"
                )
            return None

        # sqlite_master sorgusu -> information_schema.tables
        if "sqlite_master" in stripped:
            return (
                "SELECT table_name AS name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'system_users'"
            )

        out = stripped

        # COLLATE NOCASE kaldır
        out = re.sub(r"\bCOLLATE\s+NOCASE\b", "", out, flags=re.IGNORECASE)

        # rowid -> ctid
        out = re.sub(r"\b([a-zA-Z0-9_]+\.)?rowid\b", r"\1ctid", out)

        # LIKE -> ILIKE (SQLite'ta LIKE varsayılan olarak büyük/küçük harf duyarsızdır)
        out = re.sub(r"\bLIKE\b", "ILIKE", out)

        # INSERT OR IGNORE INTO ... -> INSERT INTO ... ON CONFLICT DO NOTHING
        has_or_ignore = False
        if re.search(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", out, flags=re.IGNORECASE):
            out = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", out, flags=re.IGNORECASE)
            has_or_ignore = True

        # INSERT OR REPLACE INTO <table> (<cols>) VALUES (...)
        m_replace = re.match(
            r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)\s*;?\s*$",
            out,
            flags=re.IGNORECASE,
        )
        if m_replace:
            tbl_name = m_replace.group(1).strip()
            cols_raw = [c.strip() for c in m_replace.group(2).split(",") if c.strip()]
            vals_part = m_replace.group(3).strip()
            pk_col = "request_id" if tbl_name.lower() == "usage_logs" else ("key" if tbl_name.lower() == "system_settings" else "id")
            update_assigns = ", ".join(
                f"{c} = EXCLUDED.{c}" for c in cols_raw if c.lower() != pk_col.lower()
            )
            out = (
                f"INSERT INTO {tbl_name} ({', '.join(cols_raw)}) VALUES ({vals_part}) "
                f"ON CONFLICT ({pk_col}) DO UPDATE SET {update_assigns}"
            )

        # '?' parametrelerini güvenli değerlerle değiştir
        if params:
            param_iter = iter(params)
            pieces: List[str] = []
            in_single_quote = False
            i = 0
            n = len(out)
            while i < n:
                ch = out[i]
                if ch == "'":
                    pieces.append(ch)
                    if in_single_quote and i + 1 < n and out[i + 1] == "'":
                        pieces.append("'")
                        i += 2
                        continue
                    in_single_quote = not in_single_quote
                elif ch == "?" and not in_single_quote:
                    try:
                        val = next(param_iter)
                    except StopIteration:
                        val = None
                    pieces.append(cls.format_sql_value(val))
                else:
                    pieces.append(ch)
                i += 1
            out = "".join(pieces)

        if has_or_ignore and "ON CONFLICT" not in out.upper():
            out = out.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"

        return out

    def execute(self, sql: str, params: Optional[Sequence[Any]] = None) -> PgCursorResult:
        translated = self.translate_sqlite_to_pg(sql, params)
        if not translated:
            return PgCursorResult(rows=[], rowcount=0)
        return self.execute_raw_sql(translated)

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence[Any]]) -> PgCursorResult:
        total_rows = 0
        for p in seq_of_params:
            res = self.execute(sql, p)
            total_rows += res.rowcount
        return PgCursorResult(rows=[], rowcount=total_rows)

    def executescript(self, script: str) -> None:
        for stmt in script.split(";"):
            s = stmt.strip()
            if not s:
                continue
            self.execute(s)

    def begin(self) -> None:
        if not self._in_tx:
            self.execute_raw_sql("BEGIN")
            self._in_tx = True

    def commit(self) -> None:
        if self._in_tx:
            self.execute_raw_sql("COMMIT")
            self._in_tx = False

    def rollback(self) -> None:
        if self._in_tx:
            try:
                self.execute_raw_sql("ROLLBACK")
            except Exception:
                pass
            self._in_tx = False

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._send_msg(b"X", b"")
            except Exception:
                pass
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None

