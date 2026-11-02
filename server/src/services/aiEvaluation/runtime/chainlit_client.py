"""Trusted JSONL transport. Connects only to the imported app on loopback."""
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
import aiohttp
import socketio


class TransportError(Exception):
    pass


async def main():
    sio = None
    http = None
    pending = None
    startup_idle = asyncio.Event()
    records = {}
    parents = {}
    observed = []
    task_started = False
    message_id = None
    error_code = None
    byte_count = 0

    async def finish_error(code):
        nonlocal error_code
        error_code = code
        if pending and not pending.done():
            pending.set_result(None)

    async def message(data):
        nonlocal byte_count
        if pending is None or not isinstance(data, dict):
            return
        if data.get("type") in ("error_message",) or data.get("isError"):
            await finish_error("CHATBOT_RUNTIME_ERROR")
            return
        key = data.get("id")
        if not isinstance(key, str):
            return
        parents[key] = data.get("parentId")
        if len(parents) > 20000:
            await finish_error("CHAINLIT_EVENT_LIMIT")
            return
        if data.get("type") != "assistant_message":
            return
        # Greeting/internal steps are not evidence of an answer to this user turn.
        ancestor, visited = data.get("parentId"), set()
        while ancestor and ancestor != message_id and ancestor not in visited:
            visited.add(ancestor)
            ancestor = parents.get(ancestor)
        if ancestor != message_id:
            return
        output = data.get("output", "")
        if not isinstance(output, str):
            return
        byte_count += len(output.encode())
        if byte_count > 1048576:
            await finish_error("CHAINLIT_RESPONSE_LIMIT")
            return
        records[key] = output
        observed.append({"event": "assistant_message", "id": key, "parentId": data.get("parentId"), "userMessageId": message_id})

    async def token(data):
        nonlocal byte_count
        if pending is None or not isinstance(data, dict) or data.get("isInput"):
            return
        key = data.get("id")
        if key not in records or not isinstance(data.get("token"), str):
            return
        chunk = data["token"]
        byte_count += len(chunk.encode())
        if byte_count > 1048576:
            await finish_error("CHAINLIT_RESPONSE_LIMIT")
            return
        records[key] = chunk if data.get("isSequence") else records[key] + chunk
        observed.append({"event": "stream_token", "id": key})
        if len(observed) > 20000:
            await finish_error("CHAINLIT_EVENT_LIMIT")

    async def task_start(*_):
        nonlocal task_started
        if pending is not None:
            task_started = True
        else:
            startup_idle.clear()

    async def task_end(*_):
        if pending is not None and task_started and not pending.done():
            pending.set_result(None)
        elif pending is None:
            startup_idle.set()

    async def disconnect(*_):
        if pending is not None:
            await finish_error("CHAINLIT_DISCONNECTED")

    async def interactive(*_):
        await finish_error("CHAINLIT_INTERACTION_REQUIRED")

    def reply(command_id, **fields):
        print(json.dumps({"id": command_id, **fields}), flush=True)

    try:
        while True:
            line = await asyncio.wait_for(asyncio.to_thread(sys.stdin.readline), timeout=240)
            if not line:
                break
            command_id = None
            try:
                if len(line.encode()) > 1048576:
                    raise TransportError("CHAINLIT_REQUEST_LIMIT")
                command = json.loads(line)
                command_id = command["id"]
                if command["op"] == "close":
                    reply(command_id, ok=True)
                    break
                if command["op"] == "connect":
                    if sio is not None:
                        raise TransportError("CHAINLIT_SESSION_EXISTS")
                    port = command.get("port", 3000)
                    prefix = command.get("path", "/").rstrip("/")
                    auth_path = command.get("authPath")
                    if not isinstance(port, int) or not 1 <= port <= 65535:
                        raise TransportError("INVALID_LOCAL_TARGET")
                    for endpoint in (prefix or "/", auth_path or "/"):
                        if not endpoint.startswith("/") or endpoint.startswith("//") or "?" in endpoint or "#" in endpoint or "\\" in endpoint:
                            raise TransportError("INVALID_LOCAL_TARGET")
                    base = f"http://127.0.0.1:{port}"
                    http = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True), trust_env=False, timeout=aiohttp.ClientTimeout(total=15))
                    if auth_path:
                        async with http.get(base + auth_path, allow_redirects=False) as response:
                            if response.status != 200:
                                raise TransportError("CHATBOT_AUTH_REQUIRED")
                            if len(await response.content.read(1048577)) > 1048576:
                                raise TransportError("CHAINLIT_RESPONSE_LIMIT")
                    sio = socketio.AsyncClient(http_session=http, reconnection=False, logger=False, engineio_logger=False)
                    for event in ("new_message", "update_message", "stream_start"):
                        sio.on(event, message)
                    sio.on("stream_token", token)
                    sio.on("task_start", task_start)
                    sio.on("task_end", task_end)
                    sio.on("disconnect", disconnect)
                    sio.on("ask", interactive)
                    sio.on("call_fn", interactive)
                    session_id = str(uuid.uuid4())
                    await sio.connect(base, socketio_path=(prefix + "/ws/socket.io").lstrip("/"), transports=["websocket"], auth={"clientType": "webapp", "sessionId": session_id, "threadId": "", "userEnv": "{}", "chatProfile": ""}, wait_timeout=15)
                    await sio.call("connection_successful", timeout=15)
                    # The server schedules on_chat_start after its initial task_end.
                    # Let that task start, then wait for it before dispatching a prompt.
                    await asyncio.sleep(0.1)
                    await asyncio.wait_for(startup_idle.wait(), timeout=30)
                    reply(command_id, ok=True, sessionId=session_id, pid=os.getpid())
                elif command["op"] == "turn":
                    if sio is None or not sio.connected:
                        raise TransportError("CHAINLIT_SESSION_CLOSED")
                    text = command["content"]
                    if not isinstance(text, str) or len(text.encode()) > 200000:
                        raise TransportError("CHAINLIT_REQUEST_LIMIT")
                    pending = asyncio.get_running_loop().create_future()
                    records, parents, observed, byte_count = {}, {}, [], 0
                    task_started, error_code = False, None
                    message_id = str(uuid.uuid4())
                    await sio.emit("client_message", {"message": {"id": message_id, "type": "user_message", "output": text, "createdAt": datetime.now(timezone.utc).isoformat(), "metadata": {}}, "fileReferences": []})
                    await asyncio.wait_for(pending, timeout=min(command.get("timeoutMs", 60000) / 1000, 180))
                    if error_code:
                        raise TransportError(error_code)
                    answer = "\n".join(value for value in records.values() if value.strip())
                    if not answer:
                        raise TransportError("CHATBOT_ANSWER_MISSING")
                    reply(command_id, ok=True, answer=answer, trace={"protocol": "CHAINLIT_SOCKET_IO", "userMessageId": message_id, "events": observed, "completed": True})
                    pending = None
                else:
                    raise TransportError("INVALID_CHAINLIT_COMMAND")
            except Exception as error:
                code = str(error) if isinstance(error, TransportError) else "CHAINLIT_TIMEOUT" if isinstance(error, asyncio.TimeoutError) else "CHAINLIT_CONNECTION_ERROR"
                reply(command_id, ok=False, code=code)
                # No reconnect or replay after an ambiguous/dispatched operation.
                break
    finally:
        if sio and sio.connected:
            try:
                await sio.emit('clear_session')
                await sio.disconnect()
            except Exception:
                pass
        if http:
            await http.close()


asyncio.run(main())
