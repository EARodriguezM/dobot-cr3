"""The edge gatekeeper: the only door into this lab's ROS 2 graph.

``foxglove_bridge`` has no authentication of its own, so it is bound to
localhost and this process is what the Cloudflare Tunnel actually reaches. Every
browser WebSocket terminates here; the gatekeeper authenticates it, decides
whether each frame may actuate the robot (``policy.py``), and only then relays
it to the bridge.

It also does the thing this lab exists for: **fan-out of what the operator is
doing**. One person holds the control lease; everyone else is a spectator, and
a spectator who can only see joint angles cannot tell a deliberate move from a
fault. So every authorized command is broadcast to every connected session as
an ``activity`` frame, immediately, with the name of the person who issued it.
Telemetry answers *what the arm is doing*; the activity feed answers *who asked
it to, and for what*.

Run it with the ROS 2 workspace sourced or not — it never imports rclpy. It
speaks to ROS exclusively through the bridge, which means it keeps working (and
keeps refusing unauthorized callers) even while the robot stack is restarting.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

import aiohttp
from aiohttp import web

from . import policy, protocol
from .auth import AuthError, Identity, LeaseVerifier, TokenVerifier, probe_jwks

log = logging.getLogger('primbio.gateway')

FOXGLOVE_SUBPROTOCOL = 'foxglove.websocket.v1'

# A socket that has not identified itself this quickly is closed. Short on
# purpose: an unauthenticated socket is a resource an anonymous caller controls.
AUTH_TIMEOUT_S = 5.0

# WebSocket close codes (4000-4999 is the application-defined range).
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_UPSTREAM_DOWN = 4502

# Cap on how much of a service-call payload is echoed into the activity feed.
ACTIVITY_DETAIL_LIMIT = 512


# eq=False keeps identity semantics: two connections from the same person are
# two sessions, and the registry below is a set of live sockets.
@dataclass(eq=False)
class Session:
    """One authenticated browser connection."""

    id: str
    identity: Identity
    ws: web.WebSocketResponse
    lease_token: str = ''
    # serviceId → name, learned from the bridge's advertiseServices frames.
    services: Dict[int, str] = field(default_factory=dict)
    # channelId → topic, learned from this client's own advertise frames.
    channels: Dict[int, str] = field(default_factory=dict)

    def holds_lease(self, leases: LeaseVerifier) -> bool:
        return leases.holds_lease(self.lease_token, self.identity)


class Gateway:
    def __init__(self, config: 'Config'):
        self.config = config
        self.tokens = TokenVerifier(
            supabase_url=config.supabase_url,
            project_id=config.project_id,
            jwt_secret=config.jwt_secret,
            default_role=config.default_role,
        )
        self.leases = LeaseVerifier(config.lease_secret, config.lab_slug)
        self.sessions: Set[Session] = set()

    # ── Activity fan-out ────────────────────────────────────────────────────

    async def broadcast(self, message: dict) -> None:
        """Send a frame to every live session. Never raises: one dead socket
        must not stop the others from being told what just happened."""
        payload = json.dumps(message)
        for session in list(self.sessions):
            try:
                await session.ws.send_str(payload)
            except Exception:
                self.sessions.discard(session)

    async def announce(
        self,
        session: Session,
        action: str,
        detail: Any = None,
        is_stop: bool = False,
    ) -> None:
        await self.broadcast(
            {
                'op': 'activity',
                'id': uuid.uuid4().hex[:12],
                'ts': int(time.time() * 1000),
                'user': {
                    'id': session.identity.user_id,
                    'name': session.identity.name,
                },
                'action': action,
                'detail': detail,
                'stop': is_stop,
            }
        )

    async def announce_presence(self, event: str, session: Session) -> None:
        await self.broadcast(
            {
                'op': 'presence',
                'event': event,
                'ts': int(time.time() * 1000),
                'user': {
                    'id': session.identity.user_id,
                    'name': session.identity.name,
                    'role': session.identity.role,
                },
                'viewers': len(self.sessions),
            }
        )

    # ── WebSocket entry point ───────────────────────────────────────────────

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(
            protocols=[FOXGLOVE_SUBPROTOCOL], heartbeat=20.0, max_msg_size=16 * 1024 * 1024
        )
        await ws.prepare(request)

        try:
            identity, lease_token = await self._authenticate(ws)
        except AuthError as exc:
            log.info('[ws] rejected from %s: %s', request.remote, exc)
            await ws.close(code=CLOSE_UNAUTHORIZED, message=b'unauthorized')
            return ws

        session = Session(
            id=uuid.uuid4().hex[:12],
            identity=identity,
            ws=ws,
            lease_token=lease_token,
        )

        # Connect to the bridge only after the client has proved who it is, so
        # an unauthenticated caller can never cause an upstream connection.
        try:
            upstream_session, upstream = await self._connect_upstream()
        except Exception as exc:
            log.warning('[ws] upstream unavailable: %s', exc)
            await ws.send_str(
                json.dumps({'op': 'gatewayError', 'reason': 'robot bridge unavailable'})
            )
            await ws.close(code=CLOSE_UPSTREAM_DOWN, message=b'bridge unavailable')
            return ws

        self.sessions.add(session)
        log.info(
            '[ws] %s (%s, role=%s) connected — %d viewer(s)',
            identity.name,
            identity.email,
            identity.role,
            len(self.sessions),
        )
        await ws.send_str(
            json.dumps(
                {
                    'op': 'hello',
                    'session': session.id,
                    'user': {
                        'id': identity.user_id,
                        'name': identity.name,
                        'email': identity.email,
                        'role': identity.role,
                    },
                    'holdsLease': session.holds_lease(self.leases),
                    'viewers': len(self.sessions),
                }
            )
        )
        await self.announce_presence('join', session)

        # Whichever side goes away first ends the session: gathering both would
        # leave the bridge pump waiting forever on a socket whose browser is
        # already gone, leaking an upstream connection per disconnect.
        pumps = [
            asyncio.create_task(self._pump_client_to_bridge(session, upstream)),
            asyncio.create_task(self._pump_bridge_to_client(session, upstream)),
        ]
        try:
            await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for pump in pumps:
                pump.cancel()
            await asyncio.gather(*pumps, return_exceptions=True)
            self.sessions.discard(session)
            await self.announce_presence('leave', session)
            log.info(
                '[ws] %s disconnected — %d viewer(s)', identity.name, len(self.sessions)
            )
            for closeable in (upstream, upstream_session):
                try:
                    await closeable.close()
                except Exception:
                    pass
        return ws

    async def _authenticate(self, ws: web.WebSocketResponse) -> tuple[Identity, str]:
        """Consume the mandatory first frame and resolve it to an identity."""
        try:
            first = await asyncio.wait_for(ws.receive(), timeout=AUTH_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            raise AuthError('no auth frame within timeout') from exc

        if first.type is not aiohttp.WSMsgType.TEXT:
            raise AuthError('first frame was not a text auth frame')
        try:
            message = json.loads(first.data)
        except Exception as exc:
            raise AuthError('first frame was not valid JSON') from exc
        if message.get('op') != 'auth':
            raise AuthError(f"first frame op was {message.get('op')!r}, expected 'auth'")

        identity = self.tokens.verify(str(message.get('token') or ''))
        return identity, str(message.get('lease') or '')

    async def _connect_upstream(self):
        session = aiohttp.ClientSession()
        try:
            ws = await session.ws_connect(
                self.config.bridge_url,
                protocols=[FOXGLOVE_SUBPROTOCOL],
                heartbeat=20.0,
                max_msg_size=16 * 1024 * 1024,
            )
        except Exception:
            await session.close()
            raise
        return session, ws

    # ── Frame pumps ─────────────────────────────────────────────────────────

    async def _pump_client_to_bridge(
        self, session: Session, upstream: aiohttp.ClientWebSocketResponse
    ) -> None:
        """Police everything the browser sends before it reaches ROS."""
        async for msg in session.ws:
            if msg.type is aiohttp.WSMsgType.TEXT:
                await self._handle_client_text(session, upstream, msg.data)
            elif msg.type is aiohttp.WSMsgType.BINARY:
                await self._handle_client_binary(session, upstream, msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                break

    async def _handle_client_text(
        self, session: Session, upstream: aiohttp.ClientWebSocketResponse, raw: str
    ) -> None:
        try:
            message = json.loads(raw)
        except Exception:
            await self._deny(session, 'malformed frame')
            return
        op = str(message.get('op') or '')

        # Lease refresh is ours, not the bridge's: never forwarded.
        if op == 'lease':
            session.lease_token = str(message.get('token') or '')
            await session.ws.send_str(
                json.dumps(
                    {'op': 'leaseAck', 'holdsLease': session.holds_lease(self.leases)}
                )
            )
            return

        decision = policy.check_json_op(op, session.identity, session.holds_lease(self.leases))
        if not decision.allowed:
            await self._deny(session, decision.reason, op=op)
            return

        if op == 'advertise':
            session.channels.update(protocol.channel_topics(message))
        elif op == 'unadvertise':
            for channel_id in message.get('channelIds') or []:
                session.channels.pop(int(channel_id), None)

        if decision.activity:
            await self.announce(
                session, decision.activity, message.get('parameters'), decision.is_stop
            )
        await upstream.send_str(raw)

    async def _handle_client_binary(
        self, session: Session, upstream: aiohttp.ClientWebSocketResponse, data: bytes
    ) -> None:
        if not data:
            return
        opcode = data[0]

        if opcode == protocol.CLIENT_SERVICE_CALL_REQUEST:
            call = protocol.parse_service_call(data)
            if call is None:
                await self._deny(session, 'malformed service call')
                return
            name = session.services.get(call.service_id)
            decision = policy.check_service_call(
                name, session.identity, session.holds_lease(self.leases)
            )
            if not decision.allowed:
                log.info(
                    '[policy] denied %s -> %s: %s',
                    session.identity.email,
                    name or f'service#{call.service_id}',
                    decision.reason,
                )
                await self._deny(session, decision.reason, call_id=call.call_id)
                return
            if decision.activity:
                await self.announce(
                    session,
                    decision.activity,
                    _decode_detail(call),
                    decision.is_stop,
                )
            await upstream.send_bytes(data)
            return

        if opcode == protocol.CLIENT_MESSAGE_DATA:
            channel_id = protocol.parse_client_publish(data)
            topic = session.channels.get(channel_id) if channel_id is not None else None
            decision = policy.check_publish(
                topic, session.identity, session.holds_lease(self.leases)
            )
            if not decision.allowed:
                await self._deny(session, decision.reason)
                return
            await upstream.send_bytes(data)
            return

        await self._deny(session, f'binary opcode {opcode} is not allowed')

    async def _pump_bridge_to_client(
        self, session: Session, upstream: aiohttp.ClientWebSocketResponse
    ) -> None:
        """Relay the bridge's frames, learning the service table on the way."""
        async for msg in upstream:
            if msg.type is aiohttp.WSMsgType.TEXT:
                try:
                    message = json.loads(msg.data)
                    if message.get('op') == 'advertiseServices':
                        session.services.update(protocol.service_names(message))
                    elif message.get('op') == 'unadvertiseServices':
                        for service_id in message.get('serviceIds') or []:
                            session.services.pop(int(service_id), None)
                except Exception:
                    pass
                await session.ws.send_str(msg.data)
            elif msg.type is aiohttp.WSMsgType.BINARY:
                await session.ws.send_bytes(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                break

    async def _deny(
        self,
        session: Session,
        reason: str,
        op: str = '',
        call_id: Optional[int] = None,
    ) -> None:
        await session.ws.send_str(
            json.dumps(
                {
                    'op': 'denied',
                    'reason': reason,
                    'request': op or None,
                    'callId': call_id,
                }
            )
        )

    # ── HTTP: emergency stop and health ─────────────────────────────────────

    async def handle_estop(self, request: web.Request) -> web.Response:
        """Server-to-server emergency stop from the lab web app.

        A second, independent path to the same stop the browser can trigger
        over its own socket: if the operator's WebSocket is wedged, the app can
        still reach the hardware. Requires the operator role and, like every
        other stop, no lease.
        """
        header = request.headers.get('Authorization', '')
        token = header[7:] if header.lower().startswith('bearer ') else ''
        try:
            identity = self.tokens.verify(token)
        except AuthError as exc:
            log.info('[estop] rejected: %s', exc)
            return web.json_response({'error': 'unauthorized'}, status=401)
        if not identity.at_least('operator'):
            return web.json_response({'error': 'operator role required'}, status=403)

        ok, detail = await self._call_service_once('/weblab/estop')
        await self.broadcast(
            {
                'op': 'activity',
                'id': uuid.uuid4().hex[:12],
                'ts': int(time.time() * 1000),
                'user': {'id': identity.user_id, 'name': identity.name},
                'action': '/weblab/estop',
                'detail': {'via': 'http', 'delivered': ok},
                'stop': True,
            }
        )
        log.warning('[estop] triggered by %s — delivered=%s', identity.email, ok)
        return web.json_response({'ok': ok, 'detail': detail}, status=200 if ok else 502)

    async def _call_service_once(self, service_name: str) -> tuple[bool, str]:
        """Open a throwaway bridge connection and call one service.

        Used only by the HTTP e-stop path. A dedicated connection avoids
        entangling a safety command with any browser session's state.
        """
        try:
            async with aiohttp.ClientSession() as http:
                async with http.ws_connect(
                    self.config.bridge_url, protocols=[FOXGLOVE_SUBPROTOCOL]
                ) as ws:
                    service_id = await self._await_service_id(ws, service_name)
                    if service_id is None:
                        return False, f'{service_name} is not advertised'
                    payload = b'{}'
                    encoding = b'json'
                    frame = (
                        bytes([protocol.CLIENT_SERVICE_CALL_REQUEST])
                        + struct.pack('<III', service_id, 1, len(encoding))
                        + encoding
                        + payload
                    )
                    await ws.send_bytes(frame)
                    # The stop has been handed to ROS; the response only tells
                    # us how it went, so a slow reply must not delay the caller
                    # for long.
                    try:
                        reply = await asyncio.wait_for(ws.receive(), timeout=4.0)
                    except asyncio.TimeoutError:
                        return True, 'dispatched (no response within 4s)'
                    if reply.type is aiohttp.WSMsgType.TEXT:
                        message = json.loads(reply.data)
                        if message.get('op') == 'serviceCallFailure':
                            return False, str(message.get('message') or 'call failed')
                    return True, 'ok'
        except Exception as exc:
            return False, str(exc)

    async def _await_service_id(
        self, ws: aiohttp.ClientWebSocketResponse, name: str, timeout: float = 5.0
    ) -> Optional[int]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=remaining)
            except asyncio.TimeoutError:
                return None
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            try:
                message = json.loads(msg.data)
            except Exception:
                continue
            if message.get('op') == 'advertiseServices':
                for service_id, service_name in protocol.service_names(message).items():
                    if service_name == name:
                        return service_id
        return None

    async def handle_health(self, request: web.Request) -> web.Response:
        """Unauthenticated liveness. Exposes no lab data on purpose — an
        operator has to be able to curl it while debugging the tunnel."""
        return web.json_response(
            {
                'ok': True,
                'lab': self.config.lab_slug,
                'viewers': len(self.sessions),
                'leaseVerification': self.leases.enabled,
                'bridge': self.config.bridge_url,
            }
        )


