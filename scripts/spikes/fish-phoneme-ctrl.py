#!/usr/bin/env python3
"""受控实验：phoneme 标签是否在 s2.1-pro-free 生效？
READ (R IY1 D=reed / R EH1 D=red) 歧义词 + DESIGN 变体；英文音色；en ASR 对比。
"""
import json, socket, ssl, struct, os, time

API_HOST = "api.fish.audio"
API_PORT = 443
PROXY = ("127.0.0.1", 1081)
KEY = ""
for line in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
    if line.strip().startswith("FISH_API_KEY="):
        KEY = line.strip().split("=", 1)[1]
REF_ID = "90e65eaaf50e4470b8e6d43ee6afd7d5"  # en announcer voice (trained, langs=en)

def socks_connect(host, port):
    s = socket.create_connection(PROXY, timeout=20)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise RuntimeError("SOCKS auth failed")
    hb = host.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(hb)]) + hb + struct.pack(">H", port))
    resp = s.recv(10)
    if resp[1] != 0:
        raise RuntimeError(f"SOCKS connect failed code={resp[1]}")
    return s

def https_request(method, path, headers, body=None, timeout=120):
    raw = socks_connect(API_HOST, API_PORT)
    ctx = ssl.create_default_context()
    s = ctx.wrap_socket(raw, server_hostname=API_HOST)
    s.settimeout(timeout)
    hdrs = [f"{method} {path} HTTP/1.1", f"Host: {API_HOST}", "Connection: close"]
    for k, v in headers.items():
        hdrs.append(f"{k}: {v}")
    payload = body or b""
    if payload:
        hdrs.append(f"Content-Length: {len(payload)}")
    req = ("\r\n".join(hdrs) + "\r\n\r\n").encode() + payload
    s.sendall(req)
    buf = b""
    while True:
        try:
            chunk = s.recv(65536)
        except socket.timeout:
            break
        if not chunk:
            break
        buf += chunk
    s.close()
    head, _, rest = buf.partition(b"\r\n\r\n")
    status = int(head.split(b" ")[1])
    return status, rest

def msgpack(v):
    out = []
    def w(x):
        if x is None:
            out.append(b"\xc0")
        elif isinstance(x, bool):
            out.append(b"\xc3" if x else b"\xc2")
        elif isinstance(x, int):
            out.append(b"\xd3" + struct.pack(">q", x))
        elif isinstance(x, str):
            b = x.encode(); n = len(b)
            if n < 32: out.append(bytes([0xa0 | n]) + b)
            elif n < 256: out.append(b"\xd9" + bytes([n]) + b)
            elif n < 65536: out.append(b"\xda" + struct.pack(">H", n) + b)
            else: out.append(b"\xdb" + struct.pack(">I", n) + b)
        elif isinstance(x, (bytes, bytearray)):
            b = bytes(x); n = len(b)
            if n < 256: out.append(b"\xc4" + bytes([n]) + b)
            elif n < 65536: out.append(b"\xc5" + struct.pack(">H", n) + b)
            else: out.append(b"\xc6" + struct.pack(">I", n) + b)
        elif isinstance(x, (list, tuple)):
            n = len(x)
            if n < 16: out.append(bytes([0x90 | n]))
            elif n < 65536: out.append(b"\xdc" + struct.pack(">H", n))
            else: out.append(b"\xdd" + struct.pack(">I", n))
            for i in x: w(i)
        elif isinstance(x, dict):
            n = len(x)
            if n < 16: out.append(bytes([0x80 | n]))
            elif n < 65536: out.append(b"\xde" + struct.pack(">H", n))
            else: out.append(b"\xdf" + struct.pack(">I", n))
            for k, v in x.items():
                w(k); w(v)
        else:
            raise TypeError(f"unsupported {type(x)}")
    w(v)
    return b"".join(out)

FF = "/Users/free/Projects/dailogues/node_modules/.pnpm/@ffmpeg-installer+darwin-arm64@4.1.5/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg"

def tts_to_wav(text, name):
    body = json.dumps({"text": text, "format": "mp3", "mp3_bitrate": 128, "reference_id": REF_ID}).encode()
    status, audio = https_request("POST", "/v1/tts", {
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "model": "s2.1-pro-free",
    }, body, timeout=180)
    print(f"  tts {name}: HTTP {status} {len(audio)}B")
    if status != 200:
        print(f"    body: {audio[:300]!r}")
        return None
    open(f"/tmp/{name}.mp3", "wb").write(audio)
    os.system(f"{FF} -y -i /tmp/{name}.mp3 -ar 44100 -ac 1 /tmp/{name}.wav >/dev/null 2>&1")
    return f"/tmp/{name}.wav"

def asr_wav(path, lang):
    audio = open(path, "rb").read()
    body = msgpack({"audio": audio, "language": lang, "ignore_timestamps": True})
    status, resp = https_request("POST", "/v1/asr", {
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/msgpack", "model": "u2-tts-v0",
    }, body, timeout=120)
    if status == 200:
        try:
            return json.loads(resp.decode()).get("text", "")
        except Exception:
            return resp.decode(errors="replace")[:200]
    return f"ASR HTTP {status}"

cases = [
    ("read-plain",  "en", "The word is read."),
    ("read-red",    "en", "The word is <|phoneme_start|>R EH1 D<|phoneme_end|>."),
    ("read-reed",   "en", "The word is <|phoneme_start|>R IY1 D<|phoneme_end|>."),
    ("design-plain","en", "The file is named DESIGN.md."),
    ("design-ph",   "en", "The file is named <|phoneme_start|>D IH0 Z AY1 N<|phoneme_end|>.md."),
]
for name, lang, text in cases:
    print(f"=== {name}: {text} ===")
    wav = tts_to_wav(text, name)
    if wav:
        print(f"  asr: {asr_wav(wav, lang)}")
