#!/usr/bin/env python3
"""
Spike: phoneme 控制（细粒度发音）验证 —— Fish Audio <|phoneme_start|>/<|phoneme_end|> 标签
用 python3 标准库实现 SOCKS5 + HTTPS（沙箱拦截 node，python3 可用）。
运行: cd scripts/spikes && python3 fish-phoneme.py
"""
import json, socket, ssl, struct, sys, os, time

API_HOST = "api.fish.audio"
API_PORT = 443
PROXY = ("127.0.0.1", 1081)

def load_key():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("FISH_API_KEY="):
                return line.split("=", 1)[1]
    return ""

KEY = load_key()
MODEL = os.environ.get("FISH_MODEL", "s2.1-pro-free")

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

def https_request(method, path, headers, body=None, timeout=240):
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
    clen = 0
    for line in head.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            clen = int(line.split(b":")[1].strip())
    return status, head, rest[:clen] if clen else rest

def tts(text, label):
    body = json.dumps({"text": text, "format": "mp3", "mp3_bitrate": 128}).encode()
    t0 = time.time()
    status, head, audio = https_request("POST", "/v1/tts", {
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        "model": MODEL,
    }, body)
    dt = time.time() - t0
    print(f"[{label}] HTTP {status} | {dt:.1f}s | {len(audio)} bytes")
    if status != 200:
        print(f"[{label}]   body: {audio[:400]!r}")
        return None
    return audio

def list_models():
    status, head, body = https_request("GET", "/model", {
        "Authorization": f"Bearer {KEY}",
    }, timeout=30)
    print(f"[list-models] HTTP {status}")
    if status != 200:
        print(f"  body: {body[:400]!r}")
        return []
    try:
        j = json.loads(body.decode())
    except Exception:
        print(f"  raw: {body[:400]!r}")
        return []
    items = j if isinstance(j, list) else j.get("items", j.get("data", []))
    for m in items[:10]:
        print(f"  - {m.get('_id')} | {m.get('title')} | {m.get('state')} | langs={m.get('languages')}")
    return items

def main():
    if not KEY:
        print("FISH_API_KEY 缺失")
        sys.exit(1)
    print("=== 音色库 ===")
    models = list_models()
    rid = None
    for m in models:
        if m.get("state") == "trained":
            rid = m.get("_id")
            break
    if not rid:
        print("没有 trained 音色 —— 尝试无参考音色请求")
    extra = {"reference_id": rid} if rid else {}
    print(f"\n=== phoneme 对比（model={MODEL}, ref={rid or 'none'}） ===")
    print("1) 基线: DESIGN.md 纯文本")
    body = json.dumps({"text": "这份文档叫 DESIGN.md。", "format": "mp3", **extra}).encode()
    t0 = time.time()
    status, head, audio = https_request("POST", "/v1/tts", {
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "model": MODEL,
    }, body)
    print(f"[baseline] HTTP {status} | {time.time()-t0:.1f}s | {len(audio)} bytes")
    if status != 200:
        print(f"  body: {audio[:400]!r}")
    else:
        with open("out-phoneme-baseline.mp3", "wb") as f:
            f.write(audio)
    print("2) phoneme: <|phoneme_start|>D IH0 Z AY1 N<|phoneme_end|>.md")
    body = json.dumps({"text": "这份文档叫 <|phoneme_start|>D IH0 Z AY1 N<|phoneme_end|>.md。", "format": "mp3", **extra}).encode()
    t0 = time.time()
    status, head, audio = https_request("POST", "/v1/tts", {
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "model": MODEL,
    }, body)
    print(f"[phoneme] HTTP {status} | {time.time()-t0:.1f}s | {len(audio)} bytes")
    if status == 200:
        with open("out-phoneme-tagged.mp3", "wb") as f:
            f.write(audio)
    else:
        print(f"  body: {audio[:400]!r}")

main()