def _decode_detail(call: protocol.ServiceCall) -> Any:
    """Best-effort, size-capped view of a service payload for the activity feed."""
    if call.encoding != 'json':
        return {'encoding': call.encoding}
    try:
        text = call.payload[:ACTIVITY_DETAIL_LIMIT].decode('utf-8')
        return json.loads(text)
    except Exception:
        return None


# ── Configuration and entry point ───────────────────────────────────────────


@dataclass
class Config:
    supabase_url: str
    project_id: str
    lab_slug: str
    lease_secret: str
    jwt_secret: str
    bridge_url: str
    host: str
    port: int
    default_role: str

    @classmethod
    def from_env(cls) -> 'Config':
        missing = [
            name
            for name in ('SUPABASE_URL', 'LAB_PROJECT_ID', 'LAB_SLUG')
            if not os.environ.get(name)
        ]
        if missing:
            raise SystemExit(
                'gateway: missing required environment: ' + ', '.join(missing)
            )
        return cls(
            supabase_url=os.environ['SUPABASE_URL'],
            project_id=os.environ['LAB_PROJECT_ID'],
            lab_slug=os.environ['LAB_SLUG'],
            lease_secret=os.environ.get('LAB_CONTROL_SIGNING_SECRET', ''),
            jwt_secret=os.environ.get('SUPABASE_JWT_SECRET', ''),
            bridge_url=os.environ.get('FOXGLOVE_BRIDGE_URL', 'ws://127.0.0.1:8765'),
            host=os.environ.get('GATEWAY_HOST', '127.0.0.1'),
            port=int(os.environ.get('GATEWAY_PORT', '8766')),
            default_role=os.environ.get('LAB_DEFAULT_ROLE', ''),
        )


# Typed key rather than a bare string: aiohttp warns about the latter, and the
# tests reach for the gateway instance through it.
GATEWAY_KEY: web.AppKey['Gateway'] = web.AppKey('gateway')


def build_app(config: Config) -> web.Application:
    gateway = Gateway(config)
    app = web.Application()
    app[GATEWAY_KEY] = gateway
    app.add_routes(
        [
            web.get('/ws', gateway.handle_ws),
            web.get('/health', gateway.handle_health),
            web.post('/api/estop', gateway.handle_estop),
        ]
    )

    async def on_start(_: web.Application) -> None:
        if not gateway.leases.enabled:
            log.warning(
                '[gateway] LAB_CONTROL_SIGNING_SECRET is unset — no lease token can '
                'be verified, so every motion command will be refused. The lab is '
                'view-only until it is configured.'
            )
        async with aiohttp.ClientSession() as http:
            reachable = await probe_jwks(http, gateway.tokens.jwks_url)
        log.info(
            '[gateway] lab=%s project=%s bridge=%s jwks=%s',
            config.lab_slug,
            config.project_id,
            config.bridge_url,
            'reachable' if reachable else 'UNREACHABLE (will retry per request)',
        )

    app.on_startup.append(on_start)
    return app


def main() -> None:
    logging.basicConfig(
        level=os.environ.get('GATEWAY_LOG_LEVEL', 'INFO').upper(),
        format='%(asctime)s %(levelname)-7s %(message)s',
    )
    config = Config.from_env()
    web.run_app(build_app(config), host=config.host, port=config.port)


if __name__ == '__main__':
    main()
